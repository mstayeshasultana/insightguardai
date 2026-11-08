import { FlaskConical, Info } from "lucide-react";
import { CheckCard } from "@/components/app/asset-assessment";
import { ASSESSMENT_LABELS } from "@/services/api";
import { cn } from "@/lib/utils";
import type { AssessmentSummary, CandidateAssessment } from "@/services/types";

const KPI_SCOPE = { requested_metric_families: "Requested metric families", all_linked_kpis: "All linked KPIs" } as const;

/** Advisory checks for one candidate. Deliberately separate from metadata relevance. */
export function CandidateAssessmentPanel({ assessment: a }: { assessment?: CandidateAssessment | undefined }) {
  if (!a) return <p className="text-xs text-muted-foreground">Prototype assessment: Not evaluated for this candidate.</p>;
  if (a.availability === "unavailable") {
    return (
      <div role="status" className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-foreground"><Info className="h-4 w-4" /> Prototype assessment unavailable</p>
        <p className="mt-1 text-xs text-muted-foreground">{a.message || "This does not mean no concerns were found."}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">Reason: {a.reason}</p>
      </div>
    );
  }
  const concern = a.assessment_status === "review_required";
  return (
    <details className="rounded-xl border border-border text-sm">
      <summary className="cursor-pointer space-y-1.5 p-3">
        <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><FlaskConical className="h-3 w-3" /> Prototype assessment · advisory, limited</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", concern ? "bg-warning/15 text-warning" : a.assessment_status === "no_concern_detected" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
            {ASSESSMENT_LABELS[a.assessment_status]}
          </span>
          {!a.evidence_complete && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Evidence incomplete</span>}
        </span>
        <span className="block text-xs text-muted-foreground">
          Of 4 checks: {a.counts.concern} with concerns, {a.counts.unable_to_assess} unable to assess, {a.counts.no_concern_detected} with no concern detected (checks, not issues)
          {a.kpi_scope && <> · KPI scope: {KPI_SCOPE[a.kpi_scope] ?? a.kpi_scope}{a.requested_metrics?.length ? ` (${a.requested_metrics.join(", ")})` : ""}</>}
        </span>
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <div className="grid items-start gap-3 lg:grid-cols-2 [&>*]:min-w-0">{a.checks.map((c) => <CheckCard key={c.rule_id} check={c} />)}</div>
        {a.limitations?.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}
      </div>
    </details>
  );
}

export function AssessmentSummaryLine({ summary }: { summary?: AssessmentSummary | undefined }) {
  if (!summary || summary.status === "not_applicable") return <>Not evaluated</>;
  const label = { completed: "Checks completed", partial: "Partially assessed", unavailable: "Unavailable" }[summary.status];
  return <>{label} — {summary.assessed_count} assessed, {summary.unavailable_count} unavailable (returned candidates only; advisory)</>;
}
