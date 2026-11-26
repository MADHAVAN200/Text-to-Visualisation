# Real-data dashboard regression

Dataset: [Coffee Quality Institute ratings via TidyTuesday](https://github.com/rfordatascience/tidytuesday/tree/main/data/2020/2020-07-07).
Download `coffee_ratings.csv` from that directory and set `COFFEE_CSV` to its local path.
The verified file contains 1,339 observations; SHA-256:
`ae6fdd58f4a7f77397c11c2657e22be8aa8f746bdc5a74cf479e981bd3c25d5e`.

Run `python backend/tests/test_real_coffee.py` from the repository root.
The test creates an isolated application account and SQLite source. It retains all
observations, converts grading dates to ISO dates, selects numeric measures, and
normalizes country into a separate dimension to exercise joins. This is historical
real-world data, not a live feed or an originally relational dataset.

Six requests cover row counts, country averages, two metrics with a year filter,
polite wording, monthly counts, and processing-method averages. Expected values
are calculated independently from the original CSV. Every generated widget SQL
is executed and compared, including null groups (one missing country and 170
missing processing methods). Single-metric requests also run through Query Workspace's API.

Reference totals: 1,339 ratings, average cup points 82.0898506348, 2015 bags
36,136, 2015 average aroma 7.5959898477, and 262 ratings in 2014.

For MySQL 8, set `COFFEE_CONNECTION_FILE` to a JSON file with the normal connection
form fields and an **empty disposable database**. The loader creates and populates
`ratings` and `countries`; it does not drop them afterward. Keep credentials outside
the repository. The local verification used a temporary MySQL instance removed
after the run.

For UI verification, install `playwright-core` where Node can resolve it, set
`BROWSER_EXECUTABLE` to a Chromium-family browser, and set `COFFEE_BROWSER=1`.
The browser signs in and submits the two-metric request, then checks rendered bars,
the formatted 36.1K KPI, and visible country labels. API comparisons check every
category, including labels omitted by automatic chart tick spacing.

These cases exercise schema-driven aggregate planning without an LLM key. They do
not establish arbitrary natural-language coverage, real-world weighted bridge
coverage, or Microsoft Power BI export. Weighted and keyless relationships have a
separate synthetic regression suite.

## Complex requests

The suite now also checks top-10 sums and averages, ranking with a numeric filter,
combined text/numeric/year filters, a filter through the country join, and growth
between 2014 and 2015 both overall and by country. A zero-baseline comparison
checks that percentage growth stays null. There are 13 successful requests plus
three rejection checks for malformed filters, unknown fields, and invalid limits.
Ranking compares ordered results; all other results compare every group and metric
with independent CSV calculations. These pass on SQLite and MySQL 8.

Examples supported without a model key:

- `Show top 10 country of origin by total number of bags`
- `Show average total cup points by country of origin in 2015 where processing method = "Washed / Wet" and aroma >= 7.5`
- `Show growth in total number of bags from 2014 to 2015 by country of origin where aroma >= 7.5`

Growth produces previous value, current value, absolute change, and percentage
change. Missing groups are retained with null values; missing or zero baselines
produce an undefined percentage rather than infinity or zero. The overall change
is calculated from overall source values, not averaged group percentages.
Top-N uses descending metric order and category order to resolve ties. Filters
currently support AND-connected comparisons and null checks, with quoted text
values. Unsupported expressions are rejected rather than silently ignored.
These are bounded schema-driven language patterns, not arbitrary conversational
understanding. The dataset contains no real allocation weights.

## Conversational interpretation

Eight additional offline phrasings verify schema-derived aliases, polite wording,
ranking, growth, and filters. Set `COFFEE_LIVE_MODEL=1` and `GROQ_API_KEY` to also
exercise three free-form prompts through the real model, plus an ambiguous
quality-versus-volume question and its clarification response. The model returns
a constrained plan, never SQL; schema validation and the existing join planner
compile it. `GROQ_MODEL` and `GROQ_FAST_MODEL` override provider model IDs.
Defaults were checked against the connected account's available model list.
No credentials or source rows are included in the model prompt; the schema and
the user's request are included. Offline rules remain available without a key.

Run `node backend/tests/conversation-plan.cjs` for ambiguous-alias and invalid
model-plan checks. These tests establish coverage for their cases, not universal
semantic correctness. Unsupported operations still need a supported plan.
