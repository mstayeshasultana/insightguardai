import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, FlaskConical, HelpCircle, Info } from "lucide-react";
import { Surface } from "@/components/app/shared";
import { ASSESSMENT_LABELS, CHECK_STATUS_LABELS } from "@/services/api";
import { displayValue } from "@/components/app/asset-evidence";
import { cn } from "@/lib/utils";
import type { AssessmentCheck, AssessmentEvidence, AssessmentFinding, AssessmentStatus, AssetAssessment } from "@/services/types";

const tone: Record<AssessmentStatus, string> = {
  concern: "bg-warning/15 text-warning",
  unable_to_assess: "bg-muted text-muted-foreground",
  no_concern_detected: "bg-success/15 text-success",
};
const icon = { concern: AlertTriangle, unable_to_assess: HelpCircle, no_concern_detected: CheckCircle2 } as const;

export function StatusChip({ status }: { status: AssessmentStatus }) {
  const Icon = icon[status] ?? HelpCircle;
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", tone[status] ?? tone.unable_to_assess)}>
      <Icon className="h-3 w-3 shrink-0" /> {CHECK_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function EvidenceRow({ e }: { e: AssessmentEvidence }) {
  const keys = Object.entries(e.source_reference?.keys ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(", ");
  const values = Object.entries(e.observed_values ?? {});
  return (
    <li className="rounded-lg border border-border/60 bg-background/40 p-2.5">
      <p className="break-words font-mono text-[11px] text-foreground">
        {e.source_reference ? <>{e.source_reference.table}{keys && ` · ${keys}`}</> : <span className="italic text-muted-foreground">No source reference</span>}
      </p>
      {e.availability !== "available" && <p className="mt-1 text-[11px] font-medium text-warning">Availability: {e.availability.replace(/_/g, " ")}</p>}
      {values.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
          {values.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="inline text-muted-foreground">{k.replace(/_/g, " ")}: </dt>
              <dd className="inline break-words text-foreground">{displayValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Finding({ f }: { f: AssessmentFinding }) {
  return (
    <div className="space-y-2 border-t border-border/60 pt-3 first:border-0 first:pt-0">
      <StatusChip status={f.status} />
      <p className="text-sm text-foreground">{f.explanation}</p>
      {f.suggested_action && (
        <p className="rounded-lg bg-accent/40 px-2.5 py-1.5 text-xs text-foreground"><span className="font-medium">Suggested action: </span>{f.suggested_action}</p>
      )}
      {f.evidence.length > 0 && <ul className="space-y-1.5">{f.evidence.map((e, i) => <EvidenceRow key={i} e={e} />)}</ul>}
    </div>
  );
}

export function CheckCard({ check }: { check: AssessmentCheck }) {
  const [open, setOpen] = useState(check.status !== "no_concern_detected");
  return (
    <Surface className="p-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start justify-between gap-3 p-4 text-left">
        <div className="min-w-0 space-y-1.5">
          <h3 className="font-semibold text-foreground">{check.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <StatusChip status={check.status} />
            {!check.evidence_complete && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Evidence incomplete</span>}
          </div>
          <p className="text-xs text-muted-foreground">{check.findings.length} finding{check.findings.length === 1 ? "" : "s"}</p>
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4">
          {check.findings.length ? check.findings.map((f, i) => <Finding key={`${f.code}-${i}`} f={f} />) : <p className="text-sm italic text-muted-foreground">No findings returned for this check.</p>}
        </div>
      )}
    </Surface>
  );
}

export function AssetAssessmentSection({ assessment: a }: { assessment: AssetAssessment }) {
  const overall: AssessmentStatus = a.assessment_status === "review_required" ? "concern" : a.assessment_status;
  return (
    <section className="space-y-4" aria-labelledby="prototype-assessment">
      <Surface>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><FlaskConical className="h-3 w-3" /> Limited assessment</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Advisory · {a.policy_version}</span>
        </div>
        <h2 id="prototype-assessment" className="mt-3 text-lg font-semibold text-foreground">Prototype assessment</h2>
        <p className={cn("mt-1 text-base font-semibold", overall === "concern" ? "text-warning" : overall === "no_concern_detected" ? "text-success" : "text-muted-foreground")}>
          {ASSESSMENT_LABELS[a.assessment_status]}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Of 4 checks: {a.counts.concern} with concerns, {a.counts.unable_to_assess} unable to assess, {a.counts.no_concern_detected} with no concern detected. These count checks, not issues.
        </p>
        {!a.evidence_complete && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Some evidence for these checks could not be assessed. Unknown findings are shown below.</p>
        )}
      </Surface>
      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">{a.checks.map((c) => <CheckCard key={c.rule_id} check={c} />)}</div>
      <Surface>
        <h3 className="text-sm font-semibold text-foreground">Limitations</h3>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {a.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </Surface>
    </section>
  );
}
