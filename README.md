# Queryloom

Queryloom turns questions about a connected relational database into SQL, insights,
and saved dashboards. The React interface has light/dark themes, an 85% compact
scale, and five sections: Overview, Dashboards, Ask your data, Data, and Settings.

## What is supported

Queryloom is **not a universal connector for every database or data type**.

| Source | Implementation | Verification |
| --- | --- | --- |
| SQLite | Native sqlite3 driver; account-scoped local files | Isolation, unrelated schemas, composite/keyless joins, allocations, and real CQI data |
| MySQL 8+ | Native mysql2 driver; credentials and optional verified TLS | Real CQI data, conversational requests, rankings, filters, growth; earlier keyless weighted-join regression |
| PostgreSQL | Native pg driver; configured schema and optional verified TLS | Fresh PostgreSQL 16 regression for keyless composite joins and weighted totals |
| Supabase PostgreSQL | PostgreSQL database credentials, schema, mandatory verified TLS | Previously tested on hosted Supabase; hosted service was not retested in this audit |
| SQL Server, Oracle, MongoDB, Snowflake, BigQuery, other engines | No connector | Unsupported |

Supabase uses the direct or session-pooler **database** credentials, not its public
API URL or anon key. PostgreSQL connections use the selected schema. Cross-schema
joins and joins between separate connections are not implemented.

## How automatic dashboards work

1. Connect a source in **Data**, synchronize its schema, and choose **Set Active**.
2. Open **Dashboards**, describe your question, and select **Generate dashboard**.
3. Common phrasing is resolved locally from the schema. Broader phrasing uses a
   configured Groq model to produce a constrained plan, not dashboard SQL.
4. The planner validates fields, resolves supported joins, generates SQL for the
   selected engine, executes it, and saves KPI cards and charts.
5. Competing field or relationship interpretations produce clarification choices.

Supported plans include counts, totals, averages, multiple metrics, grouping,
monthly trends, year filters, AND-connected comparisons, top-N rankings, and
comparisons between two years. Not every combination is supported. Unknown
operations must be rejected rather than silently replaced with a sales query.
Growth is `(current - previous) / previous * 100`; zero or missing baselines produce
null percentages, displayed as `-`.

The planner can inspect declared keys or infer minimal unique column combinations
and reference coverage from observed data. Many-to-many allocations use valid
weights totaling 1 or 100 per source record. Ambiguous mappings/weights require a
choice. Unweighted overlap asks for equal allocation or full membership.

### Hardcoding audit

Review updated **24 November 2026**. This is a focused review of the dashboard,
query, connection and chart flows, not a proof that every line is free of
hardcoded values. The distinction is between dataset-specific answers and
intentional application rules/defaults.

- The main dashboard planner uses the connected schema; it has no sales-specific
  SQL shortcuts or named dashboard templates.
- Removed the legacy Python sales SQL fallback. That service now fails explicitly
  without a usable model instead of returning queries against sample tables.
- Removed sales/order-specific KPI field selection and automatic dollar/percent
  assumptions from field names. Units require explicit formatting.
- Grouped values are no longer automatically collapsed into a KPI just because the
  question includes “total” or “average.” Multi-metric single rows retain all fields.
- The retail seed, CQI import, test fixtures, chart palettes, supported-operation
  grammar, and engine-specific SQL are deliberate fixtures/configuration. They are
  not evidence of arbitrary-database support or dataset-specific query fallbacks.
- Demo SQLite paths and sandbox onboarding remain explicit sample options. Default
  API addresses, model settings, chart sizes, palettes, query limits and supported
  operators are configuration or application rules, not inferred business facts.
- Generic chart-selection heuristics and a model-free statistical narrative remain.
  They do not establish business meaning or guarantee correct answers for every
  request. The standalone SQL workspace has a different path from dashboard plans.
- Automated source-oracle checks are regression tests, not a runtime audit of every
  generated answer. Unsupported operations, large keyless schemas, precision and
  concurrency limits below still apply; production readiness is not established.

## Local demo access — this workstation only

These are intentionally documented **local demo credentials**, as requested. They
are not production accounts and do not exist automatically on a fresh checkout.

### Application account

| Setting | Value |
| --- | --- |
| Frontend | http://127.0.0.1:5173 |
| Demo API | http://127.0.0.1:61744/api |
| Email | `coffee.demo@example.test` |
| Password | `Coffee-667290f1a3544c26` |
| Workspace | Personal demo account; 15 CQI showcase reports, four FIBEN examples, and additional test reports |

