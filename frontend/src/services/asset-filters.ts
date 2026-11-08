import type { AnalyticsAsset } from "./types";

/** Search and status filters deliberately operate only on the loaded records. */
export function filterAssets(records: AnalyticsAsset[], search: string, status: string): AnalyticsAsset[] {
  const term = search.toLowerCase();
  return records.filter((asset) =>
    (status === "all" || asset.status === status) &&
    [asset.name, asset.platform, asset.owner, asset.ownerId, asset.endorsement, asset.productScope, asset.marketScope, ...(asset.kpis ?? [])]
      .some((value) => value != null && String(value).toLowerCase().includes(term)),
  );
}