import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History as HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DecisionBadge, DemoBadge, EmptyState, PageHeader } from "@/components/app/shared";
import { api } from "@/services/api";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — InsightGuard AI" },
      { name: "description", content: "Previous analytics requests and their governance decisions." },
      { property: "og:title", content: "History — InsightGuard AI" },
      { property: "og:description", content: "Previous analytics requests and their decisions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const q = useQuery({ queryKey: ["requests"], queryFn: api.getRequests });
  const items = q.data?.data ?? [];

  return (
    <div>
      <PageHeader title="History" subtitle="Your previous analyses." action={q.data?.isDemo && <DemoBadge />} />
      <div className="space-y-2">
        {q.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        {q.isError && <p className="text-sm text-destructive">Couldn't load history.</p>}
        {items.map((r) => (
          <Link key={r.id} to="/analysis/$id" params={{ id: r.id }} search={{ mode: "demo" }} className="block rounded-2xl border bg-card p-4 shadow-card transition active:scale-[0.99]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
              </span>
              {r.decision && <DecisionBadge decision={r.decision} />}
            </div>
            <p className="text-sm text-foreground">{r.request}</p>
          </Link>
        ))}
      </div>
      {q.data && items.length === 0 && (
        <EmptyState
          icon={<HistoryIcon className="h-5 w-5" />}
          title="No analyses yet"
          text="Ask your first question and it will show up here."
          action={<Button asChild><Link to="/">Ask AI</Link></Button>}
        />
      )}
    </div>
  );
}
