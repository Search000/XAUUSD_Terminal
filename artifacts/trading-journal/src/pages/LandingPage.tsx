import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Activity, ShieldCheck, Zap, BarChart2 } from "lucide-react";
import { ActiveOfferPopup } from "@/components/ActiveOfferPopup";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center selection:bg-primary/20 selection:text-primary">
      {/* Navbar */}
      <nav className="w-full border-b border-white/5 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold tracking-tight text-xl">
            <Activity className="w-6 h-6" />
            <span>XAUUSD</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground font-medium transition-colors">
              Sign In
            </Link>
            <Link href="/sign-up" className="text-sm bg-primary/10 text-primary hover:bg-primary/20 px-4 py-2 rounded font-medium transition-colors border border-primary/20">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-4 py-16 flex flex-col items-center text-center max-w-4xl relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none -z-10" />
        
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono uppercase tracking-widest mb-8">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          Terminal Online
        </div>
        
        <h1 className="text-5xl md:text-7xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-white/50 mb-6">
          The ultimate terminal for <br/> <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-600">Gold Traders</span>.
        </h1>
        
        <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl leading-relaxed">
          No fluff. No noise. Just the data you need to dominate XAUUSD. A professional-grade journal designed for the exact demands of precision gold trading.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link href="/sign-up" className="inline-flex items-center justify-center px-8 py-4 bg-primary text-black font-semibold rounded hover:bg-amber-400 transition-colors shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_30px_rgba(245,158,11,0.5)]">
            Deploy Terminal <Activity className="ml-2 w-5 h-5" />
          </Link>
          <a href="#features" className="inline-flex items-center justify-center px-8 py-4 bg-secondary text-foreground font-semibold rounded hover:bg-secondary/80 transition-colors">
            View Capabilities
          </a>
        </div>
      </section>

      {/* Stats preview / Social Proof */}
      <div className="w-full border-y border-white/5 bg-white/[0.02]">
        <div className="container mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-white/5 text-center">
          <div>
            <div className="text-3xl font-mono font-bold text-white mb-1">0ms</div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Latency</div>
          </div>
          <div>
            <div className="text-3xl font-mono font-bold text-white mb-1">100%</div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Data Ownership</div>
          </div>
          <div>
            <div className="text-3xl font-mono font-bold text-white mb-1">256-bit</div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-widest">Encryption</div>
          </div>
          <div>
            <div className="text-3xl font-mono font-bold text-primary mb-1">XAUUSD</div>
            <div className="text-xs font-mono text-primary/70 uppercase tracking-widest">Laser Focus</div>
          </div>
        </div>
      </div>

      {/* Features */}
      <section id="features" className="container mx-auto px-4 py-16 max-w-5xl">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white mb-4">Precision Engineering</h2>
          <p className="text-muted-foreground">Built exactly for the volatility and opportunity of gold.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-6 rounded-lg bg-card border border-border flex flex-col">
            <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center mb-6 text-primary">
              <BarChart2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Automated PnL</h3>
            <p className="text-muted-foreground text-sm flex-1">Instant calculation of risk, reward, and pip values tailored specifically for the XAUUSD contract specification.</p>
          </div>
          
          <div className="p-6 rounded-lg bg-card border border-border flex flex-col relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center mb-6 text-primary relative z-10">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2 relative z-10">Telegram Integration</h3>
            <p className="text-muted-foreground text-sm flex-1 relative z-10">Push live trade alerts, daily recaps, and drawdown warnings directly to your phone or investor group.</p>
          </div>
          
          <div className="p-6 rounded-lg bg-card border border-border flex flex-col">
            <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center mb-6 text-primary">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Investor Portals</h3>
            <p className="text-muted-foreground text-sm flex-1">Track external capital. Automatically split PnL, calculate performance fees, and generate clean reports for your backers.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full border-t border-white/5 py-12 mt-auto text-center">
        <div className="text-primary font-bold flex items-center justify-center gap-2 mb-4">
          <Activity className="w-5 h-5" /> XAUUSD Terminal
        </div>
        <p className="text-sm text-muted-foreground font-mono">
          © {new Date().getFullYear()} — Authorized Personnel Only.
        </p>
      </footer>
      <ActiveOfferPopup />
    </div>
  );
}
