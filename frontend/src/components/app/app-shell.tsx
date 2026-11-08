import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Database, History, Settings, ShieldCheck, Sparkles } from "lucide-react";

const nav = [
  { to: "/", label: "Ask AI", icon: Sparkles },
  { to: "/assets", label: "Assets", icon: Database },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background bg-surface-glow">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r bg-sidebar p-5 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground"
              activeProps={{ className: "bg-sidebar-accent !text-sidebar-accent-foreground" }}
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <p className="mt-auto text-xs text-muted-foreground">Analytics governance assistant</p>
      </aside>

      <header className="sticky top-0 z-20 flex items-center border-b bg-background/80 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
      </header>

      <div className="md:pl-64">
        <main className="mx-auto max-w-4xl px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
            activeProps={{ className: "!text-primary" }}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-elegant">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="font-display text-base font-semibold text-foreground">
        InsightGuard <span className="text-primary">AI</span>
      </span>
    </Link>
  );
}
