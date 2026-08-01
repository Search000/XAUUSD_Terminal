import { Link } from "wouter";
import { ActiveOfferPopup } from "@/components/ActiveOfferPopup";

const LANDING_CSS = `
  .lp-root{
    --bg:#07080A; --card:#0C0E10; --card2:#111316; --border:rgba(255,255,255,.065);
    --border-hi:rgba(245,166,35,.35);
    --gold:#F5A623; --gold-dim:rgba(245,166,35,.14);
    --text:#EDEDEE; --muted:#75787D; --muted2:#4E5155; --pos:#2ECC71; --neg:#EF5350;
    background:
      radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(245,166,35,.06), transparent 60%),
      var(--bg);
    background-attachment:fixed;
    color:var(--text);font-family:'Inter',sans-serif;font-size:14px;-webkit-font-smoothing:antialiased;
    min-height:100vh;
  }
  .lp-root *{box-sizing:border-box;}
  .lp-root .mono{font-family:'JetBrains Mono',monospace;}
  .lp-root a{transition:.15s;}

  .lp-ticker{background:#000;border-bottom:1px solid var(--border);overflow:hidden;white-space:nowrap;padding:7px 0;}
  .lp-ticker-inner{display:inline-block;animation:lp-scroll 34s linear infinite;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.01em;}
  .lp-ticker-inner:hover{animation-play-state:paused;}
  .lp-ticker-inner span{margin-right:40px;color:var(--muted);}
  .lp-ticker-inner span::before{content:'●';font-size:6px;color:var(--muted2);margin-right:8px;vertical-align:middle;}
  .lp-ticker-inner b{color:var(--pos);font-weight:600;}
  .lp-ticker-inner b.d{color:var(--neg);}
  @keyframes lp-scroll{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}

  .lp-nav{border-bottom:1px solid var(--border);background:rgba(12,14,16,.9);backdrop-filter:blur(14px);position:sticky;top:0;z-index:30;}
  .lp-wrap{max-width:1240px;margin:0 auto;padding:0 28px;}
  .lp-nav .lp-wrap{height:56px;display:flex;align-items:center;justify-content:space-between;}
  .lp-brand{font-weight:800;font-size:14px;letter-spacing:-.01em;display:flex;align-items:center;gap:9px;}
  .lp-brand .sq{width:8px;height:8px;background:var(--gold);box-shadow:0 0 12px rgba(245,166,35,.6);}
  .lp-navlinks{display:flex;gap:26px;align-items:center;font-size:12.5px;color:var(--muted);}
  .lp-navlinks a{color:inherit;text-decoration:none;}
  .lp-navlinks a:hover{color:var(--text);}
  .lp-status{display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--pos);}
  .lp-status .dot{width:6px;height:6px;border-radius:50%;background:var(--pos);animation:lp-pulse 1.8s infinite;}
  @keyframes lp-pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .lp-cta{background:var(--gold);color:#08090A;padding:8px 16px;font-weight:700;font-size:11.5px;border-radius:3px;text-decoration:none;letter-spacing:.01em;}
  .lp-cta:hover{background:#ffb43d;}

  .lp-shell{display:grid;grid-template-columns:220px 1fr;max-width:1240px;margin:0 auto;}
  .lp-sidebar{border-right:1px solid var(--border);padding:28px 0;position:sticky;top:56px;align-self:start;height:calc(100vh - 56px);}
  .lp-sidebar .grp{padding:0 20px;margin-bottom:26px;}
  .lp-sidebar .grp .h{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted2);margin-bottom:10px;}
  .lp-sidebar .item{display:flex;justify-content:space-between;padding:7px 0;font-size:12.5px;color:var(--muted);border-bottom:1px solid transparent;cursor:default;}
  .lp-sidebar .item.active{color:var(--gold);}

  .lp-main{padding:0 28px;}

  .lp-hero{padding:52px 0 0;}
  .lp-herotop{display:grid;grid-template-columns:1.2fr .8fr;gap:48px;align-items:center;margin-bottom:32px;}
  .lp-kicker{display:inline-flex;align-items:center;gap:8px;font-size:10.5px;text-transform:uppercase;letter-spacing:.14em;color:var(--gold);margin-bottom:18px;font-weight:600;}
  .lp-kicker::before{content:'';width:14px;height:1px;background:var(--gold);}
  .lp-root h1{font-size:38px;font-weight:800;letter-spacing:-.025em;line-height:1.08;margin-bottom:16px;}
  .lp-root h1 span{color:var(--gold);}
  .lp-sub{color:var(--muted);font-size:14px;line-height:1.65;max-width:440px;margin-bottom:26px;}
  .lp-btnrow{display:flex;gap:12px;}
  .lp-btn-primary{background:var(--gold);color:#08090A;padding:12px 22px;font-weight:700;font-size:13px;border-radius:4px;text-decoration:none;box-shadow:0 8px 24px -6px rgba(245,166,35,.35);display:inline-block;}
  .lp-btn-primary:hover{background:#ffb43d;}
  .lp-btn-secondary{border:1px solid var(--border);color:var(--text);padding:12px 22px;font-weight:600;font-size:13px;border-radius:4px;text-decoration:none;display:inline-block;}
  .lp-btn-secondary:hover{border-color:var(--border-hi);}

  .lp-heropanel{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);}
  .lp-hp-top{display:flex;justify-content:space-between;font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);}
  .lp-hp-row{display:flex;justify-content:space-between;padding:8px 0;font-size:12.5px;border-bottom:1px solid var(--border);}
  .lp-hp-row:last-child{border:none;}
  .lp-hp-row .v{font-family:'JetBrains Mono',monospace;font-weight:700;}
  .lp-hp-row .v.pos{color:var(--pos);} .lp-hp-row .v.gold{color:var(--gold);}

  .lp-termgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
  .lp-tp{background:var(--card);padding:16px;transition:.15s;}
  .lp-tp:hover{background:var(--card2);}
  .lp-tp .t{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted2);margin-bottom:7px;}
  .lp-tp .v{font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:700;}
  .lp-tp .v.up{color:var(--pos);} .lp-tp .v.down{color:var(--neg);}
  .lp-tp .d{font-size:10px;color:var(--muted);margin-top:4px;}

  .lp-root section{padding:56px 0;border-bottom:1px solid var(--border);}
  .lp-sechead{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px;}
  .lp-sechead h2{font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--text);font-weight:700;}
  .lp-sechead .n{font-size:10.5px;color:var(--muted2);font-family:'JetBrains Mono',monospace;}

  .lp-fgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
  .lp-fcard{background:var(--card);padding:22px;transition:.15s;}
  .lp-fcard:hover{background:var(--card2);}
  .lp-fcard .tag{font-size:9.5px;color:var(--gold);font-family:'JetBrains Mono',monospace;margin-bottom:12px;letter-spacing:.03em;}
  .lp-fcard h3{font-size:13.5px;font-weight:700;margin-bottom:8px;}
  .lp-fcard p{font-size:11.8px;color:var(--muted);line-height:1.62;}

  .lp-splitpanel{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden;}
  .lp-panel{background:var(--card);padding:26px;}
  .lp-panel .lbl{font-size:10px;color:var(--muted2);text-transform:uppercase;letter-spacing:.1em;margin-bottom:18px;font-weight:600;}
  .lp-datarow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12.5px;}
  .lp-datarow:last-child{border:none;}
  .lp-datarow .k{color:var(--muted);}
  .lp-datarow .v{font-family:'JetBrains Mono',monospace;font-weight:600;}

  .lp-grade-block{display:flex;align-items:center;gap:20px;padding-bottom:18px;margin-bottom:4px;border-bottom:1px solid var(--border);}
  .lp-ring{width:60px;height:60px;border-radius:50%;border:3px solid var(--gold);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 20px rgba(245,166,35,.15) inset;}
  .lp-ring .g{font-family:'JetBrains Mono',monospace;font-weight:800;color:var(--gold);font-size:17px;}

  .lp-faqlist{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--card);}
  .lp-faqitem{border-bottom:1px solid var(--border);}
  .lp-faqitem:last-child{border-bottom:none;}
  .lp-faqitem summary{list-style:none;cursor:pointer;padding:16px 20px;font-size:13.5px;font-weight:600;display:flex;justify-content:space-between;align-items:center;}
  .lp-faqitem summary::-webkit-details-marker{display:none;}
  .lp-faqitem summary::after{content:'+';color:var(--gold);font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:400;margin-left:12px;}
  .lp-faqitem[open] summary::after{content:'–';}
  .lp-faqitem summary:hover{background:var(--card2);}
  .lp-faqitem p{padding:0 20px 18px;font-size:12.5px;color:var(--muted);line-height:1.65;max-width:640px;}

  .lp-footer{padding:26px 0;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;}

  @media (max-width: 900px){
    .lp-shell{grid-template-columns:1fr;}
    .lp-sidebar{display:none;}
    .lp-herotop{grid-template-columns:1fr;}
    .lp-termgrid{grid-template-columns:repeat(3,1fr);}
    .lp-fgrid{grid-template-columns:repeat(2,1fr);}
    .lp-splitpanel{grid-template-columns:1fr;}
  }
`;

