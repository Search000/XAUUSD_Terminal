/**
 * Auto-notification engine.
 * Computes report data from DB and broadcasts to Telegram.
 *
 * Format rules:
 *  - Daily / Weekly / Monthly reports  → box format (╭──╮)
 *  - Risk alerts (≥10% win / ≤-6% loss) → random Win/Loss templates
 *  - Off Day (no trades in daily)       → random Off-Day template
 */

import { db } from "@workspace/db";
import {
  telegramSettingsTable,
  tradesTable,
  investorsTable,
  notificationsTable,
  licensesTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { broadcastTelegramMessage } from "./telegram";
import { pushNotificationSSE } from "./sseClients";
import { logger } from "./logger";

// ── In-app notification saver ─────────────────────────────────────────────────

async function saveNotificationForUser(
  userId: string,
  type: string,
  title: string,
  body: string,
) {
  try {
    await db.insert(notificationsTable).values({ userId, type, title, body });
    // Instantly push to any connected SSE clients for this user
    pushNotificationSSE(userId);
  } catch (e) {
    logger.error({ err: e }, "[notify] failed to save in-app notification");
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_SHORT = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Box-format builders ───────────────────────────────────────────────────────

function buildDailyBox(opts: {
  dateLabel: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  plusPips: number;
  minusPips: number;
  netPips: number;
  startBal: number;
  endBal: number;
}) {
  const diff = opts.endBal - opts.startBal;
  const growth = opts.startBal > 0 ? (diff / opts.startBal) * 100 : 0;
  const statusEmoji = diff >= 0 ? "🟢" : "🔴";
  const trendEmoji  = diff >= 0 ? "📈" : "📉";
  const sign        = diff >= 0 ? "+" : "";

  return (
    `╭──────────────────────────────╮\n` +
    ` ${statusEmoji} DAILY REPORT | ${opts.dateLabel}\n` +
    `╰──────────────────────────────╯\n` +
    ` ┌─ SUMMARY\n` +
    ` │ • Trades : ${opts.trades}\n` +
    ` │ • W / L   : ${opts.wins} / ${opts.losses}\n` +
    ` │ • Rate    : ${fmt(opts.winRate, 2)}%\n` +
    ` └─────────────\n\n` +
    ` ┌─ PIPS DATA\n` +
    ` │ • (+) PIPS : ${fmt(opts.plusPips, 2)}\n` +
    ` │ • (-) PIPS : ${fmt(Math.abs(opts.minusPips), 2)}\n` +
    ` │ • Net      : ${fmt(opts.netPips, 2)} ${opts.netPips >= 0 ? "✅" : "❌"}\n` +
    ` └─────────────\n\n` +
    ` ┌─ ACCOUNT\n` +
    ` │ • Start    : $${fmt(opts.startBal)}\n` +
    ` │ • Balance  : $${fmt(opts.endBal)}\n` +
    ` │ • Growth   : ${sign}${fmt(growth, 2)}% ${trendEmoji}\n` +
    ` └─────────────`
  );
}

function buildWeeklyBox(opts: {
  dateRange: string;
  weekNum: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  plusPips: number;
  minusPips: number;
  netPips: number;
  startBal: number;
  endBal: number;
  workDays: number;
  offDays: number;
}) {
  const diff = opts.endBal - opts.startBal;
  const growth = opts.startBal > 0 ? (diff / opts.startBal) * 100 : 0;
  const statusEmoji = diff >= 0 ? "🟢" : "🔴";
  const trendEmoji  = diff >= 0 ? "📈" : "📉";
  const sign        = diff >= 0 ? "+" : "";

  return (
    `╭──────────────────────────────╮\n` +
    ` ${statusEmoji} WEEKLY REPORT | ${opts.dateRange}\n` +
    `╰──────────────────────────────╯\n` +
    ` ┌─ SUMMARY (WEEK ${opts.weekNum})\n` +
    ` │ • Trades : ${opts.trades}\n` +
    ` │ • W / L   : ${opts.wins} / ${opts.losses}\n` +
    ` │ • Rate    : ${fmt(opts.winRate, 2)}%\n` +
    ` │ • Work Day : ${opts.workDays}\n` +
    ` │ • Off Day  : ${opts.offDays}\n` +
    ` └─────────────\n\n` +
    ` ┌─ PIPS DATA\n` +
    ` │ • (+) PIPS : ${fmt(opts.plusPips, 2)}\n` +
    ` │ • (-) PIPS : ${fmt(Math.abs(opts.minusPips), 2)}\n` +
    ` │ • Net      : ${fmt(opts.netPips, 2)} ${opts.netPips >= 0 ? "✅" : "❌"}\n` +
    ` └─────────────\n\n` +
    ` ┌─ ACCOUNT\n` +
    ` │ • Start    : $${fmt(opts.startBal)}\n` +
    ` │ • Balance  : $${fmt(opts.endBal)}\n` +
    ` │ • Growth   : ${sign}${fmt(growth, 2)}% ${trendEmoji}\n` +
    ` └─────────────`
  );
}

function buildMonthlyBox(opts: {
  monthLabel: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  plusPips: number;
  minusPips: number;
  netPips: number;
  startBal: number;
  endBal: number;
  workDays: number;
  offDays: number;
}) {
  const diff = opts.endBal - opts.startBal;
  const growth = opts.startBal > 0 ? (diff / opts.startBal) * 100 : 0;
  const statusEmoji = diff >= 0 ? "🟢" : "🔴";
  const trendEmoji  = diff >= 0 ? "📈" : "📉";
  const sign        = diff >= 0 ? "+" : "";

  return (
    `╭──────────────────────────────╮\n` +
    ` ${statusEmoji} MONTHLY REPORT | ${opts.monthLabel}\n` +
    `╰──────────────────────────────╯\n` +
    ` ┌─ SUMMARY\n` +
    ` │ • Trades : ${opts.trades}\n` +
    ` │ • W / L   : ${opts.wins} / ${opts.losses}\n` +
    ` │ • Rate    : ${fmt(opts.winRate, 2)}%\n` +
    ` │ • Work Day : ${opts.workDays}\n` +
    ` │ • Off Day  : ${opts.offDays}\n` +
    ` └─────────────\n\n` +
    ` ┌─ PIPS DATA\n` +
    ` │ • (+) PIPS : ${fmt(opts.plusPips, 2)}\n` +
    ` │ • (-) PIPS : ${fmt(Math.abs(opts.minusPips), 2)}\n` +
    ` │ • Net      : ${fmt(opts.netPips, 2)} ${opts.netPips >= 0 ? "✅" : "❌"}\n` +
    ` └─────────────\n\n` +
    ` ┌─ ACCOUNT\n` +
    ` │ • Start    : $${fmt(opts.startBal)}\n` +
    ` │ • Balance  : $${fmt(opts.endBal)}\n` +
    ` │ • Growth   : ${sign}${fmt(growth, 2)}% ${trendEmoji}\n` +
    ` └─────────────`
  );
}

// ── Templates (Risk Alert + Off Day only) ────────────────────────────────────

function getWinTemplates(s: string, e: string, p: string): string[] {
  return [
    `╔════════════════════╗\n     STATUS: TARGET HIT ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ প্রফিট এনজয় করুন এবং অ্যাপটি ক্লোজ করুন।\n➤ ADVICE:\n   ▸ Congratulations! আপনার ডিসিপ্লিন আজ আপনাকে জয়ী করেছে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: MISSION SUCCESS ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ পিসি অফ করে পরিবারের সাথে সময় কাটান।\n➤ ADVICE:\n   ▸ Excellent! গোল্ড মার্কেটে আজ আপনি একজন বিজয়ী।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROFIT SECURED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ রি-এন্ট্রি থেকে বিরত থাকুন। প্রফিট লক করুন।\n➤ ADVICE:\n   ▸ Patience is Power. আজ ধৈর্য আপনাকে পুরস্কার দিয়েছে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: GOAL ACHIEVED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ট্রেডিং স্টেশনের পরিবর্তে রিল্যাক্স করুন।\n➤ ADVICE:\n   ▸ Consistency is Key. আজ আপনি সঠিক ডিসিপ্লিন দেখিয়েছেন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: GOLD MASTERED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ মার্কেট থেকে বিদায় নিন। কাল ফ্রেশ শুরু হবে।\n➤ ADVICE:\n   ▸ You handled the volatility like a pro. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: WINNING DAY ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ দিনটি হাসি মুখে শেষ করুন।\n➤ ADVICE:\n   ▸ Small wins lead to big success. চালিয়ে যান।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: BULLSEYE ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ আর কোনো বাই বা সেল এন্ট্রি নয়।\n➤ ADVICE:\n   ▸ Your analysis was spot on today. চমৎকার এন্ট্রি।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SMART WINNER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ব্যালেন্সের গ্রোথ এনজয় করুন।\n➤ ADVICE:\n   ▸ Logical trading wins over greed. লোভকে হারালেন আপনি।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: TOP PERFORMER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ আপনি একজন প্রফেশনাল। ক্লোজ করুন।\n➤ ADVICE:\n   ▸ Keep this focus for the next session. চমৎকার!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROFIT LOCKED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ লাভজনক সেশনটি এখন ক্লোজ করুন।\n➤ ADVICE:\n   ▸ Success looks good on you. দিনটি আপনার।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: BRAVO TRADER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের লক্ষ্য পূরণ হয়েছে। বিরতি নিন।\n➤ ADVICE:\n   ▸ Discipline is doing what needs to be done. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PERFECT TRADE ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ দিন শেষে এনালাইসিসটি ডায়েরিতে নোট করুন।\n➤ ADVICE:\n   ▸ You nailed it! আপনার স্ট্র্যাটেজি নিখুঁত ছিল।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: MARKET CONQUERED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আর চার্ট দেখতে হবে না। রিল্যাক্স।\n➤ ADVICE:\n   ▸ Confidence is built on consistency. দারুণ কাজ।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: VICTORY REPORT ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ আর কোনো ট্রেড নয়। দিনটি আপনার।\n➤ ADVICE:\n   ▸ Trust the process. আজ আপনিই বিজয়ী।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: GOLD HUNTER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ গোল্ড থেকে লাভ বের করেছেন, এখন সরুন।\n➤ ADVICE:\n   ▸ Extracted profit successfully. চমৎকার দক্ষতা!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SESSION ENDED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ কালকের জন্য এনার্জি সেভ করুন।\n➤ ADVICE:\n   ▸ Steady growth is sustainable growth. ভালো করেছেন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: UNSTOPPABLE ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ নিয়ম মেনেই সেশনটি শেষ করুন।\n➤ ADVICE:\n   ▸ Winners follow rules. আপনি আজ বিজয়ী।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROFIT RUNNER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের অর্জন ধরে রাখতে এখন বের হন।\n➤ ADVICE:\n   ▸ Greed ends when goal begins. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SMART GAIN ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ নিজের জন্য কিছু সময় দিন। সেশন ক্লোজ।\n➤ ADVICE:\n   ▸ Trading is 10% skill, 90% patience. জিতলেন আজ।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: MASTER MOVE ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের সেশন আর না বাড়ানোই ভালো।\n➤ ADVICE:\n   ▸ You outplayed the market. দারুণ মুভ!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: GOLD WINNER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ টার্মিনাল লগ-আউট করে দিন।\n➤ ADVICE:\n   ▸ Stick to the plan. This is the result. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROFIT MASTER ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ মার্কেট থেকে আপনার অংশ নিয়ে নিয়েছেন। সরুন।\n➤ ADVICE:\n   ▸ Patience pays off well. অভিনন্দন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SUCCESSFUL RUN ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ দিনটি হাসিমুখে শেষ করুন।\n➤ ADVICE:\n   ▸ You are doing great. Keep it up. অভিনন্দন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: GOAL REACHED ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আর কোনো রিস্ক নেওয়ার প্রয়োজন নেই।\n➤ ADVICE:\n   ▸ Discipline is your true asset. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROFIT TAKEN ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের সেশন এখানেই সমাপ্ত।\n➤ ADVICE:\n   ▸ Win with grace. কাল আবার দেখা হবে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: CHAMPION SESSION ✅\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের বিজয়ী আপনিই। বিশ্রাম নিন।\n➤ ADVICE:\n   ▸ You followed every rule. Well done. সাবাস!\n━━━━━━━━━━━━━━━━━━━━━`,
  ];
}

function getLossTemplates(s: string, e: string, p: string): string[] {
  return [
    `╔════════════════════╗\n     STATUS: TRADING SUSPENDED ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ট্রেডিং স্টেশনের পরিবর্তে পরিবারের সাথে সময় কাটান।\n➤ ADVICE:\n   ▸ Market is Always Right. মার্কেটকে দোষ না দিয়ে নিজের ভুল খুঁজুন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: CAPITAL GUARD ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ রিভেঞ্জ ট্রেড করবেন না। টার্মিনাল অফ করুন।\n➤ ADVICE:\n   ▸ Protecting equity is your #1 job. আজ থেমে যাওয়াই বুদ্ধিমান।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: STOP LOSS HIT ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ মার্কেট থেকে দূরে থাকুন। কাল ফ্রেশ শুরু হবে।\n➤ ADVICE:\n   ▸ SL hit means you are safe from a bigger crash. মেনে নিন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: RISK ALERT ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ চার্ট দেখা বন্ধ দিন। অন্য কাজে মন দিন।\n➤ ADVICE:\n   ▸ Save capital today to trade tomorrow. টিকে থাকাই আসল।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PROTECTION ON ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ আপনার দিন নয়। বিরতি নিন।\n➤ ADVICE:\n   ▸ 6% loss is better than a blown account. একাউন্ট বাঁচান।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PAUSE SESSION ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ রিকাভারি করার চেষ্টা করবেন না।\n➤ ADVICE:\n   ▸ Don't overthink. লস ট্রেডিং বিজনেসের অংশ।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: DISCIPLINE CHECK ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ল্যাপটপ বন্ধ করে স্টেশনের বাইরে যান।\n➤ ADVICE:\n   ▸ Walk away from the charts now. নিয়ন্ত্রণ হারাবেন না।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: MARKET VOLATILE ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ গোল্ড আজ বিপজ্জনক। নিরাপদ থাকাই ভালো।\n➤ ADVICE:\n   ▸ Market is wild today. ধৈর্য ধরুন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: RETREAT NOW ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের সেশন এখানেই সমাপ্ত।\n➤ ADVICE:\n   ▸ Tactical retreat for a better comeback. কাল সুযোগ আসবে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SYSTEM SHUTDOWN ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ আর কোনো বাই-সেল এন্ট্রি নয়।\n➤ ADVICE:\n   ▸ Risk quota is finished. নিয়মই বড় ট্রেডার বানাবে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: TAKE A BREAK ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ বাইরে হাঁটতে যান বা গান শুনুন।\n➤ ADVICE:\n   ▸ Go outside. ট্রেডিং থেকে মন সরিয়ে নিন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: RECOVERY BAN ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ লস রিকাভারি করতে গিয়ে লস বাড়াবেন না।\n➤ ADVICE:\n   ▸ Recovery trades usually double the loss. থামুন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: TRADING HALTED ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ব্রেক নিন। নিয়মের বাইরে যাবেন না।\n➤ ADVICE:\n   ▸ Don't break your rules. আজ থামাটাই নিয়ম।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: BE PROFESSIONAL ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ একজন প্রফেশনাল হিসেবে লস স্বীকার করুন।\n➤ ADVICE:\n   ▸ Pros stop when the limit hits. আপনি আজ প্রফেশনাল।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: ANALYSIS FAILED ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ মার্কেট আজ আপনার বিপক্ষে।\n➤ ADVICE:\n   ▸ Market changed, don't force it. কাল আবার সুযোগ পাবেন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: EXIT MARKET ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আর কোনো সেটআপ খুঁজতে যাবেন না।\n➤ ADVICE:\n   ▸ No setups left for today. Leave. নিজেকে শান্ত রাখুন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: SAVE YOURSELF ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ সেশন বন্ধ রাখাই সবথেকে বড় জয়।\n➤ ADVICE:\n   ▸ Save your psychology for tomorrow. ফিরে আসবেন কাল।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: LIMIT REACHED ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজকের কোটা শেষ। আর ট্রেড নয়।\n➤ ADVICE:\n   ▸ Discipline pays more than luck. কাল আপনি জিতবেন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: STOP LOSS HIT ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ এসএল লেগেছে মানে মার্কেট খারাপ। থামুন।\n➤ ADVICE:\n   ▸ SL is a protection, not a failure. ভালো করেছেন।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: RE-EVALUATE ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ কাল সকালে ভুলগুলো নিয়ে অ্যানালাইসিস করবেন।\n➤ ADVICE:\n   ▸ Note the mistakes, but don't trade now. রিল্যাক্স।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: PEACE OF MIND ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ সেশনটি অফ করে মনে প্রশান্তি আনুন।\n➤ ADVICE:\n   ▸ Close trades for peace of mind. মানসিক স্বাস্থ্য জরুরি।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: DON'T OVERTRADE ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ লস হয়েছে বলে বারবার ট্রেড দেবেন না।\n➤ ADVICE:\n   ▸ You have time to recover later. তাড়াহুড়ো করবেন না।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: MARKET WINS ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ আজ মার্কেটকে তার পাওনা দিয়ে দিন।\n➤ ADVICE:\n   ▸ Let the market win today. You win tomorrow. চ্যাম্পিয়নরা থামে।\n━━━━━━━━━━━━━━━━━━━━━`,
    `╔════════════════════╗\n     STATUS: FINAL WARNING ⚠️\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ একদমই আর কোনো ট্রেড নয়। স্টপ।\n➤ ADVICE:\n   ▸ Absolute stop. Do not enter any trade! মূলধন বাঁচান।\n━━━━━━━━━━━━━━━━━━━━━`,
  ];
}

function getOffDayTemplates(date: string): string[] {
  const f = "\n░░░░░░░░░░░░░░░░░░░░░░░\n#TradingLife #HappyWeekend 🩵";
  return [
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: মার্কেট আজ বন্ধ, নিজের ব্রেনকে রিচার্জ করার সুযোগ দিন। ✨` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: গত সপ্তাহের ভুলগুলো থেকে শিক্ষা নিন। 🔋` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: আজ চার্ট দেখা একদম বন্ধ রাখুন। ☕` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: গোল্ডের সাপোর্ট-রেজিস্ট্যান্সগুলো একবার চোখ বুলিয়ে নিন। 📈` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: প্রফিট যাই হোক, আজ পরিবারকে সময় দিন। ❤️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: অতিরিক্ত চিন্তা করবেন না, মার্কেট কোথাও পালিয়ে যাচ্ছে না। 😴` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ছোট লটে সন্তুষ্ট থাকতে শেখাই প্রো-ট্রেডারের লক্ষণ। 💎` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: নিজের অ্যানালাইসিসের ওপর শতভাগ বিশ্বাস রাখুন। 🪄` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: রিভেঞ্জ ট্রেডিং থেকে দূরে থাকার প্রতিজ্ঞা করুন। 🌱` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: নেগেটিভ চিন্তাগুলো মন থেকে মুছে ফেলুন। 🎁` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: মনে রাখবেন, ক্যাপিটাল রক্ষা করাই আপনার প্রথম কাজ। 🛡️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: গোল্ডের অস্থিরতা আজ থাক, আপনি শান্ত থাকুন। 🪙` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: সাকসেসফুল ট্রেডার হতে হলে বিরতি নিতে জানতে হয়। 💪` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: মানি ম্যানেজমেন্ট ইজ দ্য কি টু সাকসেস। 🧘‍♂️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: সপ্তাহ শেষে কৃতজ্ঞতা প্রকাশ করুন। 😊` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: স্ক্রিন টাইম কমিয়ে আজ নিজের হবির জন্য সময় দিন। 📈` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ট্রেডিংয়ের চাপ আজ একদম ভুলে যান। 🍿` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: নিজের সেটআপের জন্য অপেক্ষা করার ধৈর্য সঞ্চয় করুন। 🎯` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: অন্যের সিগন্যাল নয়, নিজের বুদ্ধিতে ট্রেড করতে শিখুন। 🛡️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: কালকের গ্যাপ ওপেনিং নিয়ে এখনই টেনশন করবেন না। 🌤️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: শরীর সুস্থ না থাকলে ট্রেডিংয়ে ভুল হওয়ার সম্ভাবনা বাড়ে। 💗` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ফরেক্স মার্কেট ধৈর্যের পরীক্ষা নেয়, আবেগের নয়। ✅` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: আজকের এই বিরতিই আপনার আগামী সপ্তাহের শক্তি। 🙏` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ভুল ট্রেডগুলো ডায়েরিতে লিখে রাখুন। 🏆` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ট্রেডিং জার্নিতে কোনো শর্টকাট নেই, আজ রিল্যাক্স করুন। 🚶‍♂️` + f,
    `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: লসের পরে প্রফিটও আসবে। দেখা হবে ইনশাআল্লাহ। 🕯️` + f,
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendToUser(
  botToken: string,
  chatId: string,
  groupId: string | null | undefined,
  text: string,
) {
  await broadcastTelegramMessage(botToken, chatId, groupId, text);
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = String(d.getDate()).padStart(2, "0");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${day} ${mon}`;
}

function weekRangesForMonth(year: number, month: number): { start: string; end: string; week: number }[] {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const weeks: { start: string; end: string; week: number }[] = [];
  let cursor  = new Date(firstDay);
  let weekNum = 1;
  while (cursor <= lastDay) {
    const weekStart = new Date(cursor);
    const daysToFriday = (5 - cursor.getDay() + 7) % 7;
    const weekEnd = new Date(cursor);
    weekEnd.setDate(cursor.getDate() + daysToFriday);
    if (weekEnd > lastDay) weekEnd.setTime(lastDay.getTime());
    weeks.push({
      week:  weekNum++,
      start: weekStart.toISOString().slice(0, 10),
      end:   weekEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(weekEnd);
    cursor.setDate(cursor.getDate() + 3);
    const toMon = (1 - cursor.getDay() + 7) % 7;
    if (toMon > 0) cursor.setDate(cursor.getDate() + toMon);
  }
  return weeks;
}

// ── Daily Recap ──────────────────────────────────────────────────────────────

export async function sendDailyRecapToAll() {
  const today = todayStr();
  const allSettings = await db
    .select()
    .from(telegramSettingsTable)
    .where(eq(telegramSettingsTable.dailyEnabled, true));

  for (const tg of allSettings) {
    if (!tg.botToken || !tg.chatId) continue;
    try {
      await sendDailyRecap(tg.userId, tg.botToken, tg.chatId, tg.groupId, today);
    } catch (e) {
      logger.error({ err: e, userId: tg.userId }, "[notify] daily recap failed");
    }
  }
}

async function sendDailyRecap(
  userId: string,
  botToken: string,
  chatId: string,
  groupId: string | null | undefined,
  date: string,
) {
  const investors = await db
    .select()
    .from(investorsTable)
    .where(eq(investorsTable.userId, userId));
  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), eq(tradesTable.tradeDate, date)));

  const closed = trades.filter(
    (t) => t.status === "TP Hit" || t.status === "SL Hit",
  );

  // Off Day — no closed trades → random off-day template
  if (closed.length === 0) {
    const d = new Date(date + "T00:00:00");
    const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const dd  = String(d.getDate()).padStart(2, "0");
    const mm  = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const fullDateStr = `${dayNames[d.getDay()]}, ${dd}.${mm}.${yyyy}`;
    await sendToUser(botToken, chatId, groupId, pick(getOffDayTemplates(fullDateStr)));
    return;
  }

  // Compute stats
  const wins   = closed.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit").length;
  const losses = closed.length - wins;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  const plusPips  = trades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const minusPips = trades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const netPips   = plusPips + minusPips;

  const sorted     = [...trades].sort((a, b) => a.id - b.id);
  const startBal   = sorted[0]?.balance ? parseFloat(sorted[0].balance) : totalInvestment;
  const lastTrade  = sorted[sorted.length - 1];
  const endBal     = lastTrade?.balance ? parseFloat(lastTrade.balance) : startBal;

  const text = buildDailyBox({
    dateLabel: shortDate(date),
    trades: closed.length,
    wins, losses, winRate,
    plusPips, minusPips, netPips,
    startBal, endBal,
  });

  await sendToUser(botToken, chatId, groupId, text);

  // mirror to in-app notifications
  const titleLabel = closed.length === 0 ? `Off Day — ${shortDate(date)}` : `Daily Recap — ${shortDate(date)}`;
  const notifType  = closed.length === 0 ? "off_day" : "daily";
  await saveNotificationForUser(userId, notifType, titleLabel, text);
}

// ── Weekly Report ────────────────────────────────────────────────────────────

export async function sendWeeklyReportToAll() {
  const allSettings = await db
    .select()
    .from(telegramSettingsTable)
    .where(eq(telegramSettingsTable.weeklyEnabled, true));

  for (const tg of allSettings) {
    if (!tg.botToken || !tg.chatId) continue;
    try {
      await sendWeeklyReport(tg.userId, tg.botToken, tg.chatId, tg.groupId);
    } catch (e) {
      logger.error({ err: e, userId: tg.userId }, "[notify] weekly report failed");
    }
  }
}

async function sendWeeklyReport(
  userId: string,
  botToken: string,
  chatId: string,
  groupId: string | null | undefined,
) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const weeks = weekRangesForMonth(year, month);
  // Find the week that contains today (or the most recent completed week)
  const todayISO = todayStr();
  let currentWeek = weeks.find((w) => todayISO >= w.start && todayISO <= w.end);
  if (!currentWeek) currentWeek = weeks[weeks.length - 1];

  const investors = await db
    .select()
    .from(investorsTable)
    .where(eq(investorsTable.userId, userId));
  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  // Start balance for this week = end balance of previous week's last trade, else total investment
  const prevWeeks = weeks.filter((w) => w.week < currentWeek!.week);
  let startBal = totalInvestment;
  if (prevWeeks.length > 0) {
    const prevEnd = prevWeeks[prevWeeks.length - 1].end;
    const prevTrades = await db
      .select()
      .from(tradesTable)
      .where(and(
        eq(tradesTable.userId, userId),
        gte(tradesTable.tradeDate, prevWeeks[0].start),
        lte(tradesTable.tradeDate, prevEnd),
      ));
    const lastPrev = prevTrades.sort((a, b) => b.id - a.id)[0];
    if (lastPrev?.balance) startBal = parseFloat(lastPrev.balance);
  }

  const allTrades = await db
    .select()
    .from(tradesTable)
    .where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, currentWeek.start),
      lte(tradesTable.tradeDate, currentWeek.end),
    ));

  const closed  = allTrades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins    = closed.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit").length;
  const losses  = closed.length - wins;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  const plusPips  = allTrades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const minusPips = allTrades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const netPips   = plusPips + minusPips;

  const lastTrade = allTrades.sort((a, b) => b.id - a.id)[0];
  const endBal    = lastTrade?.balance ? parseFloat(lastTrade.balance) : startBal;

  const workDays = new Set(allTrades.map((t) => t.tradeDate)).size;
  // total calendar days Mon-Fri in week range
  let totalWeekdays = 0;
  const s = new Date(currentWeek.start + "T00:00:00");
  const e = new Date(currentWeek.end   + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) totalWeekdays++;
  }
  const offDays = Math.max(0, totalWeekdays - workDays);

  const dateRange = `${shortDate(currentWeek.start)} To ${shortDate(currentWeek.end)}`;

  const text = buildWeeklyBox({
    dateRange,
    weekNum: currentWeek.week,
    trades: closed.length,
    wins, losses, winRate,
    plusPips, minusPips, netPips,
    startBal, endBal,
    workDays, offDays,
  });

  await sendToUser(botToken, chatId, groupId, text);

  // mirror to in-app notifications
  await saveNotificationForUser(userId, "weekly", `Weekly Report — ${dateRange}`, text);
}

// ── Monthly Report ───────────────────────────────────────────────────────────

export async function sendMonthlyReportToAll() {
  const allSettings = await db
    .select()
    .from(telegramSettingsTable)
    .where(eq(telegramSettingsTable.monthlyEnabled, true));

  for (const tg of allSettings) {
    if (!tg.botToken || !tg.chatId) continue;
    try {
      await sendMonthlyReport(tg.userId, tg.botToken, tg.chatId, tg.groupId);
    } catch (e) {
      logger.error({ err: e, userId: tg.userId }, "[notify] monthly report failed");
    }
  }
}

async function sendMonthlyReport(
  userId: string,
  botToken: string,
  chatId: string,
  groupId: string | null | undefined,
) {
  // Report is for the month that just ended
  const now        = new Date();
  const prevMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const monthStart = prevMonth.toISOString().slice(0, 10);
  const lastDay    = new Date(now.getFullYear(), now.getMonth(), 0);
  const monthEnd   = lastDay.toISOString().slice(0, 10);
  const monthLabel = `${MONTH_SHORT[prevMonth.getMonth()]} ${prevMonth.getFullYear()}`;

  const investors = await db
    .select()
    .from(investorsTable)
    .where(eq(investorsTable.userId, userId));
  const startBal = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(
      eq(tradesTable.userId, userId),
      gte(tradesTable.tradeDate, monthStart),
      lte(tradesTable.tradeDate, monthEnd),
    ));

  const closed  = trades.filter((t) => t.status === "TP Hit" || t.status === "SL Hit");
  const wins    = closed.filter((t) => t.pnl ? parseFloat(t.pnl) > 0 : t.status === "TP Hit").length;
  const losses  = closed.length - wins;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  const plusPips  = trades.filter((t) => t.pips && parseFloat(t.pips) > 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const minusPips = trades.filter((t) => t.pips && parseFloat(t.pips) < 0).reduce((s, t) => s + parseFloat(t.pips!), 0);
  const netPips   = plusPips + minusPips;

  const lastTrade = trades.sort((a, b) => b.id - a.id)[0];
  const endBal    = lastTrade?.balance ? parseFloat(lastTrade.balance) : startBal;

  const workDays = new Set(trades.map((t) => t.tradeDate)).size;
  // Count Mon-Fri days in the month
  let totalWeekdays = 0;
  for (let d = new Date(prevMonth); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) totalWeekdays++;
  }
  const offDays = Math.max(0, totalWeekdays - workDays);

  const text = buildMonthlyBox({
    monthLabel,
    trades: closed.length,
    wins, losses, winRate,
    plusPips, minusPips, netPips,
    startBal, endBal,
    workDays, offDays,
  });

  await sendToUser(botToken, chatId, groupId, text);

  // mirror to in-app notifications
  await saveNotificationForUser(userId, "monthly", `Monthly Statement — ${monthLabel}`, text);
}

// ── Risk Alert — Win/Loss templates (≥10% / ≤-6%) ───────────────────────────

export async function sendRiskAlertIfNeeded(userId: string, tradeId: number) {
  const [tg] = await db
    .select()
    .from(telegramSettingsTable)
    .where(eq(telegramSettingsTable.userId, userId));

  if (!tg?.botToken || !tg?.chatId || !tg.riskAlertEnabled) return;

  const today = todayStr();

  const investors = await db
    .select()
    .from(investorsTable)
    .where(eq(investorsTable.userId, userId));
  const totalInvestment = investors.reduce((s, inv) => s + parseFloat(inv.investmentAmount), 0);

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(eq(tradesTable.userId, userId), eq(tradesTable.tradeDate, today)));

  // Use today's first trade's balance as start-of-day balance (most accurate).
  // Falls back to total investment balance if no balance field is recorded.
  const sortedTrades = [...trades].sort((a, b) => a.id - b.id);
  const startBalance = sortedTrades[0]?.balance
    ? parseFloat(sortedTrades[0].balance)
    : totalInvestment;

  // Guard: if startBalance is 0 or negative, percentage math is meaningless
  if (startBalance <= 0) return;

  const closedTrades = trades.filter(
    (t) => t.status === "TP Hit" || t.status === "SL Hit",
  );
  const totalPnl = closedTrades.reduce(
    (s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0),
    0,
  );
  const currentBalance = startBalance + totalPnl;
  const growthPct = (totalPnl / startBalance) * 100;

  const winThreshold  = parseFloat(tg.winThresholdPct  ?? "10");
  const lossThreshold = parseFloat(tg.lossThresholdPct ?? "6");

  // Compute P&L BEFORE this specific trade so we only alert when the threshold
  // is crossed for the first time — prevents duplicate alerts on every trade save.
  const pnlBeforeThisTrade = closedTrades
    .filter((t) => t.id !== tradeId)
    .reduce((s, t) => s + (t.pnl ? parseFloat(t.pnl) : 0), 0);
  const growthBefore = (pnlBeforeThisTrade / startBalance) * 100;

  const startText   = startBalance.toFixed(2);
  const currentText = currentBalance.toFixed(2);
  const pText = (growthPct >= 0 ? "+" : "") + growthPct.toFixed(2) + "%";

  // Only fire when THIS trade is what first pushed P&L past the threshold
  if (growthPct >= winThreshold && growthBefore < winThreshold) {
    const msg = pick(getWinTemplates(startText, currentText, pText));
    await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, msg);
    await saveNotificationForUser(userId, "win_alert", `✅ Win Alert — Target Hit! (${pText})`, msg);
  } else if (growthPct <= -Math.abs(lossThreshold) && growthBefore > -Math.abs(lossThreshold)) {
    const msg = pick(getLossTemplates(startText, currentText, pText));
    await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, msg);
    await saveNotificationForUser(userId, "loss_alert", `⚠️ Loss Alert — Risk Threshold Hit (${pText})`, msg);
  }
}

// ── License Expiry Warning (7 days before expiry) ────────────────────────────

/**
 * Called daily by the scheduler.
 * Finds ALL active (paid + trial) licenses expiring in exactly 7 days and sends
 * a Telegram message + in-app notification. Deduplicates using a 20-hour cooldown.
 */
export async function sendLicenseExpiryWarnings(): Promise<void> {
  const now = new Date();
  // Window: between 7 days from now and 8 days from now (so we fire once per day)
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const in8days = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  const activeLicenses = await db
    .select()
    .from(licensesTable)
    .where(
      and(
        eq(licensesTable.isActive, true),
        eq(licensesTable.isRevoked, false),
      )
    );

  const expiringSoon = activeLicenses.filter(
    (l) =>
      l.expiresAt &&
      l.expiresAt > in7days &&
      l.expiresAt <= in8days &&
      l.usedByUserId &&
      l.transactionCode !== "TRIAL" // trial licenses handled separately by sendTrialExpiryReminders
  );

  for (const license of expiringSoon) {
    const userId = license.usedByUserId!;

    // Deduplicate: skip if warning already sent within the last 20 hours
    const recentWarnings = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.type, "license_expiry_warning")
        )
      );

    const alreadySent = recentWarnings.some(
      (n) => new Date(n.createdAt).getTime() > now.getTime() - 20 * 60 * 60 * 1000
    );
    if (alreadySent) continue;

    const daysLeft = Math.ceil((license.expiresAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    const expiryDate = license.expiresAt!.toLocaleDateString("en-US", { dateStyle: "long" });
    const licenseType = license.transactionCode === "TRIAL" ? "free trial" : "license";

    const inAppTitle = `⚠️ Your ${licenseType} expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`;
    const inAppBody = `Your ${licenseType} expires on ${expiryDate}. Renew now to keep full access to XAUUSD Terminal and avoid losing your trading data access.`;

    await saveNotificationForUser(userId, "license_expiry_warning", inAppTitle, inAppBody);

    // Also send via Telegram if the user has a bot configured
    const [tg] = await db
      .select()
      .from(telegramSettingsTable)
      .where(eq(telegramSettingsTable.userId, userId));

    if (tg?.botToken && tg?.chatId) {
      const telegramMsg =
        `╭──────────────────────────────╮\n` +
        ` ⚠️ LICENSE EXPIRY WARNING\n` +
        `╰──────────────────────────────╯\n` +
        ` ┌─ DETAILS\n` +
        ` │ • Type      : ${licenseType.toUpperCase()}\n` +
        ` │ • Expires   : ${expiryDate}\n` +
        ` │ • Days Left : ${daysLeft} day${daysLeft !== 1 ? "s" : ""} ⏳\n` +
        ` └─────────────\n\n` +
        ` ▸ Renew your license to keep full access\n` +
        ` ▸ to the XAUUSD Terminal.`;

      await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, telegramMsg).catch(
        (e: unknown) => logger.error({ err: e }, "[notify] license expiry telegram failed")
      );
    }
  }
}

// ── License Renewal Reminder (3 days before expiry) ──────────────────────────

/**
 * Called daily by the scheduler.
 * Sends a final renewal reminder 3 days before any active license expires.
 * Uses the same Telegram + in-app pattern as the 7-day warning.
 * Deduplicates via a 20-hour cooldown on the "license_renewal_reminder" type.
 *
 * Note: WhatsApp is not integrated in this codebase. Notifications are delivered
 * via Telegram bot (if configured) and the in-app notification feed.
 */
export async function sendLicenseRenewalReminders(): Promise<void> {
  const now = new Date();
  // Window: between 3 days and 4 days from now (fires once in this daily window)
  const in3days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const in4days = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);

  const activeLicenses = await db
    .select()
    .from(licensesTable)
    .where(
      and(
        eq(licensesTable.isActive, true),
        eq(licensesTable.isRevoked, false),
      )
    );

  const expiringSoon = activeLicenses.filter(
    (l) =>
      l.expiresAt &&
      l.expiresAt > in3days &&
      l.expiresAt <= in4days &&
      l.usedByUserId &&
      l.transactionCode !== "TRIAL" // trial licenses are not given renewal reminders
  );

  for (const license of expiringSoon) {
    const userId = license.usedByUserId!;

    // Deduplicate: skip if renewal reminder already sent within last 20 hours
    const recentReminders = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.type, "license_renewal_reminder")
        )
      );

    const alreadySent = recentReminders.some(
      (n) => new Date(n.createdAt).getTime() > now.getTime() - 20 * 60 * 60 * 1000
    );
    if (alreadySent) continue;

    const expiryDate = license.expiresAt!.toLocaleDateString("en-US", { dateStyle: "long" });
    const licenseType = license.transactionCode === "TRIAL" ? "free trial" : "license";

    const inAppTitle = `🚨 FINAL REMINDER — ${licenseType} expires in 3 days`;
    const inAppBody =
      `Your ${licenseType} expires on ${expiryDate}. ` +
      `This is your final reminder — renew now to avoid any interruption to your XAUUSD Terminal access.`;

    await saveNotificationForUser(userId, "license_renewal_reminder", inAppTitle, inAppBody);

    // Telegram message (urgent tone — final reminder)
    const [tg] = await db
      .select()
      .from(telegramSettingsTable)
      .where(eq(telegramSettingsTable.userId, userId));

    if (tg?.botToken && tg?.chatId) {
      const telegramMsg =
        `╔══════════════════════════════╗\n` +
        ` 🚨 FINAL RENEWAL REMINDER\n` +
        `╚══════════════════════════════╝\n` +
        ` ┌─ URGENT — ACTION REQUIRED\n` +
        ` │ • Type       : ${licenseType.toUpperCase()}\n` +
        ` │ • Expires    : ${expiryDate}\n` +
        ` │ • Days Left  : 3 days ⏳\n` +
        ` └─────────────\n\n` +
        ` ▸ Renew your license NOW to keep full\n` +
        ` ▸ access to XAUUSD Terminal.\n` +
        ` ▸ After expiry, your data remains saved\n` +
        ` ▸ but access will be suspended.`;

      await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, telegramMsg).catch(
        (e: unknown) => logger.error({ err: e }, "[notify] renewal reminder telegram failed")
      );
    }
  }
}

// ── Trial Expiry Reminder ─────────────────────────────────────────────────────

/**
 * Called every hour by the scheduler.
 * Finds trial licenses expiring in the next 24 hours and sends a reminder
 * in-app notification if one hasn't been sent yet (checked via a "trial_expiry_reminder"
 * notification already in DB for that user).
 */
export async function sendTrialExpiryReminders(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find trial licenses expiring within the next 24 hours
  const expiringLicenses = await db
    .select()
    .from(licensesTable)
    .where(
      and(
        eq(licensesTable.transactionCode, "TRIAL"),
        eq(licensesTable.isActive, true),
        eq(licensesTable.isRevoked, false),
      )
    );

  const soon = expiringLicenses.filter(
    (l) => l.expiresAt && l.expiresAt > now && l.expiresAt <= in24h && l.usedByUserId
  );

  for (const license of soon) {
    const userId = license.usedByUserId!;

    // Check if we already sent a reminder for this user recently (last 23h)
    const recent = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.type, "trial_expiry_reminder")
        )
      );

    const alreadySent = recent.some(
      (n) => new Date(n.createdAt).getTime() > now.getTime() - 23 * 60 * 60 * 1000
    );

    if (alreadySent) continue;

    const hoursLeft = Math.ceil((license.expiresAt!.getTime() - now.getTime()) / (60 * 60 * 1000));

    await saveNotificationForUser(
      userId,
      "trial_expiry_reminder",
      `⏳ Your free trial expires in ~${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}`,
      `Your 7-day free trial is almost over! To keep full access to the XAUUSD Terminal, purchase a license.\n\nAlso — we'd love to know how your trial went. Rate your experience directly in the app!`
    );
  }
}
