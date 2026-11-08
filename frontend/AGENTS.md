<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- All backend calls go through `src/services/api.ts`; only paths listed in `LIVE_ENDPOINTS` there hit the real backend, everything else returns demo data from `src/services/mock-data.ts` flagged `isDemo: true` — keeps mocks removable and results honestly labeled.
- No Lovable Cloud/auth/AI: the backend is the user's own FastAPI service.
- Asset API responses are mapped once in the API service; preserve additional database fields for details and keep live/demo query caches separated by mode to avoid mixing records.
- Analyze uses a dedicated candidate-result contract and live query cache, separate from legacy demo recommendations; each candidate's advisory `assessment` (available or explicitly unavailable) renders via `candidate-assessment.tsx` separately from metadata relevance and never changes rank — prevents advisory checks being read as governance decisions.
- Candidate reuse guidance is validated in the API service and displayed separately by `candidate-guidance.tsx` without recalculating backend policy; absent/invalid guidance stays unavailable so matching and assessment evidence remain usable without a positive fallback.
- Live Asset Explorer uses server-side `/assets/search` (search, filters, totals, offset paging) and `/assets/filters`; never filter live results client-side, since the loaded page is not the full catalog.
- Asset Details loads `/assets/{asset_id}/evidence` as a separate live-only query rendered by `asset-evidence.tsx`; section `status` drives availability wording so missing evidence is never shown as "no issues", and failures keep the basic asset visible.
- Asset Details loads `/assets/{asset_id}/assessment` as its own live-only query rendered by `asset-assessment.tsx`; it is advisory, never labeled approval, and failures show "unavailable" rather than no concerns while evidence stays visible.
