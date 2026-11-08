import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsAsset, AssetMode, AssetStatus, Decision } from "@/services/types";

const decisionStyles: Record<Decision, string> = {
  REUSE: "bg-success/15 text-success border-success/30",
  CONSOLIDATE: "bg-info/15 text-info border-info/30",
  MIGRATE: "bg-warning/15 text-warning border-warning/30",
  RETIRE: "bg-destructive/12 text-destructive border-destructive/30",
  BUILD_NEW: "bg-primary/12 text-primary border-primary/30",
  HUMAN_REVIEW: "bg-muted text-foreground border-border",
};

export function DecisionBadge({ decision, large }: { decision: Decision; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold tracking-wide",
        large ? "px-4 py-1.5 text-sm" : "px-2.5 py-0.5 text-[11px]",
        decisionStyles[decision],
      )}
    >
      {decision.replace("_", " ")}
    </span>
  );
}

const statusStyles: Record<AssetStatus, string> = {
  active: "bg-success/15 text-success",
  deprecated: "bg-destructive/12 text-destructive",
  draft: "bg-muted text-muted-foreground",
  under_review: "bg-warning/15 text-warning",
};

export function StatusPill({ status }: { status: AssetStatus }) {
  return (
    <span className={cn("max-w-full shrink-0 break-words rounded-full px-2 py-0.5 text-[11px] font-medium", statusStyles[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning", className)}>
      <FlaskConical className="h-3 w-3" /> Demo data
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Surface({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card p-4 shadow-card md:p-5", className)}>{children}</div>;
}

export function KpiTag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">{children}</span>;
}

export function AssetCard({ asset, mode = "live" }: { asset: AnalyticsAsset; mode?: AssetMode }) {
  return (
    <Link
      to="/assets/$id"
      params={{ id: asset.id }}
      search={{ mode }}
      className="block min-w-0 rounded-2xl border bg-card p-4 shadow-card transition active:scale-[0.99] hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-semibold text-foreground">{asset.name}</h3>
        {asset.status && <StatusPill status={asset.status} />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {[asset.platform, asset.owner].filter(Boolean).join(" · ")}
      </p>
      <dl className="mt-3 space-y-1 break-words text-xs">
        {[["Endorsement", asset.endorsement], ["Product scope", asset.productScope], ["Market scope", asset.marketScope]].map(([label, value]) => value != null && (
          <div key={label}><dt className="inline text-muted-foreground">{label}: </dt><dd className="inline text-foreground">{value}</dd></div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {asset.kpis?.map((k) => (
          <KpiTag key={k}>{k}</KpiTag>
        ))}
      </div>
    </Link>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed bg-card/50 px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-accent p-3 text-accent-foreground">{icon}</div>
      <h3 className="font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
