import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Database, Globe, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AssetCard, DemoBadge, EmptyState, PageHeader } from "@/components/app/shared";
import { api, ApiError, describeApiError } from "@/services/api";
import { filterAssets } from "@/services/asset-filters";
import type { AssetMode, AssetSearchParams } from "@/services/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/assets/")({
  validateSearch: (search: Record<string, unknown>): { mode: AssetMode } => ({ mode: search["mode"] === "demo" ? "demo" : "live" }),
  head: () => ({
    meta: [
      { title: "Asset Explorer — InsightGuard AI" },
      { name: "description", content: "Search and filter existing analytics assets by market, platform and lifecycle status." },
      { property: "og:title", content: "Asset Explorer — InsightGuard AI" },
      { property: "og:description", content: "Search and filter existing analytics assets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Assets,
});

const PAGE = 20;
const selectClass = "h-10 min-w-0 rounded-xl border bg-card px-3 text-sm text-foreground";

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function describeSearchError(error: unknown): string {
  if (error instanceof ApiError && error.status === 400) return "The selected market is not recognized by the backend.";
  if (error instanceof ApiError && error.status === 422) return "Invalid search parameters. Shorten the search text (max 200 characters).";
  if (error instanceof ApiError && error.status === 503) return "The asset database is temporarily unavailable. Please try again later.";
  return describeApiError(error);
}

function Assets() {
  const { mode } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [search, setSearch] = useState("");
  const [market, setMarket] = useState("");
  const [platform, setPlatform] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [includeGlobal, setIncludeGlobal] = useState(false);
  const q = useDebounced(search.trim().slice(0, 200));

  const reset = () => { setSearch(""); setMarket(""); setPlatform(""); setLifecycle(""); setIncludeGlobal(false); };

  return (
    <div>
      <PageHeader title="Asset Explorer" subtitle={mode === "live" ? "Search the full asset catalog" : "Sample analytics assets"} action={mode === "demo" && <DemoBadge />} />
      <div className="mb-4 inline-flex gap-1 rounded-lg border bg-card p-1" role="group" aria-label="Asset data source">
        {(["live", "demo"] as const).map((source) => <Button key={source} size="sm" variant={mode === source ? "default" : "ghost"} aria-pressed={mode === source} onClick={() => { reset(); void navigate({ search: { mode: source } }); }}>{source === "live" ? "Live assets" : "Demo assets"}</Button>)}
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search assets" maxLength={200} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={mode === "live" ? "Search name, product, or country (e.g. Germany, DE)…" : "Search name, platform, scope…"} className="h-12 rounded-xl bg-card pl-10" />
      </div>
      {mode === "live"
        ? <LiveAssets params={{ q, market, platform, lifecycle_status: lifecycle, include_global: includeGlobal }} set={{ setMarket, setPlatform, setLifecycle, setIncludeGlobal }} />
        : <DemoAssets search={search} />}
    </div>
  );
}

type Setters = { setMarket: (v: string) => void; setPlatform: (v: string) => void; setLifecycle: (v: string) => void; setIncludeGlobal: (v: boolean) => void };

function LiveAssets({ params, set }: { params: Required<Omit<AssetSearchParams, "limit" | "offset">>; set: Setters }) {
  const filtersQ = useQuery({ queryKey: ["asset-filters"], queryFn: ({ signal }) => api.getAssetFilters(signal), retry: false, staleTime: 5 * 60_000 });
  const results = useInfiniteQuery({
    queryKey: ["asset-search", params],
    queryFn: ({ pageParam, signal }) => api.searchAssets({ ...params, limit: PAGE, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.data.has_more && last.data.next_offset != null ? last.data.next_offset : undefined),
    retry: false,
    placeholderData: keepPreviousData,
  });

  const pages = results.data?.pages ?? [];
  const first = pages[0]?.data;
  const assets = pages.flatMap((p) => p.data.assets);
  const total = first?.total ?? 0;
  const markets = filtersQ.data?.data.markets ?? [];
  const resolved = first?.resolved_query_market ?? (params.market ? markets.find((m) => m.market_id === params.market) ?? null : null);
  const countryConstraint = Boolean(resolved && resolved.market_id.toLowerCase() !== "global") || Boolean(params.market && params.market.toLowerCase() !== "global");
  const stale = results.isPlaceholderData;

  return (
    <>
      {filtersQ.isError ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          <span>Filter options could not be loaded. {describeApiError(filtersQ.error)}</span>
          <Button size="sm" variant="outline" disabled={filtersQ.isFetching} onClick={() => void filtersQ.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select aria-label="Market" className={selectClass} value={params.market} disabled={!filtersQ.data} onChange={(e) => set.setMarket(e.target.value)}>
            <option value="">All markets</option>
            {markets.map((m) => <option key={m.market_id} value={m.market_id}>{m.market_name} ({m.market_id})</option>)}
          </select>
          <select aria-label="Platform" className={selectClass} value={params.platform} disabled={!filtersQ.data} onChange={(e) => set.setPlatform(e.target.value)}>
            <option value="">All platforms</option>
            {(filtersQ.data?.data.platforms ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select aria-label="Lifecycle status" className={selectClass} value={params.lifecycle_status} disabled={!filtersQ.data} onChange={(e) => set.setLifecycle(e.target.value)}>
            <option value="">All statuses</option>
            {(filtersQ.data?.data.lifecycle_statuses ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          {first && !results.isError && <span aria-live="polite">Showing {assets.length} of {total} matching assets</span>}
          {resolved && <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">Market: {resolved.market_name} ({resolved.market_id})</span>}
          {(results.isFetching && !results.isFetchingNextPage) && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading" />}
        </div>
        {countryConstraint && (
          <label className="flex items-center gap-2 text-foreground">
            <Switch checked={params.include_global} onCheckedChange={set.setIncludeGlobal} aria-label="Include global assets" />
            Include global assets
          </label>
        )}
      </div>

      <div className={cn("grid gap-3 md:grid-cols-2", stale && "opacity-60")}>
        {results.isPending && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        {!results.isError && assets.map((a) => (
          <div key={a.id} className="min-w-0">
            {params.include_global && a.marketScope?.toLowerCase() === "global" && (
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Globe className="h-3 w-3" /> Broader scope (Global) — not proof of country-specific data</p>
            )}
            <AssetCard asset={a} mode="live" />
          </div>
        ))}
      </div>

      {results.isError && !results.isFetchNextPageError && <EmptyState icon={<Database className="h-5 w-5" />} title="Unable to load live assets" text={describeSearchError(results.error)} action={<Button variant="outline" disabled={results.isFetching} onClick={() => void results.refetch()}>Retry</Button>} />}
      {!results.isError && first && assets.length === 0 && (
        <EmptyState icon={<Database className="h-5 w-5" />} title="No matching assets" text="No assets in the catalog match this search and filter combination." />
      )}
      {assets.length > 0 && (
        <div className="mt-5 flex flex-col items-center gap-2">
          {results.isFetchNextPageError && <p className="text-sm text-destructive">{describeSearchError(results.error)}</p>}
          <Button variant="outline" disabled={!results.hasNextPage || results.isFetchingNextPage || stale} onClick={() => void results.fetchNextPage()}>
            {results.isFetchingNextPage ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</> : results.hasNextPage ? "Load more" : "All matching assets loaded"}
          </Button>
        </div>
      )}
    </>
  );
}

function DemoAssets({ search }: { search: string }) {
  const q = useQuery({ queryKey: ["assets", "demo"], queryFn: () => api.getAssets("demo") });
  const [status, setStatus] = useState("all");
  const filters = ["all", ...new Set((q.data?.data ?? []).flatMap((a) => (a.status ? [a.status] : [])))];
  const list = useMemo(() => filterAssets(q.data?.data ?? [], search, status), [q.data, search, status]);
  return (
    <>
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
        {filters.map((f) => (
          <Button key={f} variant="outline" aria-pressed={status === f} onClick={() => setStatus(f)}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition", status === f ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground")}>
            {f === "all" ? "All" : f}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {q.isPending && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        {list.map((a) => <AssetCard key={a.id} asset={a} mode="demo" />)}
      </div>
      {q.data && list.length === 0 && <EmptyState icon={<Database className="h-5 w-5" />} title="No assets match" text="Try a different search or filter." />}
    </>
  );
}
