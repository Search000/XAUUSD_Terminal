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
// Each entry has a Bengali-mixed version (current/default, 'bn') and a pure
// English version ('en'). Structure/frame stays identical either way.

type Lang = "en" | "bn";

interface StatusItem {
  status: string;
  actionBn: string;
  adviceBn: string;
  actionEn: string;
  adviceEn: string;
}

const WIN_ITEMS: StatusItem[] = [
  { status: "TARGET HIT", actionBn: "প্রফিট এনজয় করুন এবং অ্যাপটি ক্লোজ করুন।", adviceBn: "Congratulations! আপনার ডিসিপ্লিন আজ আপনাকে জয়ী করেছে।", actionEn: "Enjoy the profit and close the app.", adviceEn: "Congratulations! Your discipline made you a winner today." },
  { status: "MISSION SUCCESS", actionBn: "পিসি অফ করে পরিবারের সাথে সময় কাটান।", adviceBn: "Excellent! গোল্ড মার্কেটে আজ আপনি একজন বিজয়ী।", actionEn: "Turn off the PC and spend time with family.", adviceEn: "Excellent! You're a winner in the gold market today." },
  { status: "PROFIT SECURED", actionBn: "রি-এন্ট্রি থেকে বিরত থাকুন। প্রফিট লক করুন।", adviceBn: "Patience is Power. আজ ধৈর্য আপনাকে পুরস্কার দিয়েছে।", actionEn: "Avoid re-entry. Lock in the profit.", adviceEn: "Patience is Power. Your patience paid off today." },
  { status: "GOAL ACHIEVED", actionBn: "ট্রেডিং স্টেশনের পরিবর্তে রিল্যাক্স করুন।", adviceBn: "Consistency is Key. আজ আপনি সঠিক ডিসিপ্লিন দেখিয়েছেন।", actionEn: "Relax instead of staying at the trading station.", adviceEn: "Consistency is Key. You showed real discipline today." },
  { status: "GOLD MASTERED", actionBn: "মার্কেট থেকে বিদায় নিন। কাল ফ্রেশ শুরু হবে।", adviceBn: "You handled the volatility like a pro. সাবাস!", actionEn: "Step away from the market. Tomorrow's a fresh start.", adviceEn: "You handled the volatility like a pro. Well done!" },
  { status: "WINNING DAY", actionBn: "দিনটি হাসি মুখে শেষ করুন।", adviceBn: "Small wins lead to big success. চালিয়ে যান।", actionEn: "End the day with a smile.", adviceEn: "Small wins lead to big success. Keep going." },
  { status: "BULLSEYE", actionBn: "আজ আর কোনো বাই বা সেল এন্ট্রি নয়।", adviceBn: "Your analysis was spot on today. চমৎকার এন্ট্রি।", actionEn: "No more buy or sell entries today.", adviceEn: "Your analysis was spot on today. Excellent entry." },
  { status: "SMART WINNER", actionBn: "ব্যালেন্সের গ্রোথ এনজয় করুন।", adviceBn: "Logical trading wins over greed. লোভকে হারালেন আপনি।", actionEn: "Enjoy the growth in your balance.", adviceEn: "Logical trading wins over greed. You beat greed today." },
  { status: "TOP PERFORMER", actionBn: "আজ আপনি একজন প্রফেশনাল। ক্লোজ করুন।", adviceBn: "Keep this focus for the next session. চমৎকার!", actionEn: "You're a professional today. Close it out.", adviceEn: "Keep this focus for the next session. Excellent!" },
  { status: "PROFIT LOCKED", actionBn: "লাভজনক সেশনটি এখন ক্লোজ করুন।", adviceBn: "Success looks good on you. দিনটি আপনার।", actionEn: "Close out this profitable session now.", adviceEn: "Success looks good on you. Today is yours." },
  { status: "BRAVO TRADER", actionBn: "আজকের লক্ষ্য পূরণ হয়েছে। বিরতি নিন।", adviceBn: "Discipline is doing what needs to be done. সাবাস!", actionEn: "Today's target is met. Take a break.", adviceEn: "Discipline is doing what needs to be done. Well done!" },
  { status: "PERFECT TRADE", actionBn: "দিন শেষে এনালাইসিসটি ডায়েরিতে নোট করুন।", adviceBn: "You nailed it! আপনার স্ট্র্যাটেজি নিখুঁত ছিল।", actionEn: "Note today's analysis in your journal.", adviceEn: "You nailed it! Your strategy was perfect." },
  { status: "MARKET CONQUERED", actionBn: "আর চার্ট দেখতে হবে না। রিল্যাক্স।", adviceBn: "Confidence is built on consistency. দারুণ কাজ।", actionEn: "No need to watch the charts anymore. Relax.", adviceEn: "Confidence is built on consistency. Great work." },
  { status: "VICTORY REPORT", actionBn: "আজ আর কোনো ট্রেড নয়। দিনটি আপনার।", adviceBn: "Trust the process. আজ আপনিই বিজয়ী।", actionEn: "No more trades today. Today is yours.", adviceEn: "Trust the process. You are the winner today." },
  { status: "GOLD HUNTER", actionBn: "গোল্ড থেকে লাভ বের করেছেন, এখন সরুন।", adviceBn: "Extracted profit successfully. চমৎকার দক্ষতা!", actionEn: "You've extracted profit from gold — now step aside.", adviceEn: "Extracted profit successfully. Excellent skill!" },
  { status: "SESSION ENDED", actionBn: "কালকের জন্য এনার্জি সেভ করুন।", adviceBn: "Steady growth is sustainable growth. ভালো করেছেন।", actionEn: "Save your energy for tomorrow.", adviceEn: "Steady growth is sustainable growth. Well done." },
  { status: "UNSTOPPABLE", actionBn: "নিয়ম মেনেই সেশনটি শেষ করুন।", adviceBn: "Winners follow rules. আপনি আজ বিজয়ী।", actionEn: "End the session by following the rules.", adviceEn: "Winners follow rules. You're a winner today." },
  { status: "PROFIT RUNNER", actionBn: "আজকের অর্জন ধরে রাখতে এখন বের হন।", adviceBn: "Greed ends when goal begins. সাবাস!", actionEn: "Exit now to lock in today's gains.", adviceEn: "Greed ends when goal begins. Well done!" },
  { status: "SMART GAIN", actionBn: "নিজের জন্য কিছু সময় দিন। সেশন ক্লোজ।", adviceBn: "Trading is 10% skill, 90% patience. জিতলেন আজ।", actionEn: "Give yourself some time. Session closed.", adviceEn: "Trading is 10% skill, 90% patience. You won today." },
  { status: "MASTER MOVE", actionBn: "আজকের সেশন আর না বাড়ানোই ভালো।", adviceBn: "You outplayed the market. দারুণ মুভ!", actionEn: "Best not to extend today's session further.", adviceEn: "You outplayed the market. Great move!" },
  { status: "GOLD WINNER", actionBn: "টার্মিনাল লগ-আউট করে দিন।", adviceBn: "Stick to the plan. This is the result. সাবাস!", actionEn: "Log out of the terminal.", adviceEn: "Stick to the plan. This is the result. Well done!" },
  { status: "PROFIT MASTER", actionBn: "মার্কেট থেকে আপনার অংশ নিয়ে নিয়েছেন। সরুন।", adviceBn: "Patience pays off well. অভিনন্দন।", actionEn: "You've taken your share from the market — step aside.", adviceEn: "Patience pays off well. Congratulations." },
  { status: "SUCCESSFUL RUN", actionBn: "দিনটি হাসিমুখে শেষ করুন।", adviceBn: "You are doing great. Keep it up. অভিনন্দন।", actionEn: "End the day with a smile.", adviceEn: "You are doing great. Keep it up. Congratulations." },
  { status: "GOAL REACHED", actionBn: "আর কোনো রিস্ক নেওয়ার প্রয়োজন নেই।", adviceBn: "Discipline is your true asset. সাবাস!", actionEn: "No need to take any more risk.", adviceEn: "Discipline is your true asset. Well done!" },
  { status: "PROFIT TAKEN", actionBn: "আজকের সেশন এখানেই সমাপ্ত।", adviceBn: "Win with grace. কাল আবার দেখা হবে।", actionEn: "Today's session ends here.", adviceEn: "Win with grace. See you again tomorrow." },
  { status: "CHAMPION SESSION", actionBn: "আজকের বিজয়ী আপনিই। বিশ্রাম নিন।", adviceBn: "You followed every rule. Well done. সাবাস!", actionEn: "You're today's champion. Take a rest.", adviceEn: "You followed every rule. Well done!" },
];