### FIBEN dashboard walkthrough

1. Sign in using the application account above.
2. Open **Data** and select **FIBEN scale benchmark (152 tables)** with **Set Active**
   if it is not already active.
3. Open **Dashboards** and choose one of the four saved examples:
   `FIBEN | Large-table overview`, `FIBEN | Reports by corporation`,
   `FIBEN | Top holding owners`, or `FIBEN | Monetary records by currency`.
4. To generate a new report, enter **How many financial reports are available?**
   and click **Generate dashboard**. This exact UI flow, saving and reopening were
   verified; it displays approximately **48.3K** reports.

FIBEN is a local SQLite connection: **no separate database username or password**.
Its account-scoped file is `%LOCALAPPDATA%/TextToVizCoffeeDemo/2/fiben.sqlite` on
this workstation; that account ID is local demo state, not a portable setup value.
The unchanged source is `%LOCALAPPDATA%/QueryloomFiben/fiben-complete.sqlite`.
It contains 152 tables (41 populated), totaling 11,668,125 stored rows.
New conversational requests require a configured model key and available quota.
The large-schema report below documents all 12 source-verified requests and limits.

### Real-data MySQL connection

| Setting | Value |
| --- | --- |
| Display name | `CQI Coffee Quality — Real Data` |
| Type | MySQL |
| Host | `127.0.0.1` |
| Port | `3308` |
| Database | `coffee_quality` |
| Username | `queryloom_reader` |
| Password | `Ql-20387e271b8e2b309135` |
| TLS | Off for this loopback-only demo |
| Permissions | SELECT only |

This is a persistent local MySQL database containing **1,339 real historical Coffee
Quality Institute ratings**, not a live production feed. Country was normalized
into a dimension and dates converted to ISO format. The 15 reports contain six
KPIs and six charts each; all 180 widgets were checked against independent CSV
calculations. Reports cover countries, processing methods, 2012–2017 monthly
trends, Brazil/Colombia/Ethiopia profiles, and score bands.

