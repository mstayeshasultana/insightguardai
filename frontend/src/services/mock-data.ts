// DEMO DATA ONLY — used for endpoints that are not yet wired to the real backend
// (see LIVE_ENDPOINTS in api.ts). Delete this file (and its import in api.ts) once every
// endpoint is served by your API.
import type { AnalysisRequestSummary, AnalyticsAsset, Recommendation } from "./types";

export const DEMO_ASSETS: AnalyticsAsset[] = [
  { id: "a1", name: "Sales Pipeline Overview", description: "Weekly pipeline by region, stage and rep.", platform: "Power BI", status: "active", owner: "Maria Lind", kpis: ["Pipeline value", "Win rate", "Deal velocity"], dataModel: "sales_core_v3", lastUpdated: "2026-10-28" },
  { id: "a2", name: "Regional Revenue Dashboard", description: "Monthly recognized revenue per region.", platform: "Tableau", status: "active", owner: "Jon Berg", kpis: ["Revenue", "Gross margin", "YoY growth"], dataModel: "finance_rev_v2", lastUpdated: "2026-10-12" },
  { id: "a3", name: "Legacy Sales Report", description: "Old Excel-based sales export.", platform: "Excel / SSRS", status: "deprecated", owner: "Unassigned", kpis: ["Revenue", "Units sold"], dataModel: "sales_legacy", lastUpdated: "2024-03-02" },
  { id: "a4", name: "Customer Churn Monitor", description: "Churn risk scoring and retention cohorts.", platform: "Looker", status: "under_review", owner: "Aino Virtanen", kpis: ["Churn rate", "NRR", "Customer LTV"], dataModel: "cx_churn_v1", lastUpdated: "2026-09-30" },
  { id: "a5", name: "Inventory Health", description: "Stock levels, turnover and stockouts.", platform: "Power BI", status: "draft", owner: "Liam Koski", kpis: ["Inventory turnover", "Stockout rate"], dataModel: "ops_inventory_v1", lastUpdated: "2026-11-01" },
];

export const DEMO_RECOMMENDATIONS: Recommendation[] = [
  {
    id: "r1",
    request: "I need a dashboard showing sales pipeline by region with win rates.",
    decision: "REUSE",
    explanation: "Sample explanation: an existing certified dashboard already covers pipeline value and win rate by region.",
    matches: [
      { assetId: "a1", assetName: "Sales Pipeline Overview", platform: "Power BI", similarity: 0.92, matchedKpis: ["Pipeline value", "Win rate"], model: "sales_core_v3", owner: "Maria Lind" },
      { assetId: "a3", assetName: "Legacy Sales Report", platform: "Excel / SSRS", similarity: 0.54, matchedKpis: ["Revenue"], model: "sales_legacy", owner: "Unassigned" },
    ],
    governanceWarnings: ["Legacy Sales Report has no owner and is deprecated."],
    createdAt: "2026-11-05T09:12:00Z",
  },
  {
    id: "r2",
    request: "Track customer churn and net revenue retention monthly.",
    decision: "HUMAN_REVIEW",
    explanation: "Sample explanation: a matching asset exists but is under review, so a governance owner should confirm.",
    matches: [
      { assetId: "a4", assetName: "Customer Churn Monitor", platform: "Looker", similarity: 0.81, matchedKpis: ["Churn rate", "NRR"], model: "cx_churn_v1", owner: "Aino Virtanen" },
    ],
    governanceWarnings: ["KPI definition for NRR differs between Finance and CX."],
    createdAt: "2026-11-03T14:40:00Z",
  },
];

export const DEMO_REQUESTS: AnalysisRequestSummary[] = DEMO_RECOMMENDATIONS.map((r) => ({
  id: r.id,
  request: r.request,
  decision: r.decision,
  createdAt: r.createdAt,
}));
