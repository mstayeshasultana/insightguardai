# Asset Explorer search

This is ordinary SQL search, with no LLM call. It searches the entire database,
then returns a page. `/assets` still returns its original JSON array, and asset
detail links and `/analyze` are unchanged.

## Requests

| Request | Behavior |
| --- | --- |
| `/assets/search` | Browse the first 20 assets |
| `/assets/search?q=Germany` | Resolve Germany to DE and return exact DE-scoped assets |
| `/assets/search?q=DE` | Same country matching; does not match DE inside unrelated words |
| `/assets/search?q=Xarelto&market=DE` | Search name/product scope AND restrict to Germany |
| `/assets/search?q=forecast&market=Germany&platform=Power%20BI&lifecycle_status=active` | Combine search with all filters |
| `/assets/search?q=Germany&include_global=true` | Include DE and Global scopes |
| `/assets/search?q=Germany&limit=20&offset=20` | Next page of the same search |
| `/assets/filters` | Full-catalog market, platform and lifecycle dropdown choices |

`q` is optional, trimmed and at most 200 characters. Empty text means browse.
Country names/codes are case-insensitive exact lookups against `Markets`;
`Global` is also recognized. Other text is a literal, case-insensitive substring
of `asset_name` or `product_scope`. Combined sentences such as “Xarelto Germany”
are not parsed: use `q=Xarelto&market=DE`.

`market` accepts a country name/code or Global. An unrecognized explicit market
returns HTTP 400; an unknown text query returns an empty result. Platform and
lifecycle filters use case-insensitive exact values; unsupported values match
nothing. Empty filters are ignored. A query country and explicit market both
apply, so contradictory scopes can produce no matches.

`limit` defaults to 20 and accepts 1–100. `offset` defaults to 0 and must be
nonnegative. Ordering is by `asset_id` for stable pages in an unchanged catalog.

`include_global` defaults to false. It broadens country constraints to include
Global-scoped assets. It has no effect without a country constraint: ordinary
browsing includes Global assets. Global scope alone is not proof that German
data is available, so label these cards as broader scope.

## Response

Existing `query`, `count` and `assets` fields are preserved. Added fields:

| Field | Meaning |
| --- | --- |
| `resolved_query_market` | `{market_id, market_name}` when q resolves to a country/Global; otherwise null |
| `filters` | Effective market code, platform, lifecycle_status, include_global |
| `total` | Count of all matching assets before pagination |
| `limit`, `offset` | Current page parameters |
| `has_more` | Whether more matching records remain |
| `next_offset` | Offset for Load more, or null |

`count` is the length of this page's `assets` array, not the total. Asset fields
retain their existing names and values. No results and an offset past the end
return HTTP 200 with an empty array. Invalid parameter formats/ranges return
422; database failures return 503. `/assets/filters` returns `markets` as
`{market_id, market_name}` objects, `platforms` as strings, and
`lifecycle_statuses` as strings. Countries can have zero assets for the current
combination of filters.

## Instructions for Lovable

Connect Asset Explorer to `/assets/search` for initial browsing, searching and
filtering. Use `/assets/filters` for choices across the full catalog. Preserve
existing asset mapping, cards, details, mobile design and Analyze integration.

- Send `q`, `market`, `platform`, `lifecycle_status`, `include_global`, `limit`
  and `offset` as URL-encoded query parameters. Omit unselected filters.
- Default to 20 results. Reset offset and replace results when any criterion
  changes. Debounce text input and cancel or ignore stale requests.
- Load more with `next_offset`, preserving all current search/filter values;
  append results and disable the button when `has_more` is false.
- Show “Showing N of total matching assets” using the accumulated loaded count
  and backend `total`. Do not apply additional filters only to the loaded page.
- Show `Market: Germany (DE)` when resolved by the query or market dropdown.
  Offer an off-by-default Include global assets toggle for country searches.
- Preserve loading, empty, error and Retry states; never substitute demo data
  for failed live requests. If filter options fail, offer Retry without
  inventing dropdown choices.

## How the backend works

1. FastAPI in `main.py` reads and validates URL parameters.
2. `asset_search.py` resolves country names using the Markets table.
3. It builds SQL conditions from fixed field names and bound parameter values.
4. All active conditions are combined with AND, so every filter applies.
5. A COUNT query determines the total. A SELECT with the same conditions,
   ORDER BY, LIMIT and OFFSET retrieves the requested page.
6. FastAPI serializes the resulting Python dictionary into JSON for Lovable.

LIKE wildcard characters (`%`, `_`, backslash) are escaped so user text is
literal. Parameter binding keeps user values separate from executable SQL.

Offline verification (no AI requests or live database writes):

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -v
```
