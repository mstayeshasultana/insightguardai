import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Building2, Gauge, Info, Network, ShieldQuestion, Target, Users } from "lucide-react";
import { Surface } from "@/components/app/shared";
import { formatRecordedDate, formatRecordedMonth, isRecordedDate } from "@/services/api";
import type {
  AssetEvidence, CollectionSection, DataQualityIssue, EdgeLists, EvidenceEdge, EvidenceKpi, EvidenceNode,
  EvidenceStatus, LinkedSection, SourceRecord, SourceReference,
} from "@/services/types";

/** Plain-language wording for availability states (never verdicts). */
export function describeEvidenceStatus(status: EvidenceStatus, noRecordsText = "No records found."): string | null {
  switch (status) {
    case "available": return null;
    case "not_available": return "Not available.";
    case "no_records": return noRecordsText;
    case "source_unavailable": return "Evidence source unavailable.";
    case "partial": return "Some KPI definitions unavailable; retrieved mappings are shown.";
    default: return `Evidence status: ${status}`;
  }
}

export function displayValue(value: unknown): string {
  if (value == null || value === "") return "Not recorded";
  if (isRecordedDate(value)) return formatRecordedDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-GB");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const humanize = (key: string) => key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function Value({ value }: { value: unknown }) {
  const missing = value == null || value === "";
  return <span className={missing ? "italic text-muted-foreground" : undefined}>{displayValue(value)}</span>;
}

export function FieldGrid({ record, fields }: { record: SourceRecord; fields?: [string, string][] }) {
  const rows = fields ?? Object.keys(record).filter((k) => k !== "synthetic_record").map((k) => [k, humanize(k)] as [string, string]);
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {rows.map(([key, label]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words font-medium text-foreground"><Value value={record[key]} /></dd>
        </div>
      ))}
    </dl>
  );
}

function SourceRef({ reference }: { reference?: SourceReference | null | undefined }) {
  if (!reference?.table) return null;
  const keys = Object.entries(reference.keys ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(", ");
  return <p className="mt-2 break-words font-mono text-[10px] text-muted-foreground">Source: {reference.table}{keys && ` · ${keys}`}</p>;
}

function StatusNote({ status, message, noRecordsText }: { status: EvidenceStatus; message?: string | null | undefined; noRecordsText?: string }) {
  const text = describeEvidenceStatus(status, noRecordsText);
  if (!text && !message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{text && <p className="font-medium text-foreground">{text}</p>}{message && <p>{message}</p>}</div>
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex max-w-full break-words rounded-full border bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">{children}</span>;
}

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Surface className="h-full">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground"><span className="text-primary">{icon}</span>{title}</h2>
        <div className="space-y-3">{children}</div>
      </Surface>
    </section>
  );
}

function LinkedRecord({ label, section, idKey, fields }: { label: string; section: LinkedSection | undefined; idKey: string; fields: [string, string][] }) {
  if (!section) return null;
  const refId = section.record?.[idKey] ?? section.source_reference?.keys?.[idKey];
  return (
    <div className="rounded-xl border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        {refId != null && <Pill>{String(refId)}</Pill>}
      </div>
      <StatusNote status={section.status} message={section.message} />
      {section.record && <FieldGrid record={section.record} fields={fields} />}
      <SourceRef reference={section.source_reference} />
    </div>
  );
}

const OWNER_FIELDS: [string, string][] = [["owner_name", "Name"], ["role", "Role"], ["scope", "Scope"], ["status", "Status"]];
const WORKSPACE_FIELDS: [string, string][] = [["workspace_name", "Name"], ["scope", "Scope"], ["environment", "Environment"], ["platform", "Platform"], ["governance_mode", "Governance mode"], ["classification", "Classification"]];
const MODEL_FIELDS: [string, string][] = [
  ["model_name", "Model name"], ["model_type", "Model type"], ["product_scope", "Product scope"], ["region_scope", "Region scope"],
  ["refresh_frequency", "Refresh frequency"], ["refresh_status", "Refresh status"], ["ai_readiness", "AI readiness"], ["ai_issue_pattern", "AI issue pattern"],
  ["endorsement", "Endorsement"], ["table_count", "Tables"], ["measure_count", "Measures"], ["workspace_id", "Workspace ID"], ["owner_id", "Owner ID"],
];

function KpiItem({ item }: { item: EvidenceKpi }) {
  const def = item.definition;
  const r = def?.record;
  return (
    <li className="rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill>{displayValue(item.kpi_id)}</Pill>
        <span className="font-medium text-foreground">{r ? displayValue(r["kpi_name"]) : "Definition not retrieved"}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Usage role: <Value value={item.usage_role} /></p>
      {def && <div className="mt-2"><StatusNote status={def.status} message={def.message} /></div>}
      {r && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Pill>Definition: {displayValue(r["definition_status"])}</Pill>
            <Pill>Approval: {displayValue(r["approval_status"])}</Pill>
          </div>
          <div className="mt-3"><FieldGrid record={r} fields={[["canonical_metric", "Canonical metric"], ["unit", "Unit"], ["domain", "Domain"], ["default_frequency", "Frequency"], ["business_criticality", "Business criticality"], ["owner_id", "Owner ID"]]} /></div>
          {r["description"] != null && <p className="mt-2 text-sm text-muted-foreground">{displayValue(r["description"])}</p>}
        </>
      )}
      <SourceRef reference={def?.source_reference} />
    </li>
  );
}

