import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Loader2, Mic, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionBadge, DemoBadge, Surface } from "@/components/app/shared";
import { api, describeAnalyzeError } from "@/services/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ask AI — InsightGuard AI" },
      { name: "description", content: "Find existing analytics assets with metadata relevance, scope evidence and clarification questions." },
      { property: "og:title", content: "Ask AI — InsightGuard AI" },
      { property: "og:description", content: "Find existing analytics assets with scope and KPI evidence. Governance is not evaluated." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const examples = [
  "Sales pipeline by region with win rates",
  "Monthly customer churn and NRR",
  "Inventory turnover across warehouses",
];

function Home() {
  const [text, setText] = useState("");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const recent = useQuery({ queryKey: ["requests"], queryFn: api.getRequests });

  const analyze = useMutation({
    mutationFn: api.analyze,
    onSuccess: (res) => {
      const id = crypto.randomUUID();
      qc.setQueryData(["candidate-analysis", id, "live"], res);
      navigate({ to: "/analysis/$id", params: { id }, search: { mode: "live" } });
    },
  });

  return (
    <div className="space-y-8">
      <section>
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Asset matching
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-foreground md:text-4xl">
          What analytics do you need?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Find existing assets by product, market and KPI. Governance: Not evaluated.
        </p>
      </section>

      <Surface className="p-3 md:p-4">
        <Textarea
          value={text}
          aria-label="Analytics question"
          onChange={(e) => { setText(e.target.value); analyze.reset(); }}
          placeholder="e.g. A dashboard showing quarterly revenue by product line…"
          className="min-h-32 resize-none border-0 bg-transparent text-base shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled className="gap-1.5 text-muted-foreground">
            <Mic className="h-4 w-4" /> Coming soon
          </Button>
          <Button
            size="lg"
            className="gap-2 rounded-xl bg-gradient-primary shadow-elegant"
            disabled={Array.from(text.trim()).length < 3 || Array.from(text.trim()).length > 2000 || analyze.isPending}
            onClick={() => analyze.mutate({ question: text, limit: 10 })}
          >
            {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analyze.isPending ? "Analyzing…" : "Analyze"}
          </Button>
        </div>
      </Surface>

      {Array.from(text.trim()).length > 2000 && <p role="alert" className="text-sm text-destructive">Enter a question containing 3–2000 characters.</p>}
      {analyze.isPending && <p role="status" className="text-sm text-muted-foreground">Extracting intent and finding matching assets…</p>}
      {analyze.isError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{describeAnalyzeError(analyze.error)}</p><Button variant="outline" onClick={() => analyze.mutate({ question: text, limit: 10 })}>Retry</Button></div>}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {examples.map((q) => (
          <Button
            key={q}
            variant="outline"
            onClick={() => { setText(q); analyze.reset(); }}
            className="shrink-0 rounded-full border bg-card px-3.5 py-2 text-sm text-foreground transition hover:border-primary/40 active:scale-95"
          >
            {q}
          </Button>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent requests</h2>
          {recent.data?.isDemo && <DemoBadge />}
        </div>
        <div className="space-y-2">
          {recent.isLoading &&
            [0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
          {recent.isError && <p className="text-sm text-destructive">Couldn't load recent requests.</p>}
          {recent.data?.data.slice(0, 3).map((r) => (
            <Link
              key={r.id}
              to="/analysis/$id"
              params={{ id: r.id }}
              search={{ mode: "demo" }}
              className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-card transition active:scale-[0.99]"
            >
              <p className="line-clamp-2 flex-1 text-sm text-foreground">{r.request}</p>
              {r.decision && <DecisionBadge decision={r.decision} />}
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
