import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Search } from "lucide-react";
import { AssetCard, EmptyState, PageHeader, Surface } from "@/components/app/shared";
import { AssessmentSummaryLine, CandidateAssessmentPanel } from "@/components/app/candidate-assessment";
import { CandidateGuidancePanel, GuidanceSummary } from "@/components/app/candidate-guidance";
import type { CandidateResult } from "@/services/types";

function label(value: string) {
  return value.replaceAll("_", " ");
}

function Evidence({ value }: { value: unknown }) {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, i) => <li key={i}><Evidence value={item} /></li>)}</ul>;
  if (typeof value === "object") return <dl className="space-y-1">{Object.entries(value).map(([key, item]) => (
    <div key={key} className="min-w-0"><dt className="text-xs capitalize text-muted-foreground">{label(key)}</dt><dd className="break-words"><Evidence value={item} /></dd></div>
  ))}</dl>;
  return <span className="break-words">{String(value)}</span>;
}

export function CandidateResults({ result }: { result: CandidateResult }) {
  const title = result.status === "candidates_found" ? "Matching assets found" : result.status === "no_matches" ? "No matching assets found" : "Clarification needed";
  return <div className="space-y-5">
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Ask AI</Link>
    <PageHeader title={title} />
    <Surface>
      <p className="text-xs font-semibold uppercase text-muted-foreground">Your question</p>
      <p className="mt-2 break-words">{result.question}</p>
      <p className="mt-3 text-sm text-muted-foreground">Prototype assessment: <span className="font-semibold text-foreground"><AssessmentSummaryLine summary={result.assessment_summary} /></span>. Not a governance decision.</p>
      <GuidanceSummary summary={result.reuse_guidance_summary} />
    </Surface>
    {result.clarification_questions.length > 0 && <section><h2 className="mb-2 text-lg font-semibold">Clarification questions</h2><ul className="list-disc space-y-2 pl-5 text-sm">{result.clarification_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></section>}
    {result.unresolved_terms != null && <details className="text-sm"><summary className="cursor-pointer font-semibold">Unresolved terms</summary><div className="mt-2"><Evidence value={result.unresolved_terms} /></div></details>}
    {result.warnings.length > 0 && <section className="border-l-2 border-warning pl-4"><h2 className="mb-2 flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="h-4 w-4" /> Warnings & limitations</h2><ul className="list-disc space-y-2 pl-5 text-sm">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}
    {result.status === "no_matches" && <EmptyState icon={<Search className="h-5 w-5" />} title="No candidates returned" text="No matching assets were returned for these criteria. Governance has not been evaluated." />}
    {result.status === "candidates_found" && <section className="space-y-4">
      <p className="text-sm text-muted-foreground">Showing {result.count}{result.total_candidates != null ? ` of ${result.total_candidates} candidates found for this question` : " candidates"} · Limit {result.limit}</p>
      <p className="text-xs text-muted-foreground">Ranked by metadata relevance, not confidence or trust. Prototype assessments are advisory and do not change the ranking.</p>
      {result.score_description && <p className="text-xs text-muted-foreground">{result.score_description}</p>}
      {result.candidates.map((candidate) => <article key={candidate.asset.id} className="space-y-3 border-b pb-5">
        <AssetCard asset={candidate.asset} mode="live" />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><h3 className="font-semibold">Relevance explanations</h3><span className="font-semibold text-primary">{candidate.match_score}/100 metadata relevance</span></div>
        <ul className="list-disc space-y-1 pl-5 text-sm">{candidate.match_reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Scope matches</summary><div className="mt-2"><Evidence value={candidate.scope_matches} /></div></details>
        {[["Missing products", candidate.missing_products], ["Missing markets", candidate.missing_markets], ["Missing metrics", candidate.missing_metrics]].map(([name, values]) => Array.isArray(values) && values.length > 0 && <section key={String(name)} className="text-sm"><h4 className="mb-1 font-semibold text-warning">{String(name)}</h4><Evidence value={values} /></section>)}
        <section aria-label="Prototype assessment"><CandidateAssessmentPanel assessment={candidate.assessment} /></section>
         <CandidateGuidancePanel guidance={candidate.reuse_guidance} />
        {candidate.matched_kpis.length > 0 && <details className="text-sm" open><summary className="cursor-pointer font-semibold">Matched KPIs & actual statuses</summary><div className="mt-2 space-y-3"><Evidence value={candidate.matched_kpis} /></div></details>}
      </article>)}
    </section>}
    <details className="text-sm"><summary className="cursor-pointer font-semibold">Extracted & normalized intent</summary><div className="mt-3 grid gap-4 md:grid-cols-2"><Evidence value={result.extracted_intent} /><Evidence value={result.normalized_intent} /></div></details>
  </div>;
}