function Node({ node, fallbackId }: { node: EvidenceNode | undefined; fallbackId: unknown }) {
  const id = node?.id ?? (fallbackId == null ? null : String(fallbackId));
  const label = <><span className="font-medium">{node?.name ?? "Name not available"}</span> <span className="font-mono text-[11px] text-muted-foreground">{id ?? "No ID"}</span></>;
  if (node?.entity_type === "asset" && node.record_available && id) {
    return <Link to="/assets/$id" params={{ id }} search={{ mode: "live" }} className="break-words text-primary underline-offset-2 hover:underline">{label}</Link>;
  }
  return <span className="break-words text-foreground">{label}{node && !node.record_available && <span className="ml-1 text-[11px] italic text-muted-foreground">(record not found)</span>}</span>;
}

function EdgeList({ title, edges, direction }: { title: string; edges: EvidenceEdge[]; direction: "incoming" | "outgoing" }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
        {direction === "incoming" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{title} ({edges.length})
      </p>
      {edges.length === 0 ? <p className="text-xs italic text-muted-foreground">No recorded edges.</p> : (
        <ul className="space-y-1.5">
          {edges.map((e, i) => {
            const other = direction === "incoming" ? e.source : e.target;
            return (
              <li key={`${e.source_id}-${e.target_id}-${e.edge_type}-${i}`} className="rounded-lg border px-3 py-2 text-sm">
                <Node node={other} fallbackId={direction === "incoming" ? e.source_id : e.target_id} />
                <p className="mt-0.5 text-[11px] text-muted-foreground">{displayValue(other?.entity_type)} · {displayValue(e.edge_type)} · {displayValue(e.relationship)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EdgeGroup({ label, lists }: { label: string; lists: EdgeLists | null | undefined }) {
  if (!lists) return <p className="text-xs italic text-muted-foreground">{label}: not available.</p>;
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <EdgeList title="Incoming (upstream)" edges={lists.incoming} direction="incoming" />
      <EdgeList title="Outgoing (downstream)" edges={lists.outgoing} direction="outgoing" />
    </div>
  );
}

function IssueCollection<T extends SourceRecord>({ title, section, noRecordsText, render }: { title: string; section: CollectionSection<T>; noRecordsText: string; render: (item: T) => ReactNode }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <StatusNote status={section.status} message={section.message} noRecordsText={noRecordsText} />
      {section.items.length > 0 && <ul className="mt-2 space-y-2">{section.items.map((item, i) => <li key={i} className="rounded-lg bg-muted/40 p-3 text-sm">{render(item)}</li>)}</ul>}
      <SourceRef reference={section.source_reference} />
    </div>
  );
}

const ms = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("en-GB")} ms` : "Not recorded");

export const EVIDENCE_SECTIONS = [
  ["ownership", "Ownership"], ["kpis", "KPIs"], ["model", "Model health"], ["usage", "Usage"], ["dependencies", "Dependencies"], ["issues", "Issues"],
] as const;

export function AssetEvidenceSections({ evidence }: { evidence: AssetEvidence }) {
  const { kpis, usage, dependencies, issues } = evidence;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 font-semibold text-foreground"><ShieldQuestion className="h-3 w-3" /> Governance: Not evaluated</span>
        {evidence.is_synthetic != null && <Pill>{evidence.is_synthetic ? "Synthetic record" : "Not marked synthetic"}</Pill>}
        <span className="text-muted-foreground">Recorded evidence only — no verdicts or recommendations.</span>
      </div>
      {evidence.unavailable_sources.length > 0 && (
        <StatusNote status="source_unavailable" message={`Unavailable sources: ${evidence.unavailable_sources.join(", ")}`} />
      )}
      <nav aria-label="Evidence sections" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {EVIDENCE_SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:border-primary/40">{label}</a>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section id="ownership" icon={<Building2 className="h-4 w-4" />} title="Ownership and workspace">
          <LinkedRecord label="Asset owner" section={evidence.ownership} idKey="owner_id" fields={OWNER_FIELDS} />
          <LinkedRecord label="Asset workspace" section={evidence.workspace} idKey="workspace_id" fields={WORKSPACE_FIELDS} />
        </Section>

        <Section id="model" icon={<Boxes className="h-4 w-4" />} title="Model health">
          <LinkedRecord label="Semantic model" section={evidence.model} idKey="model_id" fields={MODEL_FIELDS} />
          <LinkedRecord label="Model owner" section={evidence.model.owner} idKey="owner_id" fields={OWNER_FIELDS} />
          <LinkedRecord label="Model workspace" section={evidence.model.workspace} idKey="workspace_id" fields={WORKSPACE_FIELDS} />
        </Section>

        <Section id="kpis" icon={<Target className="h-4 w-4" />} title="KPI definitions">
          <StatusNote status={kpis.status} message={kpis.message} noRecordsText="No KPI mappings recorded for this asset." />
          {kpis.items.length > 0 && <ul className="space-y-2">{kpis.items.map((k, i) => <KpiItem key={`${k.kpi_id}-${i}`} item={k} />)}</ul>}
          <SourceRef reference={kpis.source_reference} />
        </Section>

        <Section id="usage" icon={<Users className="h-4 w-4" />} title="Usage">
          <StatusNote status={usage.status} message={usage.message} noRecordsText="No monthly usage records found." />
          {usage.items.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                Recorded monthly observations{usage.period_start && usage.period_end && `, ${formatRecordedMonth(usage.period_start)} – ${formatRecordedMonth(usage.period_end)}`} ({usage.record_count ?? usage.items.length} records). Not live telemetry; monthly unique users cannot be summed across months.
              </p>
              {usage.latest_record && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[["Views", displayValue(usage.latest_record["views"])], ["Unique users", displayValue(usage.latest_record["unique_users"])], ["Avg load", ms(usage.latest_record["avg_load_ms"])], ["Query errors", displayValue(usage.latest_record["query_errors"])]].map(([l, v]) => (
                    <div key={l} className="rounded-xl bg-muted/40 p-2.5">
                      <p className="text-[11px] text-muted-foreground">{l}</p><p className="font-semibold text-foreground">{v}</p>
                    </div>
                  ))}
                  <p className="col-span-full text-[11px] text-muted-foreground">Latest month: {typeof usage.latest_record["month"] === "string" ? formatRecordedMonth(usage.latest_record["month"]) : "Not recorded"}</p>
                </div>
              )}
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[460px] text-xs">
                  <thead><tr className="text-left text-muted-foreground">{["Month", "Views", "Unique users", "Avg load (ms)", "Query errors", "Exports", "Subs"].map((h) => <th key={h} className="py-1.5 pr-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {usage.items.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5 pr-2 font-medium">{typeof row["month"] === "string" ? formatRecordedMonth(row["month"]) : <Value value={row["month"]} />}</td>
                        {["views", "unique_users", "avg_load_ms", "query_errors", "exports", "subscriptions"].map((k) => <td key={k} className="py-1.5 pr-2"><Value value={row[k]} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <SourceRef reference={usage.source_reference} />
        </Section>

        <Section id="dependencies" icon={<Network className="h-4 w-4" />} title="Dependencies">
          <StatusNote status={dependencies.status} message={dependencies.message} noRecordsText="No lineage edges recorded." />
          {dependencies.scope && <p className="text-xs text-muted-foreground">{dependencies.scope}</p>}
          <EdgeGroup label="This asset" lists={dependencies.asset} />
          {(dependencies.model || dependencies.model_id) && <EdgeGroup label={`Referenced model ${dependencies.model_id ?? ""}`.trim()} lists={dependencies.model} />}
          <p className="text-[11px] text-muted-foreground">The same edge can appear in both lists; counts are not unique totals.</p>
        </Section>

        <Section id="issues" icon={<AlertTriangle className="h-4 w-4" />} title="Recorded issues">
          <IssueCollection title="Governance signals" section={issues.governance_signals} noRecordsText="No governance signals recorded for this asset." render={(s) => (
            <>
              <div className="flex flex-wrap gap-1.5"><Pill>{displayValue(s["signal_id"])}</Pill><Pill>Severity: {displayValue(s["severity"])}</Pill><Pill>Status: {displayValue(s["status"])}</Pill></div>
              <p className="mt-1 font-medium text-foreground">{displayValue(s["signal_code"])}</p>
              <p className="text-xs text-muted-foreground">Detected by: <Value value={s["detected_by"]} /></p>
            </>
          )} />
          <IssueCollection<DataQualityIssue> title="Data quality" section={issues.data_quality} noRecordsText="No data-quality issues recorded for the inspected scope." render={(d) => (
            <>
              <div className="flex flex-wrap gap-1.5"><Pill>{displayValue(d["issue_id"])}</Pill><Pill>Severity: {displayValue(d["severity"])}</Pill></div>
              <p className="mt-1 text-foreground">{displayValue(d["impact"])}</p>
              <p className="mt-1 text-xs text-muted-foreground">Field <span className="font-mono">{displayValue(d["field"])}</span> = <span className="font-mono">{displayValue(d["issue_value"])}</span> · {displayValue(d["sheet"])} {displayValue(d["record_id"])}</p>
              {d.applies_to?.length ? <p className="mt-1 text-xs text-muted-foreground">Applies to: {d.applies_to.map((a) => `${a.relationship} (${a.table} ${a.record_id})`).join(", ")}</p> : null}
            </>
          )} />
        </Section>
      </div>
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Gauge className="h-3 w-3" /> Values are source records. Empty sections never imply a healthy or approved asset.</p>
    </div>
  );
}
