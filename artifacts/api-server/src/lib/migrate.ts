/**
 * Lightweight startup migrations.
 * Runs idempotent CREATE TABLE IF NOT EXISTS statements so new tables
 * are created automatically on first deploy without needing shell access.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id    TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS licenses (
        id               SERIAL PRIMARY KEY,
        license_code     TEXT NOT NULL UNIQUE,
        transaction_code TEXT NOT NULL,
        duration_days    INTEGER NOT NULL,
        note             TEXT,
        is_active        BOOLEAN NOT NULL DEFAULT FALSE,
        is_revoked       BOOLEAN NOT NULL DEFAULT FALSE,
        activated_at     TIMESTAMP,
        expires_at       TIMESTAMP,
        used_by_user_id  TEXT,
        used_by_email    TEXT,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trades (
        id           SERIAL PRIMARY KEY,
        user_id      TEXT NOT NULL,
        trade_date   DATE NOT NULL,
        balance      NUMERIC(12, 2),
        risk_pct     NUMERIC(5, 2),
        entry_price  NUMERIC(10, 5),
        sl_price     NUMERIC(10, 5),
        tp_price     NUMERIC(10, 5),
        lot_size     NUMERIC(8, 2),
        direction    TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'Pending',
        close_price  NUMERIC(10, 5),
        pips         NUMERIC(8, 2),
        pnl          NUMERIC(12, 2),
        notes        TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS investors (
        id                SERIAL PRIMARY KEY,
        user_id           TEXT NOT NULL,
        name              TEXT NOT NULL,
        investment_amount NUMERIC(12, 2) NOT NULL,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_settings (
        id                  SERIAL PRIMARY KEY,
        user_id             TEXT NOT NULL UNIQUE,
        bot_token           TEXT NOT NULL DEFAULT '',
        chat_id             TEXT NOT NULL DEFAULT '',
        group_id            TEXT NOT NULL DEFAULT '',
        daily_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
        weekly_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        monthly_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
        risk_alert_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
        win_threshold_pct   NUMERIC(5, 2) DEFAULT 10,
        loss_threshold_pct  NUMERIC(5, 2) DEFAULT 6,
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS account_settings (
        id               SERIAL PRIMARY KEY,
        user_id          TEXT NOT NULL UNIQUE,
        opening_balance  NUMERIC(12, 2) NOT NULL DEFAULT 1000,
        timezone         TEXT NOT NULL DEFAULT 'GMT+6',
        default_risk_pct NUMERIC(5, 2) DEFAULT 1,
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS offers (
        id           SERIAL PRIMARY KEY,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        is_on        BOOLEAN NOT NULL DEFAULT FALSE,
        discount_pct TEXT,
        price        TEXT,
        validity     TEXT,
        created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    // Column additions for existing tables (idempotent)
    await client.query(`
      ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS daily_target_pct NUMERIC(5,2) DEFAULT 2;
      ALTER TABLE account_settings ADD COLUMN IF NOT EXISTS nickname TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS tags TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS session TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
      ALTER TABLE trades ADD COLUMN IF NOT EXISTS loss_reason TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

      CREATE TABLE IF NOT EXISTS system_settings (
        id                           SERIAL PRIMARY KEY,
        license_enforcement_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at                   TIMESTAMP NOT NULL DEFAULT NOW()
      );

      -- Ensure the singleton row exists
      INSERT INTO system_settings (id, license_enforcement_enabled)
      VALUES (1, TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);
    // Add trial_mode_enabled column if it doesn't exist yet
    await client.query(`
      ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS trial_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS trial_duration_days INTEGER NOT NULL DEFAULT 7;
    `);
    // Notifications table (mirrors every Telegram send + admin broadcasts)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        type       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        is_read    BOOLEAN NOT NULL DEFAULT TRUE,
        is_seen    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id);

      -- is_seen: UI-only badge tracking flag, decoupled from is_read (backend/Telegram sync flag)
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_seen BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE notifications ALTER COLUMN is_read SET DEFAULT TRUE;
    `);
    // Contact request tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_attempts (
        id          SERIAL PRIMARY KEY,
        ip          TEXT NOT NULL UNIQUE,
        attempts    INTEGER NOT NULL DEFAULT 0,
        last_email  TEXT,
        last_phone  TEXT,
        last_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS contact_config (
        id      SERIAL PRIMARY KEY,
        "limit" INTEGER NOT NULL DEFAULT 3
      );

      -- Ensure singleton config row exists
      INSERT INTO contact_config (id, "limit")
      VALUES (1, 3)
      ON CONFLICT (id) DO NOTHING;
    `);
    // Feedback table
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        email      TEXT NOT NULL DEFAULT '',
        rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    // Support messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_messages (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        email      TEXT NOT NULL DEFAULT '',
        message    TEXT NOT NULL,
        is_read    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS support_messages_user_id_idx ON support_messages (user_id);
      CREATE INDEX IF NOT EXISTS support_messages_is_read_idx  ON support_messages (is_read);
    `);
    // Chat conversations & messages (real-time encrypted support chat)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_sender_type') THEN
          CREATE TYPE chat_sender_type AS ENUM ('user', 'admin');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chat_conversation_status') THEN
          CREATE TYPE chat_conversation_status AS ENUM ('open', 'closed');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS chat_conversations (
        id         SERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL UNIQUE,
        email      TEXT NOT NULL DEFAULT '',
        status     chat_conversation_status NOT NULL DEFAULT 'open',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id              SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        sender_id       TEXT NOT NULL,
        sender_type     chat_sender_type NOT NULL,
        content         TEXT NOT NULL,
        iv              TEXT NOT NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS chat_messages_conv_idx ON chat_messages (conversation_id);
      CREATE INDEX IF NOT EXISTS chat_conversations_user_idx ON chat_conversations (user_id);

    `);
    // Indexes — idempotent, safe to re-run on every startup
    await client.query(`
      CREATE INDEX IF NOT EXISTS trades_user_id_idx ON trades (user_id);
      CREATE INDEX IF NOT EXISTS users_email_idx    ON users  (email);
    `);
    // Staff role column — replaces the old binary is_admin-only model.
    // Existing admins (is_admin = true) are migrated to role = 'admin' once.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
      ALTER TABLE telegram_settings ADD COLUMN IF NOT EXISTS notify_language TEXT NOT NULL DEFAULT 'bn';
      UPDATE users SET role = 'admin' WHERE is_admin = TRUE AND role = 'user';
    `);
        logger.info("Migrations complete");
  } catch (err) {
    logger.error({ err }, "Migration failed");
    throw err;
  } finally {
    client.release();
  }
}
