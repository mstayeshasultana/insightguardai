import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DemoBadge, EmptyState, KpiTag, StatusPill, Surface } from "@/components/app/shared";
import { api, ApiError, describeApiError } from "@/services/api";
import { AssetEvidenceSections, displayValue } from "@/components/app/asset-evidence";
import { AssetAssessmentSection } from "@/components/app/asset-assessment";
import type { AssetMode } from "@/services/types";

export const Route = createFileRoute("/assets/$id")({
  validateSearch: (search: Record<string, unknown>): { mode: AssetMode } => ({ mode: search["mode"] === "demo" ? "demo" : "live" }),
  head: () => ({
    meta: [
      { title: "Asset details — InsightGuard AI" },
      { name: "description", content: "Owner, platform, data model and KPIs for an analytics asset." },
      { property: "og:title", content: "Asset details — InsightGuard AI" },
      { property: "og:description", content: "Owner, platform, data model and KPIs for an analytics asset." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssetDetail,
});

function AssetDetail() {
  const { id } = Route.useParams();
  const { mode } = Route.useSearch();
  const q = useQuery({ queryKey: ["asset", id, mode], queryFn: () => api.getAsset(id, mode), retry: false });
  const a = q.isError ? undefined : q.data?.data;
  const ev = useQuery({ queryKey: ["asset-evidence", id, mode], queryFn: () => api.getAssetEvidence(id), retry: false, enabled: mode === "live" });
  const as = useQuery({ queryKey: ["asset-assessment", id], queryFn: () => api.getAssetAssessment(id), retry: false, enabled: mode === "live" && Boolean(a) });
  const missing = (q.error instanceof ApiError && q.error.status === 404) || (q.data && !q.data.data);

  return (
    <div className="space-y-5">
      <Link to="/assets" search={{ mode }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All assets
      </Link>
      {q.isPending && <Skeleton className="h-64 rounded-2xl" />}
      {missing ? <EmptyState icon={<Database className="h-5 w-5" />} title="Asset not found" text={`No asset exists with identifier ${id}.`} /> : q.isError && <EmptyState icon={<Database className="h-5 w-5" />} title="Unable to load live assets" text={describeApiError(q.error)} action={<Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>Retry</Button>} />}
      {a && (
        <Surface className="bg-surface-glow">
          <div className="flex flex-wrap items-center gap-2">
            {a.status && <StatusPill status={a.status} />}
            {q.data?.isDemo && <DemoBadge />}
          </div>
          <h1 className="mt-3 break-words text-2xl font-semibold text-foreground">{a.name}</h1>
          {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            {[
              ["Asset ID", a.id],
              ["Asset type", a.assetType],
              ["Platform", a.platform],
              ["Lifecycle status", a.status],
              ["Endorsement", a.endorsement],
              ["Product scope", a.productScope],
              ["Market scope", a.marketScope],
              [a.owner ? "Owner" : "Owner ID", a.owner ?? a.ownerId],
              [a.dataModel ? "Data model" : "Model ID", a.dataModel ?? a.modelId],
              ["Last updated", a.lastUpdated],
              ...Object.entries(a.databaseFields ?? {}).filter(([key]) => !["asset_id", "asset_name", "asset_type", "platform", "lifecycle_status", "endorsement", "product_scope", "market_scope", "owner_id", "model_id"].includes(key)),
            ].filter(([, v]) => v != null).map(([k, v]) => (
              <div key={String(k)} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{String(k).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</dt>
                <dd className="break-words font-medium text-foreground">{displayValue(v)}</dd>
              </div>
            ))}
          </dl>
          {Boolean(a.kpis?.length) && <p className="mt-5 text-xs text-muted-foreground">KPIs</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.kpis?.map((k) => <KpiTag key={k}>{k}</KpiTag>)}
          </div>
        </Surface>
      )}
      {a && mode === "demo" && <p className="text-xs text-muted-foreground">Recorded evidence is only available for live assets.</p>}
      {a && mode === "live" && (
        <div>
          {ev.isPending && <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>}
          {ev.isError && (
            <EmptyState
              icon={<Database className="h-5 w-5" />}
              title={ev.error instanceof ApiError && ev.error.status === 404 ? "Evidence not found" : "Unable to load recorded evidence"}
              text={ev.error instanceof ApiError && ev.error.status === 503 ? "The evidence database is temporarily unavailable. The asset details above are still shown." : `${describeApiError(ev.error)} The asset details above are still shown.`}
              action={<Button variant="outline" disabled={ev.isFetching} onClick={() => void ev.refetch()}>Retry</Button>}
            />
          )}
          {ev.data && <AssetEvidenceSections evidence={ev.data.data} />}
        </div>
      )}
      {a && mode === "live" && (
        <div>
          {as.isPending && <Skeleton className="h-40 rounded-2xl" />}
          {as.isError && (
            <EmptyState
              icon={<Database className="h-5 w-5" />}
              title={as.error instanceof ApiError && as.error.status === 404 ? "Assessment not found" : "Prototype assessment unavailable"}
              text={as.error instanceof ApiError && as.error.status === 503 ? "The assessment database is temporarily unavailable. No result is shown; this does not mean no concerns." : `${describeApiError(as.error)} No result is shown; this does not mean no concerns.`}
              action={<Button variant="outline" disabled={as.isFetching} onClick={() => void as.refetch()}>Retry</Button>}
            />
          )}
          {as.data && <AssetAssessmentSection assessment={as.data.data} />}
        </div>
      )}
    </div>
  );
}