const LICENSE_PRICE = "$49";
const LICENSE_DURATION = "30-day";

export default function LandingPage() {
  return (
    <div className="lp-root">
      <style>{LANDING_CSS}</style>

      {/* Ticker */}
      <div className="lp-ticker">
        <div className="lp-ticker-inner">
          {Array.from({ length: 2 }).map((_, i) => (
            <span key={i} style={{ display: "contents" }}>
              <span>XAU/USD <b>2,412.85 ▲0.42%</b></span>
              <span>DXY <b className="d">104.21 ▼0.18%</b></span>
              <span>10Y YIELD <b className="d">4.28% ▼0.02</b></span>
              <span>COT NET LONGS <b>+218K</b></span>
              <span>FEAR/GREED <b>62 GREED</b></span>
              <span>SESSION <b>LONDON OPEN</b></span>
              <span>FED FUNDS <b>5.25%</b></span>
              <span>ATR(14) <b>14.6</b></span>
            </span>
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-wrap">
          <div className="lp-brand"><span className="sq" />XAUUSD_TERMINAL</div>
          <div className="lp-navlinks">
            <a href="#pricing">Pricing</a>
            <Link href="/sign-in">Sign In</Link>
            <div className="lp-status"><span className="dot" />LIVE</div>
            <Link href="/sign-up" className="lp-cta">GET ACCESS</Link>
          </div>
        </div>
      </nav>

      <div className="lp-shell">
        <aside className="lp-sidebar">
          <div className="grp">
            <div className="h">Journal</div>
            <div className="item active">Execution</div>
            <div className="item">Trades</div>
            <div className="item">Mistake Log</div>
          </div>
          <div className="grp">
            <div className="h">Performance</div>
            <div className="item">Score</div>
            <div className="item">Reports</div>
          </div>
          <div className="grp">
            <div className="h">Market</div>
            <div className="item">XAUUSD Monitor</div>
            <div className="item">Correlations</div>
          </div>
          <div className="grp">
            <div className="h">Capital</div>
            <div className="item">Investors</div>
          </div>
          <div className="grp">
            <div className="h">Account</div>
            <div className="item">Pricing</div>
          </div>
        </aside>

        <main className="lp-main">
          <section className="lp-hero" style={{ borderBottom: "none" }}>
            <div className="lp-herotop">
              <div>
                <div className="lp-kicker">Institutional-grade, one instrument</div>
                <h1>The terminal serious <span>gold traders</span> run.</h1>
                <p className="lp-sub">Auto-calc trade log, discipline scoring, investor accounting and 20+ live XAUUSD macro panels — deployed as one system, not six tabs.</p>
                <div className="lp-btnrow">
                  <Link href="/sign-up" className="lp-btn-primary">DEPLOY TERMINAL →</Link>
                  <a href="#modules" className="lp-btn-secondary">VIEW MODULES</a>
                </div>
              </div>
              <div className="lp-heropanel">
                <div className="lp-hp-top"><span>XAU/USD · LONG</span><span>WK31_2026</span></div>
                <div className="lp-hp-row"><div>Entry / SL / TP</div><div className="v">2411.2 / 2406.5 / 2420.0</div></div>
                <div className="lp-hp-row"><div>Lot Size</div><div className="v">0.35</div></div>
                <div className="lp-hp-row"><div>Pips</div><div className="v pos">+88.0</div></div>
                <div className="lp-hp-row"><div>PnL</div><div className="v pos">+$308.00</div></div>
                <div className="lp-hp-row"><div>Weekly Grade</div><div className="v gold">B+</div></div>
              </div>
            </div>

            <div className="lp-termgrid">
              <div className="lp-tp"><div className="t">Spot</div><div className="v up">2,412.85</div><div className="d">+0.42%</div></div>
              <div className="lp-tp"><div className="t">Fed Funds</div><div className="v">5.25%</div><div className="d">Unchanged</div></div>
              <div className="lp-tp"><div className="t">DXY Corr</div><div className="v down">-0.81</div><div className="d">30D</div></div>
              <div className="lp-tp"><div className="t">ATR(14)</div><div className="v">14.6</div><div className="d">Elevated</div></div>
              <div className="lp-tp"><div className="t">COT Net</div><div className="v up">+218K</div><div className="d">Contracts</div></div>
              <div className="lp-tp"><div className="t">Fear/Greed</div><div className="v" style={{ color: "var(--gold)" }}>62</div><div className="d">Greed</div></div>
            </div>
          </section>

          <section id="modules">
            <div className="lp-sechead"><h2>Module Index</h2><div className="n">08 ACTIVE</div></div>
            <div className="lp-fgrid">
              <div className="lp-fcard"><div className="tag">AUTO CALC</div><h3>Auto PnL Engine</h3><p>Entry/SL/TP resolve lot size, pips, direction and PnL instantly against real XAUUSD spec.</p></div>
              <div className="lp-fcard"><div className="tag">JOURNAL</div><h3>Execution Log</h3><p>Every trade recorded with session, tags and screenshots — searchable, filterable, exportable.</p></div>
              <div className="lp-fcard"><div className="tag">JOURNAL</div><h3>Mistake Journal</h3><p>Tag every loss — FOMO, revenge trade, wrong SL, news spike — aggregated monthly.</p></div>
              <div className="lp-fcard"><div className="tag">PERFORMANCE</div><h3>Discipline Score</h3><p>Weekly A–F grade on risk control, consistency and plan adherence. Achievements included.</p></div>
              <div className="lp-fcard"><div className="tag">PERFORMANCE</div><h3>Reports</h3><p>Weekly/monthly breakdowns with day-of-week heatmap. Clean month resets.</p></div>
              <div className="lp-fcard"><div className="tag">MARKET</div><h3>XAUUSD Monitor</h3><p>Fed tracker, COT, seasonality, order flow, correlations, volatility, futures curve — live.</p></div>
              <div className="lp-fcard"><div className="tag">CAPITAL</div><h3>Investor Portal</h3><p>Capital tracking, auto profit split, performance fee calc, investor-facing reports.</p></div>
              <div className="lp-fcard"><div className="tag">SYSTEM</div><h3>Telegram + License</h3><p>Live push alerts for trades and drawdowns. Per-device licensed activation.</p></div>
            </div>
          </section>

          <section>
            <div className="lp-sechead"><h2>Live Sample — Trader Score</h2><div className="n">WK31_2026</div></div>
            <div className="lp-splitpanel">
              <div className="lp-panel">
                <div className="lbl">Weekly Grade</div>
                <div className="lp-grade-block">
                  <div className="lp-ring"><div className="g">B+</div></div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Proficient</div>
                    <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 3 }}>Above-average risk control</div>
                  </div>
                </div>
                <div className="lp-datarow"><div className="k">Risk Control</div><div className="v">82 / 100</div></div>
                <div className="lp-datarow"><div className="k">Consistency</div><div className="v">70 / 100</div></div>
                <div className="lp-datarow"><div className="k">Plan Adherence</div><div className="v">64 / 100</div></div>
              </div>
              <div className="lp-panel">
                <div className="lbl">Top Loss Reasons — 30D</div>
                <div className="lp-datarow"><div className="k">Revenge Trade</div><div className="v" style={{ color: "var(--neg)" }}>×9</div></div>
                <div className="lp-datarow"><div className="k">Wrong SL</div><div className="v" style={{ color: "var(--neg)" }}>×5</div></div>
                <div className="lp-datarow"><div className="k">FOMO</div><div className="v" style={{ color: "var(--neg)" }}>×4</div></div>
                <div className="lp-datarow"><div className="k">News Spike</div><div className="v" style={{ color: "var(--neg)" }}>×2</div></div>
              </div>
            </div>
          </section>

          <section id="pricing">
            <div className="lp-sechead"><h2>Pricing</h2><div className="n">LICENSE</div></div>
            <div className="lp-splitpanel" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
              <div className="lp-panel">
                <div className="lbl">Terminal License</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                  <div className="mono" style={{ fontSize: 34, fontWeight: 800, color: "var(--gold)" }}>{LICENSE_PRICE}</div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>/ {LICENSE_DURATION} license</div>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 18 }}>One-time license code, activated per device. No auto-recurring charge.</div>
                <Link href="/sign-up" className="lp-btn-primary">Get License →</Link>
              </div>
              <div className="lp-panel">
                <div className="lbl">What's Included</div>
                <div className="lp-datarow"><div>Auto PnL Engine</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
                <div className="lp-datarow"><div>Mistake Journal</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
                <div className="lp-datarow"><div>Discipline Score</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
                <div className="lp-datarow"><div>XAUUSD Monitor (20+ panels)</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
                <div className="lp-datarow"><div>Investor Portal</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
                <div className="lp-datarow"><div>Telegram Alerts</div><div className="v" style={{ color: "var(--pos)" }}>✓</div></div>
              </div>
            </div>
          </section>

          <section id="faq">
            <div className="lp-sechead"><h2>FAQ</h2><div className="n">07 ANSWERED</div></div>
            <div className="lp-faqlist">
              <details className="lp-faqitem" open>
                <summary>How much does it cost?</summary>
                <p>Starting at <span className="mono" style={{ color: "var(--gold)", fontWeight: 700 }}>{LICENSE_PRICE}</span> for a {LICENSE_DURATION} license.</p>
              </details>
              <details className="lp-faqitem">
                <summary>Is there a free trial?</summary>
                <p>Trials aren't self-serve right now — message the admin directly and they'll set one up for you.</p>
              </details>
              <details className="lp-faqitem">
                <summary>How do I get access after paying?</summary>
                <p>Reach out via Gmail or Telegram to complete activation — you'll get your license code and be up and running the same day.</p>
              </details>
              <details className="lp-faqitem">
                <summary>Is my trade data private?</summary>
                <p>Yes. Your execution log, mistake tags and reports are tied to your account only — nothing is shared unless you explicitly invite an investor to view a report.</p>
              </details>
              <details className="lp-faqitem">
                <summary>Do I need to calculate anything manually?</summary>
                <p>No. Enter your entry, stop-loss and take-profit — lot size, pips, direction and PnL resolve instantly against the real XAUUSD contract spec.</p>
              </details>
              <details className="lp-faqitem">
                <summary>What if I run into an issue?</summary>
                <p>Support messages go straight to the admin from inside the terminal — no ticket portal, no email chain.</p>
              </details>
              <details className="lp-faqitem">
                <summary>My license is expiring — how do I renew?</summary>
                <p>Renewals go through the admin directly — message them via Gmail or Telegram before it lapses to keep your access uninterrupted.</p>
              </details>
            </div>
          </section>

          <section style={{ borderBottom: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 6, letterSpacing: "-.01em" }}>Ready to deploy?</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Licensed, per-device activation. Your trade data stays yours.</div>
              </div>
              <Link href="/sign-up" className="lp-btn-primary">DEPLOY TERMINAL →</Link>
            </div>
          </section>

          <footer className="lp-footer">
            <div>© {new Date().getFullYear()} XAUUSD_TERMINAL</div>
            <div>AUTHORIZED PERSONNEL ONLY</div>
          </footer>
        </main>
      </div>

      <ActiveOfferPopup />
    </div>
  );
}