const LOSS_ITEMS: StatusItem[] = [
  { status: "TRADING SUSPENDED", actionBn: "ট্রেডিং স্টেশনের পরিবর্তে পরিবারের সাথে সময় কাটান।", adviceBn: "Market is Always Right. মার্কেটকে দোষ না দিয়ে নিজের ভুল খুঁজুন।", actionEn: "Spend time with family instead of the trading station.", adviceEn: "The Market is Always Right. Look for your own mistake instead of blaming the market." },
  { status: "CAPITAL GUARD", actionBn: "রিভেঞ্জ ট্রেড করবেন না। টার্মিনাল অফ করুন।", adviceBn: "Protecting equity is your #1 job. আজ থেমে যাওয়াই বুদ্ধিমান।", actionEn: "Don't revenge trade. Turn off the terminal.", adviceEn: "Protecting equity is your #1 job. Stopping today is the wise move." },
  { status: "STOP LOSS HIT", actionBn: "মার্কেট থেকে দূরে থাকুন। কাল ফ্রেশ শুরু হবে।", adviceBn: "SL hit means you are safe from a bigger crash. মেনে নিন।", actionEn: "Stay away from the market. Tomorrow is a fresh start.", adviceEn: "SL hit means you are safe from a bigger crash. Accept it." },
  { status: "RISK ALERT", actionBn: "চার্ট দেখা বন্ধ দিন। অন্য কাজে মন দিন।", adviceBn: "Save capital today to trade tomorrow. টিকে থাকাই আসল।", actionEn: "Stop watching the charts. Focus on something else.", adviceEn: "Save capital today to trade tomorrow. Survival is what matters." },
  { status: "PROTECTION ON", actionBn: "আজ আপনার দিন নয়। বিরতি নিন।", adviceBn: "6% loss is better than a blown account. একাউন্ট বাঁচান।", actionEn: "Today isn't your day. Take a break.", adviceEn: "6% loss is better than a blown account. Protect your account." },
  { status: "PAUSE SESSION", actionBn: "রিকাভারি করার চেষ্টা করবেন না।", adviceBn: "Don't overthink. লস ট্রেডিং বিজনেসের অংশ।", actionEn: "Don't try to recover the loss.", adviceEn: "Don't overthink. Loss is a part of the trading business." },
  { status: "DISCIPLINE CHECK", actionBn: "ল্যাপটপ বন্ধ করে স্টেশনের বাইরে যান।", adviceBn: "Walk away from the charts now. নিয়ন্ত্রণ হারাবেন না।", actionEn: "Close the laptop and step away from the station.", adviceEn: "Walk away from the charts now. Don't lose control." },
  { status: "MARKET VOLATILE", actionBn: "গোল্ড আজ বিপজ্জনক। নিরাপদ থাকাই ভালো।", adviceBn: "Market is wild today. ধৈর্য ধরুন।", actionEn: "Gold is dangerous today. Better to stay safe.", adviceEn: "Market is wild today. Be patient." },
  { status: "RETREAT NOW", actionBn: "আজকের সেশন এখানেই সমাপ্ত।", adviceBn: "Tactical retreat for a better comeback. কাল সুযোগ আসবে।", actionEn: "Today's session ends here.", adviceEn: "Tactical retreat for a better comeback. Opportunity will come tomorrow." },
  { status: "SYSTEM SHUTDOWN", actionBn: "আজ আর কোনো বাই-সেল এন্ট্রি নয়।", adviceBn: "Risk quota is finished. নিয়মই বড় ট্রেডার বানাবে।", actionEn: "No more buy-sell entries today.", adviceEn: "Risk quota is finished. Following the rules makes you a great trader." },
  { status: "TAKE A BREAK", actionBn: "বাইরে হাঁটতে যান বা গান শুনুন।", adviceBn: "Go outside. ট্রেডিং থেকে মন সরিয়ে নিন।", actionEn: "Go for a walk outside or listen to music.", adviceEn: "Go outside. Take your mind off trading." },
  { status: "RECOVERY BAN", actionBn: "লস রিকাভারি করতে গিয়ে লস বাড়াবেন না।", adviceBn: "Recovery trades usually double the loss. থামুন।", actionEn: "Don't increase the loss trying to recover it.", adviceEn: "Recovery trades usually double the loss. Stop." },
  { status: "TRADING HALTED", actionBn: "ব্রেক নিন। নিয়মের বাইরে যাবেন না।", adviceBn: "Don't break your rules. আজ থামাটাই নিয়ম।", actionEn: "Take a break. Don't go outside your rules.", adviceEn: "Don't break your rules. Stopping today is the rule." },
  { status: "BE PROFESSIONAL", actionBn: "একজন প্রফেশনাল হিসেবে লস স্বীকার করুন।", adviceBn: "Pros stop when the limit hits. আপনি আজ প্রফেশনাল।", actionEn: "Accept the loss like a professional.", adviceEn: "Pros stop when the limit hits. You're a professional today." },
  { status: "ANALYSIS FAILED", actionBn: "মার্কেট আজ আপনার বিপক্ষে।", adviceBn: "Market changed, don't force it. কাল আবার সুযোগ পাবেন।", actionEn: "The market is against you today.", adviceEn: "Market changed, don't force it. You'll get another chance tomorrow." },
  { status: "EXIT MARKET", actionBn: "আর কোনো সেটআপ খুঁজতে যাবেন না।", adviceBn: "No setups left for today. Leave. নিজেকে শান্ত রাখুন।", actionEn: "Don't look for any more setups.", adviceEn: "No setups left for today. Leave. Keep yourself calm." },
  { status: "SAVE YOURSELF", actionBn: "আজ সেশন বন্ধ রাখাই সবথেকে বড় জয়।", adviceBn: "Save your psychology for tomorrow. ফিরে আসবেন কাল।", actionEn: "Keeping the session closed today is your biggest win.", adviceEn: "Save your psychology for tomorrow. You'll come back tomorrow." },
  { status: "LIMIT REACHED", actionBn: "আজকের কোটা শেষ। আর ট্রেড নয়।", adviceBn: "Discipline pays more than luck. কাল আপনি জিতবেন।", actionEn: "Today's quota is over. No more trades.", adviceEn: "Discipline pays more than luck. You'll win tomorrow." },
  { status: "STOP LOSS HIT", actionBn: "এসএল লেগেছে মানে মার্কেট খারাপ। থামুন।", adviceBn: "SL is a protection, not a failure. ভালো করেছেন।", actionEn: "SL hit means the market went bad. Stop.", adviceEn: "SL is a protection, not a failure. You did well." },
  { status: "RE-EVALUATE", actionBn: "কাল সকালে ভুলগুলো নিয়ে অ্যানালাইসিস করবেন।", adviceBn: "Note the mistakes, but don't trade now. রিল্যাক্স।", actionEn: "Analyze your mistakes tomorrow morning.", adviceEn: "Note the mistakes, but don't trade now. Relax." },
  { status: "PEACE OF MIND", actionBn: "সেশনটি অফ করে মনে প্রশান্তি আনুন।", adviceBn: "Close trades for peace of mind. মানসিক স্বাস্থ্য জরুরি।", actionEn: "Turn off the session and find peace of mind.", adviceEn: "Close trades for peace of mind. Mental health matters." },
  { status: "DON'T OVERTRADE", actionBn: "লস হয়েছে বলে বারবার ট্রেড দেবেন না।", adviceBn: "You have time to recover later. তাড়াহুড়ো করবেন না।", actionEn: "Don't keep re-entering trades just because you lost.", adviceEn: "You have time to recover later. Don't rush." },
  { status: "MARKET WINS", actionBn: "আজ মার্কেটকে তার পাওনা দিয়ে দিন।", adviceBn: "Let the market win today. You win tomorrow. চ্যাম্পিয়নরা থামে।", actionEn: "Give the market its due today.", adviceEn: "Let the market win today. You win tomorrow. Champions know when to stop." },
  { status: "FINAL WARNING", actionBn: "একদমই আর কোনো ট্রেড নয়। স্টপ।", adviceBn: "Absolute stop. Do not enter any trade! মূলধন বাঁচান।", actionEn: "Absolutely no more trades. Stop.", adviceEn: "Absolute stop. Do not enter any trade! Protect your capital." },
];

