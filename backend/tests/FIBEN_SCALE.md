# Large-schema benchmark: FIBEN

## Data provenance

Original benchmark: [IBM FIBEN](https://github.com/IBM/fiben-benchmark).
IBM's original raw-file URLs returned 404 during this run. The tested file is the
[public FIBEN SQLite mirror](https://huggingface.co/datasets/Rubyando59/ml-table-retrieval-benchmarks/tree/main/fiben/dev_database/fiben).
This financial benchmark models a data mart; it is not a live production database.
The downloaded database was used unchanged: no duplicated rows or padding tables.

- File: 510,201,856 bytes (about 487 MiB).
- SHA-256: `4499500e25aad7fff4b909b6c6a8b9d34bebcd84c85cbe401a83d2675acc4289`.
- Hash matches the mirror's published LFS SHA-256; SQLite `quick_check` returned `ok`.
- 152 tables, **41 nonempty**; 152 tables with primary keys and 145 FK entries.
- **11,668,125 stored rows** across tables (not distinct entities).
- Largest table: `ELEMENTSOFFINANCIALREPORT`, **8,120,084 rows**.
- Other large tables: HOLDING 534,473; MONETARYAMOUNT 502,745;
  SECURITIESTRANSACTION 500,000; ELEMENTOFFINANCIALSTATEMENT 443,794.

## What was tested and fixed

Connection/schema discovery loads all 152 tables. Tests send normal-text requests
through the dashboard API, load the saved report, execute its generated SQL through
the query API, and compare the returned rows with independently written source SQL.
The tests cover counts, filtering the largest table, averages, grouped counts,
top ten results, and financial-report-to-corporation joins.

The baseline spent approximately 16 seconds profiling unrelated tables for simple
grouping. The planner now resolves source-local fields first and uses declared
relationships before considering data-based inference. It also accepts source-table
qualified metrics and asks which source supplies a repeated field such as HASCOUNT.
These changes contain no FIBEN-specific production code.

An initial provider request failed with HTTP 413: the full-schema prompt requested
8,987 tokens against an 8,000 TPM allowance. Compact schema tuples and type families
retain all tables and columns. A successful subsequent request used 5,748 prompt
tokens and 5,885 total tokens. Calls still need to respect the provider's rate limits;
the live test deliberately paces requests and excludes that wait from timings.

## Measured deterministic results

One local sequential run, including planning, query execution and report saving:

| Request | Before | After |
| --- | ---: | ---: |
| Count monetary amounts by currency | 16.514 s | 0.212 s |
| Count corporations by domicile | 15.972 s | 0.046 s |
| Count financial reports by corporation legal name | 16.321 s | 0.143 s |
| Count the 8.12-million-row table | — | 0.247 s |
| Filter the 8.12-million-row table | — | 0.746 s |
| Top ten holding owners by holding count | Ambiguous unqualified measure | 0.429 s with source qualification |

All nine deterministic requests matched the source. Schema synchronization took
2.383 seconds in that run. These are observations, not SLAs; OS cache, hardware,
network, provider quota, and data distribution affect timings. Source oracles and
profiling warm the filesystem cache; this is not a cold-cache benchmark.

## Reproduction

The final live-model run passed **all 12 requests**: the nine deterministic cases
plus the three conversational requests below. The conversational requests took
2.394 s, 1.636 s and 1.821 s respectively, excluding provider-quota pacing.
Generated SQL, saved dashboard data and query reload results matched the source
oracles. The core dashboard regression and 21 coffee-data checks also passed.

Four saved FIBEN example dashboards and the `FIBEN scale benchmark (152 tables)`
connection are available in the existing local demo account. Follow-up UI verification
passed: signed in, opened all four saved dashboards, generated a new report from
“How many financial reports are available?”, saved it and reopened it successfully.
The UI displayed 8.1M, 534.5K, 502.7K and 500.0K overview counts and 48.3K financial
reports. The currency chart tooltip displayed the exact source count 502745.
Fixed clipped cards by preserving readable canvas dimensions and hiding empty
configuration panels until a widget is selected. Single-category charts now retain
their chart type and category label rather than silently becoming KPI cards.
Narrow viewports scroll the design canvas; dense corporation charts still have
crowded labels and should use a top-N request for easier reading.

Download `fiben/dev_database/fiben/fiben.sqlite` from the mirror above, then:

```powershell
$env:FIBEN_SQLITE = 'C:/path/to/fiben.sqlite'
$env:FIBEN_RESULT = 'C:/path/to/fiben-results.json'
python backend/tests/test_fiben_scale.py
```

The source must be on the same volume as the temporary directory because the test
uses a hard link to provision the account's read-only source without copying 487 MiB.
The test creates and removes isolated metadata and an API process; it leaves the
source file and JSON evidence intact.

Set `FIBEN_LIVE_MODEL=1` and `GROQ_API_KEY` for three additional free-form requests:

- “How many financial reports are available?”
- “For holdings, what is the average count?”
- “Show how many financial reports there are for each corporation's legal name”

## Limits

- This is one large SQLite benchmark, not a high-concurrency load test or a test of
  all 300 published FIBEN questions, every table, every join, or every engine.
- There are 152 native tables, not hundreds of populated tables: 111 are empty.
- Aggregate tests compare mathematical results; they do not establish financial
  business definitions or meaningful aggregation across different currencies.
- Some timestamp values use legacy DB2-style strings. Their temporal interpretation
  is not covered here; no dates were silently normalized during import.
- Follow-up on 25 November: above `MAX_INFERENCE_TABLES` (default 32), inference
  focuses on requested source/target parents, skips empty tables and uses bounded,
  request-local profiling. Direct and bridge relationships are covered; arbitrary
  inferred multi-hop paths and hard cancellation of running SQLite queries are not.
- Larger schemas may still exceed provider context/quota limits. Compact encoding
  is not a substitute for future schema retrieval and query-budget enforcement.
