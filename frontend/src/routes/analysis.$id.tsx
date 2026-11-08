import { createFileRoute, Link } from "@tanstack/react-router";
import { skipToken, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionBadge, DemoBadge, KpiTag, Surface } from "@/components/app/shared";
import { api } from "@/services/api";
import { CandidateResults } from "@/components/app/candidate-results";
import type { ApiResult, AssetMode, CandidateResult } from "@/services/types";

export const Route = createFileRoute("/analysis/$id")({
  validateSearch: (search: Record<string, unknown>): { mode: AssetMode } => ({ mode: search["mode"] === "live" ? "live" : "demo" }),
  head: () => ({
    meta: [
      { title: "Asset matching result — InsightGuard AI" },
      { name: "description", content: "Candidate analytics assets, metadata relevance and coverage evidence. Governance is not evaluated." },
      { property: "og:title", content: "Asset matching result — InsightGuard AI" },
      { property: "og:description", content: "Candidate analytics assets, relevance and coverage evidence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalysisRoute,
});

function AnalysisRoute() {
  const { mode } = Route.useSearch();
  return mode === "live" ? <LiveAnalysisPage /> : <AnalysisPage />;
}

function LiveAnalysisPage() {
  const { id } = Route.useParams();
  const q = useQuery<ApiResult<CandidateResult>>({ queryKey: ["candidate-analysis", id, "live"], queryFn: skipToken, staleTime: Infinity });
  if (!q.data) return <div className="space-y-3"><h1 className="text-2xl font-semibold">Analysis result unavailable</h1><p className="text-sm text-muted-foreground">This result is no longer available in this session. Submit your question again.</p><Button asChild><Link to="/">Ask AI</Link></Button></div>;
  return <CandidateResults result={q.data.data} />;
}

function AnalysisPage() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["recommendation", id],
    // A fresh result from /analyze is placed in the cache; don't overwrite it with a refetch.
    staleTime: Infinity,
    queryFn: async () => {
      const res = await api.getRecommendations();
      return { data: res.data.find((r) => r.id === id) ?? null, isDemo: res.isDemo };
    },
  });

  const uiOnly = (label: string) => toast(`${label} — not connected yet`, { description: "This action will be wired to your backend later." });

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      {q.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      )}
      {q.isError && <p className="text-sm text-destructive">Couldn't load this analysis.</p>}
      {q.data && !q.data.data && <p className="text-sm text-muted-foreground">Analysis not found.</p>}

      {q.data?.data && (() => {
        const r = q.data.data;
        return (
          <>
            <Surface>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your request</p>
                {q.data.isDemo && <DemoBadge />}
              </div>
              <p className="text-foreground">{r.request}</p>
            </Surface>

            <Surface className="bg-surface-glow">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recommended decision</p>
              <div className="my-3"><DecisionBadge decision={r.decision} large /></div>
              <p className="text-sm leading-relaxed text-foreground">{r.explanation}</p>
            </Surface>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-foreground">Matching assets & evidence</h2>
              <div className="space-y-3">
                {r.matches.map((m) => (
                  <Surface key={m.assetId}>
                    <div className="flex items-start justify-between gap-3">
                      <Link to="/assets/$id" params={{ id: m.assetId }} search={{ mode: q.data.isDemo ? "demo" : "live" }} className="font-semibold text-foreground hover:text-primary">
                        {m.assetName}
                      </Link>
                      <span className="text-sm font-semibold text-primary">{Math.round(m.similarity * 100)}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-gradient-primary" style={{ width: `${m.similarity * 100}%` }} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-muted-foreground">Platform</dt><dd className="text-foreground">{m.platform}</dd></div>
                      <div><dt className="text-muted-foreground">Owner</dt><dd className="text-foreground">{m.owner}</dd></div>
                      <div className="col-span-2"><dt className="text-muted-foreground">Model</dt><dd className="font-mono text-foreground">{m.model ?? "—"}</dd></div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {m.matchedKpis.map((k) => <KpiTag key={k}>{k}</KpiTag>)}
                    </div>
                  </Surface>
                ))}
              </div>
            </section>

            {r.governanceWarnings.length > 0 && (
              <Surface className="border-warning/40 bg-warning/5">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning">
                  <AlertTriangle className="h-4 w-4" /> Governance warnings
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {r.governanceWarnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </Surface>
            )}

            <div className="grid grid-cols-3 gap-2">
              <Button className="h-12 gap-1.5 rounded-xl" onClick={() => uiOnly("Approve")}><Check className="h-4 w-4" />Approve</Button>
              <Button variant="outline" className="h-12 gap-1.5 rounded-xl" onClick={() => uiOnly("Reject")}><X className="h-4 w-4" />Reject</Button>
              <Button variant="secondary" className="h-12 gap-1.5 rounded-xl" onClick={() => uiOnly("Review request")}><Eye className="h-4 w-4" />Review</Button>
            </div>
          </>
        );
      })()}
    </div>
  );
}