function buildStatusTemplate(item: StatusItem, s: string, e: string, p: string, emoji: string, lang: Lang): string {
  const action = lang === "en" ? item.actionEn : item.actionBn;
  const advice = lang === "en" ? item.adviceEn : item.adviceBn;
  return `╔════════════════════╗\n     STATUS: ${item.status} ${emoji}\n╚════════════════════╝\n━━━━━━━━━━━━━━━━━━━━━\n➤ CAPITAL DATA:\n   ▸ Start: $${s}\n   ▸ End:   $${e} (${p})\n\n➤ ACTION PLAN:\n   ▸ ${action}\n➤ ADVICE:\n   ▸ ${advice}\n━━━━━━━━━━━━━━━━━━━━━`;
}

function getWinTemplates(s: string, e: string, p: string, lang: Lang = "bn"): string[] {
  return WIN_ITEMS.map((item) => buildStatusTemplate(item, s, e, p, "✅", lang));
}

function getLossTemplates(s: string, e: string, p: string, lang: Lang = "bn"): string[] {
  return LOSS_ITEMS.map((item) => buildStatusTemplate(item, s, e, p, "⚠️", lang));
}

interface OffDayItem {
  adviceBn: string;
  adviceEn: string;
  emoji: string;
}

const OFFDAY_ITEMS: OffDayItem[] = [
  { adviceBn: "মার্কেট আজ বন্ধ, নিজের ব্রেনকে রিচার্জ করার সুযোগ দিন।", adviceEn: "The market is closed today — give your brain a chance to recharge.", emoji: "✨" },
  { adviceBn: "গত সপ্তাহের ভুলগুলো থেকে শিক্ষা নিন।", adviceEn: "Learn from last week's mistakes.", emoji: "🔋" },
  { adviceBn: "আজ চার্ট দেখা একদম বন্ধ রাখুন।", adviceEn: "Keep the charts completely closed today.", emoji: "☕" },
  { adviceBn: "গোল্ডের সাপোর্ট-রেজিস্ট্যান্সগুলো একবার চোখ বুলিয়ে নিন।", adviceEn: "Take a look at gold's support and resistance levels.", emoji: "📈" },
  { adviceBn: "প্রফিট যাই হোক, আজ পরিবারকে সময় দিন।", adviceEn: "Whatever the profit, give time to family today.", emoji: "❤️" },
  { adviceBn: "অতিরিক্ত চিন্তা করবেন না, মার্কেট কোথাও পালিয়ে যাচ্ছে না।", adviceEn: "Don't overthink — the market isn't going anywhere.", emoji: "😴" },
  { adviceBn: "ছোট লটে সন্তুষ্ট থাকতে শেখাই প্রো-ট্রেডারের লক্ষণ।", adviceEn: "Learning to be content with small lots is the mark of a pro trader.", emoji: "💎" },
  { adviceBn: "নিজের অ্যানালাইসিসের ওপর শতভাগ বিশ্বাস রাখুন।", adviceEn: "Trust your own analysis 100%.", emoji: "🪄" },
  { adviceBn: "রিভেঞ্জ ট্রেডিং থেকে দূরে থাকার প্রতিজ্ঞা করুন।", adviceEn: "Promise yourself to stay away from revenge trading.", emoji: "🌱" },
  { adviceBn: "নেগেটিভ চিন্তাগুলো মন থেকে মুছে ফেলুন।", adviceEn: "Clear negative thoughts from your mind.", emoji: "🎁" },
  { adviceBn: "মনে রাখবেন, ক্যাপিটাল রক্ষা করাই আপনার প্রথম কাজ।", adviceEn: "Remember, protecting your capital is your first job.", emoji: "🛡️" },
  { adviceBn: "গোল্ডের অস্থিরতা আজ থাক, আপনি শান্ত থাকুন।", adviceEn: "Let gold's volatility be — you stay calm.", emoji: "🪙" },
  { adviceBn: "সাকসেসফুল ট্রেডার হতে হলে বিরতি নিতে জানতে হয়।", adviceEn: "To become a successful trader, you must know how to take breaks.", emoji: "💪" },
  { adviceBn: "মানি ম্যানেজমেন্ট ইজ দ্য কি টু সাকসেস।", adviceEn: "Money management is the key to success.", emoji: "🧘‍♂️" },
  { adviceBn: "সপ্তাহ শেষে কৃতজ্ঞতা প্রকাশ করুন।", adviceEn: "Express gratitude at the end of the week.", emoji: "😊" },
  { adviceBn: "স্ক্রিন টাইম কমিয়ে আজ নিজের হবির জন্য সময় দিন।", adviceEn: "Cut down screen time and give time to your hobby today.", emoji: "📈" },
  { adviceBn: "ট্রেডিংয়ের চাপ আজ একদম ভুলে যান।", adviceEn: "Forget all trading stress today.", emoji: "🍿" },
  { adviceBn: "নিজের সেটআপের জন্য অপেক্ষা করার ধৈর্য সঞ্চয় করুন।", adviceEn: "Save up the patience to wait for your own setup.", emoji: "🎯" },
  { adviceBn: "অন্যের সিগন্যাল নয়, নিজের বুদ্ধিতে ট্রেড করতে শিখুন।", adviceEn: "Learn to trade on your own judgment, not someone else's signal.", emoji: "🛡️" },
  { adviceBn: "কালকের গ্যাপ ওপেনিং নিয়ে এখনই টেনশন করবেন না।", adviceEn: "Don't stress about tomorrow's gap opening right now.", emoji: "🌤️" },
  { adviceBn: "শরীর সুস্থ না থাকলে ট্রেডিংয়ে ভুল হওয়ার সম্ভাবনা বাড়ে।", adviceEn: "If your body isn't healthy, mistakes in trading become more likely.", emoji: "💗" },
  { adviceBn: "ফরেক্স মার্কেট ধৈর্যের পরীক্ষা নেয়, আবেগের নয়।", adviceEn: "The forex market tests patience, not emotion.", emoji: "✅" },
  { adviceBn: "আজকের এই বিরতিই আপনার আগামী সপ্তাহের শক্তি।", adviceEn: "Today's break is your strength for next week.", emoji: "🙏" },
  { adviceBn: "ভুল ট্রেডগুলো ডায়েরিতে লিখে রাখুন।", adviceEn: "Write down your bad trades in your journal.", emoji: "🏆" },
  { adviceBn: "ট্রেডিং জার্নিতে কোনো শর্টকাট নেই, আজ রিল্যাক্স করুন।", adviceEn: "There are no shortcuts in the trading journey — relax today.", emoji: "🚶‍♂️" },
  { adviceBn: "লসের পরে প্রফিটও আসবে। দেখা হবে ইনশাআল্লাহ।", adviceEn: "Profit will come after loss too. See you soon, God willing.", emoji: "🕯️" },
];