Source: [CQI ratings via TidyTuesday](https://github.com/rfordatascience/tidytuesday/tree/main/data/2020/2020-07-07).
CSV SHA-256: `ae6fdd58f4a7f77397c11c2657e22be8aa8f746bdc5a74cf479e981bd3c25d5e`.

Demo state is outside the repository:

- `%LOCALAPPDATA%/TextToVizCoffeeDemo/metadata.db`: accounts, connections, reports.
- `%LOCALAPPDATA%/QueryloomMySQL/data`: persistent MySQL files.
- `%LOCALAPPDATA%/QueryloomMySQL/start-database.ps1`: restart MySQL after reboot
  when port 3308 is not already listening.
- `%LOCALAPPDATA%/TextToVizCoffeeDemo/showcase-manifest.json`: report names and requests.

The demo processes are not installed as auto-start services. To reopen its backend
from the project root in PowerShell (only if port 61744 is free):

```powershell
$env:PORT = '61744'
$env:METADATA_DB_PATH = "$env:LOCALAPPDATA/TextToVizCoffeeDemo/metadata.db"
$env:SQLITE_SOURCE_ROOT = "$env:LOCALAPPDATA/TextToVizCoffeeDemo"
$env:DOTENV_CONFIG_PATH = "$PWD/backend/.env"
node -r ./backend/node_modules/dotenv/config backend/server.js
```

In another terminal:

```powershell
$env:VITE_API_BASE = 'http://127.0.0.1:61744/api'
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Regression tests create temporary accounts such as `Alice@example.test` with
`test-only-password`, and `matrix@example.test` with `Isolated-test-only-2026`.
Those accounts belong to isolated temporary test databases and are **not** logins
for the persistent demo. Do not confuse them with the account above.

## Fresh checkout setup

Requires Node.js/npm and Python 3 for metadata initialization and test scripts.
Install dependencies from the project root:

```sh
npm --prefix backend ci
npm --prefix frontend ci
```

Initialize metadata only when the file does not already exist:

```sh
python -c "import sys,pathlib; sys.path.insert(0,'ai-engine'); from init_db import create_metadata_db; p=pathlib.Path('ai-engine/metadata.db'); create_metadata_db(str(p)) if not p.exists() else print('Keeping existing metadata')"
```

Start the backend from its directory so it loads `backend/.env`:

```sh
cd backend
npm start
```

Start the frontend in another terminal with `npm --prefix frontend run dev` from
project root. Its default API is `http://localhost:5001/api`. Register your own
account, then connect a database. The Python HTTP service is legacy and is not
required for the main Express/React flow.

Private SQLite files must be under `SQLITE_SOURCE_ROOT/<user-id>/` (default:
`sources/<user-id>/` in the project). The optional retail seed is explicitly a demo;
running `python ai-engine/init_db.py` also recreates its sample data, so do not use
that command as a routine migration step.

### Backend configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | API port, default 5001 |
| `METADATA_DB_PATH` | SQLite platform metadata location |
| `SQLITE_SOURCE_ROOT` | Root of private account-specific SQLite directories |
| `JWT_SECRET` | Stable private signing secret; required in production |
| `DB_CREDENTIAL_KEY` | Base64-encoded 32-byte encryption key; required in production |
| `GROQ_API_KEY` | Broader language interpretation and optional narratives |
| `GROQ_MODEL` | Primary model, default `openai/gpt-oss-120b` |
| `GROQ_FAST_MODEL` | Fast model, default `openai/gpt-oss-20b` |
| `MAX_INFERENCE_TABLES` | Threshold for request-focused inference; default 32. Above it, inferred parents are restricted to the requested source and target tables. |
| `MAX_INFERENCE_QUERIES` | Maximum distinct profiling queries per inference scope; default 2048. |
| `INFERENCE_BUDGET_MS` | Time budget checked between profiling queries; default 15000 ms. This does not cancel a query already running. |
| `NODE_EXTRA_CA_CERTS` | Optional private CA trust bundle for remote TLS |
| `AI_ENGINE_SERVICE_TOKEN` | Shared token if the optional legacy Python service is used |

Provider availability can change; configure a model available to your account.
Remote passwords are encrypted with AES-256-GCM. Keep the encryption key with
backups. Development creates a local encryption key and, without `JWT_SECRET`,
sessions become invalid after restarting the backend. Owner checks scope
connections, reports, and query history. Use read-only source database users.

The dashboard interpretation prompt includes schema and request text. Optional
insight/chart features can also send query-result samples to the model provider.

## Verification and reproduction

From project root:

```sh
python backend/tests/test_dashboard.py
node backend/tests/conversation-plan.cjs
node backend/tests/chart-schema-neutral.cjs
npm --prefix frontend run build
```

The core suite covers ownership isolation, other schemas, composite/keyless
relationships, allocations, invalid weights, and unsupported requests.

Real-data tests:

```powershell
$env:COFFEE_CSV = 'C:/path/to/coffee_ratings.csv'
python backend/tests/test_real_coffee.py
```

Set `COFFEE_CONNECTION_FILE` to normal MySQL connection-form JSON targeting an
**empty disposable database** to run those tests on MySQL. The importer creates
tables; it does not drop them. Add `COFFEE_LIVE_MODEL=1` and `GROQ_API_KEY` to test
three live-model phrasings and ambiguity resolution. Offline coverage has 21
successful requests; the live-model run has 24, plus clarification checks.

For PostgreSQL 16 on Windows:

```powershell
$env:POSTGRES_BIN = 'C:/Program Files/PostgreSQL/16/bin'
python backend/tests/test_postgres_dashboard.py
```

This starts an isolated loopback-only PostgreSQL instance and temporary API, checks
weighted composite joins without declared keys, then shuts them down.
For another provisioned source, use `backend/tests/test_live_dashboard.py` and
`weighted_fixture.sql`; supply `LIVE_API_BASE`, `LIVE_AUTH_TOKEN`, and
`LIVE_CONNECTION_FILE`. Keep real credentials out of test fixtures.

Optional browser checks require `playwright-core` and `BROWSER_EXECUTABLE` pointing
to a Chromium browser. Set `COFFEE_BROWSER=1` for real-data rendering checks or
`DASHBOARD_BROWSER_TEST=1` for the core suite. See
[real-data test notes](backend/tests/REAL_DATA.md) for details.

`backend/tests/populate_coffee_showcase.py` creates/verifies the 15-report showcase
using an already imported database. Its docstring lists the required environment
variables. It compares every saved widget against CSV calculations and saves
compact layouts; it is a demo population tool, not a production template engine.

## Limits and production gaps

- Passing these tests does not establish correctness for every schema, phrasing,
  query, or engine. Automated reports are not automatically audited against an
  independent source at runtime; the regression suite supplies that oracle.
- Plans have bounded operations and grammar. OR filters, arbitrary formulas,
  fiscal calendars, arbitrary date comparisons, and all SQL features are not
  universally supported. A model can still misinterpret business meaning.
- Key inference checks observed data, not future uniqueness or business semantics.
  Large tables can make exhaustive profiling expensive; broad scale/load testing
  and a statistics-based inference strategy remain necessary.
- JSON, arrays, blobs, geospatial types, timezone semantics, and exact high-precision
  financial arithmetic are not comprehensively validated. Some numeric values are
  converted to JavaScript numbers; precision-sensitive use needs further work.
- The standalone Query Workspace and legacy Python service have different model
  paths from the constrained dashboard planner. Do not assume identical guarantees.
- SQL validation and read-only transactions are not a complete tenant security
  architecture. Deployment still needs network controls, secret management,
  auditing, backups, and workload limits appropriate to its environment.
- These are Queryloom dashboards, not exported Microsoft Power BI reports.
- The frontend build passes but retains a large-bundle warning; code splitting and
  broader accessibility/performance testing remain open work.

## Structure

- `frontend/`: React, TypeScript, Vite, chart rendering and dashboard editor.
- `backend/`: Express API, authentication, source drivers, schema/relationship plans.
- `backend/tests/`: isolated regressions, real-data checks and showcase population.
- `ai-engine/`: metadata initializer and optional legacy Python service.

## Large-schema scale test

The unmodified public FIBEN SQLite mirror contains **152 tables (41 populated)**
and **11,668,125 stored rows**, including one table with 8,120,084 rows. All 12
dashboard checks (nine deterministic and three live-model conversational requests)
match independently written source SQL. Local-field
resolution and declared-join planning reduced representative grouped requests from
about 16 seconds to 0.05–0.21 seconds in one sequential run.

See [FIBEN results, provenance, limits and reproduction](backend/tests/FIBEN_SCALE.md).
This is not proof of high-concurrency production readiness or universal support
for large keyless schemas.

The existing demo account includes the **FIBEN scale benchmark (152 tables)**
SQLite connection and four saved FIBEN dashboards. Use the demo login documented
above; SQLite requires no separate database password. Follow-up UI verification passed for all four saved dashboards and a new conversational
request, including save and reopen. Fixed clipped canvas cards and single-category
charts losing their category labels. Open http://127.0.0.1:5173 and use the demo
login above; choose the FIBEN connection in Data for new requests.

## Production hardening follow-up — 25 November 2026

- Large catalogs no longer fail solely because they exceed 32 tables. Inference
  skips empty tables and, above the threshold, profiles candidate references only
  into the requested source and target tables. It covers direct relationships and
  bridges referencing both; arbitrary inferred multi-hop chains remain unsupported
  in this focused mode.
- Exact coverage and uniqueness checks remain required. Profiling results are
  memoized only within the current inference scope, not shared across users or
  requests. Query-count and elapsed-time budgets stop further profiling with an
  explicit error rather than saving an unverified dashboard.
- Regression checks include 153 tables with differently named, undeclared composite
  keys and allocation weights; and a separate 152-table keyless database with
  100,000 fact rows and ordinary nonunique indexes. The latter is a synthetic scale
  regression, distinct from the unchanged public FIBEN benchmark.
- Ambiguous keys, relationship paths and allocation policies still ask for a choice;
  no report is saved until resolved. Fully automatic answers are appropriate only
  when the supported request is unambiguous. Business meaning cannot be inferred
  reliably from uniqueness alone.
- Verification: the expanded API integration suite passed, including isolation,
  weighted totals, ambiguity/resume, 100,000-row keyless joins and forced profiling
  budget exhaustion with no partial report saved. All nine deterministic FIBEN
  checks and the conversation-plan/chart-selection tests passed. This follow-up
  used the dashboard API and saved-widget reload path; it did not repeat browser
  rendering or live-model/provider tests.
- Cleanup was requested for disposable outputs while retaining regression sources.
  Automatic approval review blocked the deletion command, so caches, the duplicate
  FIBEN download and failed-test temporary directory were not removed.
- These changes do not establish production readiness: concurrent writes can change
  data between profiling and execution, SQLite profiling has no hard per-statement
  cancellation here, and broad concurrency/security/precision work remains open.
