import { AlertTriangle, Compass, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GuidanceFinding, ReuseGuidance, ReuseGuidanceSummary, SourceReference } from "@/services/types";

function SourceReferences({ references }: { references: SourceReference[] }) {
  if (!references.length) return <p className="text-xs italic text-muted-foreground">No source reference supplied.</p>;
  return <ul className="space-y-1 text-[11px] text-muted-foreground">{references.map((ref, i) => <li key={i} className="break-words font-mono">{ref.table} · {Object.entries(ref.keys ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(", ")}</li>)}</ul>;
}

function Findings({ title, findings, warning = false }: { title: string; findings: GuidanceFinding[]; warning?: boolean }) {
  if (!findings.length) return null;
  return <section className="min-w-0 space-y-2">
    <h4 className={cn("text-sm font-semibold", warning && "text-warning")}>{title}</h4>
    <ul className="space-y-3">{findings.map((finding, i) => <li key={`${finding.code}-${i}`} className="min-w-0 space-y-1 border-l-2 border-border pl-3">
      <p className="break-words text-sm">{finding.explanation}</p>
      <p className="break-words font-mono text-[11px] text-muted-foreground">{finding.code}{finding.check_id && ` · Check: ${finding.check_id}`}</p>
      {"request_values" in finding && Array.isArray(finding.request_values) && finding.request_values.length > 0 && <p className="break-words text-xs text-muted-foreground">Requested: {finding.request_values.map(String).join(", ")}</p>}
      <SourceReferences references={finding.source_references} />
    </li>)}</ul>
  </section>;
}

export function CandidateGuidancePanel({ guidance: g }: { guidance?: ReuseGuidance | undefined }) {
  return <section aria-label="Advisory next action" className="min-w-0 space-y-3 rounded-lg border border-border p-3">
    <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Compass className="h-4 w-4 shrink-0 text-primary" />Advisory next action</h3>
    {!g ? <p role="status" className="flex items-start gap-1.5 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" />Guidance unavailable for this candidate. No positive next action can be inferred.</p> : <>
      <p className={cn("flex items-start gap-1.5 break-words font-semibold", g.status === "consider_reuse_after_verification" ? "text-primary" : "text-warning")}>
        {g.status !== "consider_reuse_after_verification" && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}{g.label}
      </p>
      <p className="break-words text-sm">{g.summary}</p>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>Advisory · Prototype policy: {g.policy_version}</span><span>{g.coverage_complete ? "Recorded coverage complete" : "Recorded coverage incomplete"}</span>{!g.assessment_evidence_complete && <span className="font-semibold text-warning">Evidence incomplete</span>}</div>
      <Findings title="Coverage gaps" findings={g.coverage_gaps} warning />
      <Findings title="Unknowns & unavailable evidence" findings={g.unknowns} warning />
      <Findings title="Known concerns" findings={g.concerns} warning />
      {g.suggested_actions.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Suggested actions</h4><ul className="space-y-3">{g.suggested_actions.map((action, i) => <li key={i} className="space-y-1 border-l-2 border-primary/30 pl-3"><p className="break-words text-sm">{action.action}</p><SourceReferences references={action.source_references} /></li>)}</ul></section>}
      {g.supporting_findings.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">Supporting findings</summary><div className="mt-3"><Findings title="Limited checks with no concern detected" findings={g.supporting_findings} /></div></details>}
      {g.limitations.length > 0 && <section><h4 className="text-xs font-semibold text-muted-foreground">Limitations</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{g.limitations.map((limitation, i) => <li key={i} className="break-words">{limitation}</li>)}</ul></section>}
    </>}
  </section>;
}

export function GuidanceSummary({ summary: s }: { summary?: ReuseGuidanceSummary | undefined }) {
  if (!s || s.status === "not_applicable") return null;
  return <section className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground" aria-label="Candidate guidance outcomes">
    <h2 className="font-semibold text-foreground">Candidate guidance outcomes · returned candidates only</h2>
    <p>{s.generated_count} candidates with guidance: {s.counts.resolve_concerns_before_reuse} resolve concerns before reuse · {s.counts.clarify_or_investigate} clarify or investigate further · {s.counts.consider_reuse_after_verification} consider reuse after verification.</p>
    <p>{s.message}</p>
  </section>;
}