function getOffDayTemplates(date: string, lang: Lang = "bn"): string[] {
  const f = "\n░░░░░░░░░░░░░░░░░░░░░░░\n#TradingLife #HappyWeekend 🩵";
  return OFFDAY_ITEMS.map((item) => {
    const advice = lang === "en" ? item.adviceEn : item.adviceBn;
    return `░░░░░░░░ OFF DAY ░░░░░░░░\n● DATE: ${date}\n● ADVICE: ${advice} ${item.emoji}` + f;
  });
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
      await sendDailyRecap(tg.userId, tg.botToken, tg.chatId, tg.groupId, today, (tg.notifyLanguage as Lang) || "bn");
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
  lang: Lang = "bn",
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
    await sendToUser(botToken, chatId, groupId, pick(getOffDayTemplates(fullDateStr, lang)));
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
  const notifyLang = (tg.notifyLanguage as Lang) || "bn";
  if (growthPct >= winThreshold && growthBefore < winThreshold) {
    const msg = pick(getWinTemplates(startText, currentText, pText, notifyLang));
    await broadcastTelegramMessage(tg.botToken, tg.chatId, tg.groupId, msg);
    await saveNotificationForUser(userId, "win_alert", `✅ Win Alert — Target Hit! (${pText})`, msg);
  } else if (growthPct <= -Math.abs(lossThreshold) && growthBefore > -Math.abs(lossThreshold)) {
    const msg = pick(getLossTemplates(startText, currentText, pText, notifyLang));
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
