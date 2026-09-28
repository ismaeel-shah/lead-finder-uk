# UK Company Lead-Finder

Turns newly incorporated UK companies into leads. For a date range you choose, it:

1. Pulls the new companies from the official **Companies House API**.
2. Looks for each company's **Facebook page** and **Google Business Profile** through a search API (Serper by default).
3. If nothing is found, takes the company's **director**, finds the **other companies** they run (through the officer ID, not a name search), and looks for those instead. This goes one level deep only.
4. For every lead found, also looks up the **directors**, the company's **LinkedIn page** and the **director's LinkedIn profile**.
5. Shows everything in a **live dashboard** and exports it to **CSV**.

The full build spec is in [UK_Company_Lead_Finder_Build_Spec.md](UK_Company_Lead_Finder_Build_Spec.md).

**Stack:** Next.js 15 (App Router, TypeScript strict) · Tailwind CSS v4 + shadcn/ui · PostgreSQL + Prisma 6 · Zod · Vitest · Vercel.

---

## Quick start

Requirements: **Node.js 20+** and a **PostgreSQL 14+** database (see [Database](#database)).

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL, COMPANIES_HOUSE_API_KEY, SERPER_API_KEY
npm run db:up             # local Postgres via Docker (skip if you use a hosted database)
npx prisma migrate dev    # create the tables
npm run dev               # http://localhost:3000
```

If a required key is missing, the dashboard says which one instead of crashing.

## Getting API keys

| Key | Where | Cost |
| --- | --- | --- |
| `COMPANIES_HOUSE_API_KEY` | Register at https://developer.company-information.service.gov.uk/, create an application and add a **REST** key. | Free. Limited to 600 requests per 5 minutes. |
| `SERPER_API_KEY` | Sign up at https://serper.dev and copy the key from the dashboard. | Pay per search credit; new accounts get free trial credits. See [Search credit costs](#search-credit-costs). |
| `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_ID` | Optional. Google Programmable Search. Set `SEARCH_PROVIDER=google_cse`. | Facebook search only: with this provider no Google Business results are returned. |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | – | Postgres connection string (**required**). |
| `COMPANIES_HOUSE_API_KEY` | – | **Required.** |
| `SEARCH_PROVIDER` | `serper` | `serper` or `google_cse`. |
| `SERPER_API_KEY` | – | Required when the provider is `serper`. |
| `MATCH_THRESHOLD` | `0.85` | Similarity (0–1) needed to accept a result. Raise it for fewer false positives, lower it for more matches. |
| `BATCH_SIZE` | `10` | Companies per `/process` call. |
| `MAX_OWNER_COMPANIES` | `10` | Most of a director's other companies to check in the fallback. |
| `FACEBOOK_LOCATION_CHECK` | `strict` | `strict`: pages abroad and personal profiles are rejected, and a Facebook-only match (no Google listing) must show UK evidence. `lenient`: only pages clearly abroad and personal profiles are rejected. `off`: no check. See [Location checks](#location-checks). |
| `LINKEDIN_SEARCH` | `found` | LinkedIn company page + director profile search: `found` (leads only), `all` (every company that isn't an error), or `off`. |
| `APP_PASSWORD` | – | If set, the whole app (pages and API) requires this password. |
| `APP_SECRET` | – | Long random value (16+ characters) that encrypts search API keys saved from the dashboard. Required to add keys there. Changing it makes saved keys unreadable, so they must be added again. |

## Database

Any Postgres 14+ works. The database must use **UTF-8 encoding**, because search results contain emoji and other non-Latin characters. Hosted providers and the Docker image already use UTF-8. A Postgres installed on Windows may default to `WIN1252`; in that case create the database with `CREATE DATABASE leadfinder ENCODING 'UTF8' TEMPLATE template0;`.

- **Docker:** `npm run db:up` starts Postgres 16 with the credentials already in `.env.example`.
- **Hosted:** a free [Neon](https://neon.tech), [Supabase](https://supabase.com) or Vercel Postgres database works. Put its connection string in `DATABASE_URL`.

## Using the dashboard

- **Sidebar:** every run, with its date range, filters, progress and lead count. Click one to open it. On phones it opens from the menu button.
- **Delete a run:** hover over it in the sidebar (on phones the icon is always shown) and click the trash icon. A confirmation window shows what will be removed; deleting is permanent, so export to Excel first if you want to keep the leads.
- **New run** (button, or press **N**): pick a date preset (Today, Yesterday, Last 7 days, This month, Last month) or exact dates, and optional filters (company type, status, SIC codes, location). Click **Fetch companies**.
- **Ready screen:** how many companies were found and the estimated search credits, with a warning for large runs. Click **Start processing**.
- **Run view:**
  - A progress chart showing Found / No match / Errors / Queued, each with a label and count.
  - Four headline numbers: leads found (direct vs via owner), no match, errors, and credits used (per company).
  - **Pause / Resume**, **Retry errors** and **Export CSV**.
- **Results:** filter tabs with counts, name search, and 50 rows per page. On phones the table becomes a card list. Click any company for the detail drawer: Facebook, Google and Companies House links, phone and website, the match score, how it was matched, directors and the registered office.
- Notifications confirm actions and announce when a run finishes. Light, dark and system themes are in the sidebar footer.
- The selected run is kept in the URL (`?job=<id>`), so reloading or reopening that link brings you back to it.

**Processing runs from the browser.** There is no background worker (Vercel functions are short-lived), so while a run is going, the open dashboard keeps asking the server for the next batch. Closing the tab pauses the work in effect, and opening the run again carries on where it stopped. Several tabs on the same run are safe.

## Excel export

**Export Excel** (`GET /api/jobs/{id}/export.xlsx`) downloads a formatted workbook. This is the file to use when reading or sharing leads:

| Sheet | What's on it |
| --- | --- |
| **Summary** | The run (dates, filters, export time), the numbers at a glance (leads found, direct vs via the director, no match, errors, credits), and a short guide to reading the file. |
| **Leads** | Found companies only: company, Companies House link, incorporation date, director and other directors, how it was found, the name it's online as, Facebook, Google listing, phone, website, business address, company and director LinkedIn, confidence, registered office, SIC codes. |
| **All companies** | Every company, with a coloured **Result** (Lead found / No match / Error / Not processed yet) and a plain-English **Details** column explaining why. |

**Formatting:**
- **Headers and filters:** a coloured header row with filter buttons; the header and first column stay in view while scrolling.
- **Links:** every link is clickable, and company numbers open the Companies House record.
- **Values:** dates are real Excel dates, confidence shows as a percentage, and director names are shown as "Thomas Andrew Milward" rather than the register's "MILWARD, Thomas Andrew".
- **Size:** the workbook is streamed, so large runs work too. A 24,000-company run produced a 3.4 MB file in about 10 seconds.

## CSV export

**CSV** (the smaller button beside it, `GET /api/jobs/{id}/export.csv`) is the raw data for importing into other tools, such as a CRM. It downloads every result for the job with these columns in this order:

```
company_name,company_number,incorporation_date,status,facebook_url,google_business_url,google_business_name,google_business_address,google_business_phone,google_business_website,match_source,matched_via_company,matched_via_company_number,officer_name,facebook_score,google_business_score,note,linkedin_company_url,linkedin_director_url
```

The first 17 columns are exactly Section 11 of the spec; the two LinkedIn columns are appended at the end.

- **Encoding:** UTF-8 with a BOM so Excel detects it, RFC 4180 quoting, and `YYYY-MM-DD` dates.
- **Codes:** `status` is `found`, `no_match`, `error` or `pending`; `match_source` is `business` or `owner_other_business`. For errors, `note` holds the error message.
- **Streaming:** rows are streamed from the database in chunks, so large jobs export without running out of memory.
- **Formula protection:** a value starting with `=`, `+`, `-` or `@` gets a leading `'` so spreadsheets don't run it as a formula (OWASP guidance for CSV files; several fields come from third-party search results). As a side effect, phone numbers appear as `'+44 …` in plain-text viewers; Excel hides the apostrophe.

## Location checks

Many new UK companies share their name with a business abroad, and search results return those too. On live data, 120 of 141 Facebook-only matches were wrong: same-named pages in the US, Peru, India, Brazil, Jamaica and elsewhere, or personal profiles. Search results have no structured address, but Facebook titles usually end with the page's town ("Acme Plumbing | Bristol", "Rise Tennis | Franklin TN"), and snippets mention towns, countries, phone numbers and websites. `lib/location.ts` reads these in three tiers:

1. **Clearly abroad** (always rejected): the page town is a known foreign place or ends in a US/Canadian/Australian state code, a "City, ST" address, a +1 phone number, or a foreign website such as `.com.mx`.
2. **UK evidence**: the registered office town or postcode, any UK postcode, a UK phone number, a `.uk` website, "UK/England/Scotland/Wales/Northern Ireland", or a UK town or county (a list of about 400; foreign names like "New York" are removed first, so they aren't read as York).
3. **Weakly abroad**: a country or foreign city named in the text. This only counts when there is no UK evidence, since a UK restaurant may mention "food from Italy".

**Rules:**
- **Facebook pages:** rejected if abroad or a personal profile ("…is on Facebook. Join Facebook to connect…", "Lives in…"). With `FACEBOOK_LOCATION_CHECK=strict` (the default), a Facebook-only match must also show UK evidence. A page with no location information is kept only when a UK Google listing backs the lead up.
- **Google listings:** rejected if the address is clearly abroad, meaning a country anywhere in it, a US state and ZIP, or non-Latin script. Street-only UK addresses are kept.
- **Words in the company's own name are ignored**, so "Paris Nails Ltd" isn't treated as French.

**Fixing results saved before these checks:** `npm run recheck:facebook` re-checks every saved lead against the search cache and costs no credits. It's a dry run by default and prints what would change.
- `--apply` removes the rejected links. A company left with no link becomes "No match", with the note "A Facebook page with this name exists, but it is abroad or not confirmed as UK".
- `--requeue` puts those companies back in the queue instead, so pressing **Resume** re-processes them, including the director fallback (this can spend credits).

## LinkedIn

LinkedIn links come from ordinary search results (`site:linkedin.com/...`), the same way as Facebook. LinkedIn itself is never fetched or scraped.

- **Company page:** searches `site:linkedin.com/company "<name>"` for the business that was found online (for "via owner" leads, the director's other company). Accepted with the same name-matching rules and threshold as Facebook.
- **Director profile:** searches `site:linkedin.com/in "<First Surname>" <company>`. A profile is accepted only when the **first name and surname match exactly** and the result is also tied to the director some other way:
  - one of their companies appears in the title or snippet (score 1.0), or
  - failing that, the registered office town or postcode district appears (score 0.9, labelled "check before contacting").
  A bare name match is never accepted, because common names would give the wrong person.
- **Cost:** up to 2 extra credits per lead (both searches are cached). With `LINKEDIN_SEARCH=all` it runs for "No match" companies too.
- **Failures:** a failed LinkedIn search never changes a lead's status.
- **Data protection:** a director's profile is personal data under UK GDPR. It's fine for B2B outreach under legitimate interest, but record opt-outs and don't contact people who object.

## Search API keys (automatic switching)

Open **Search API keys** at the bottom of the sidebar to manage Serper keys:

- **Add** as many keys as you like (for example from several Serper accounts). Each key is checked with Serper before it is saved; the check is free.
- **Order:** keys are used top to bottom (arrows to reorder). When a key runs out of credits, or Serper rejects it, the next one takes over in the middle of a run, and the run carries on. A run only pauses when **no** key can be used; the notice then has a **Manage keys** button.
- **Balances:** each key shows its credits left (read from Serper's free `/account` endpoint when the panel opens, counting down as the app searches) and how many searches this app has made with it. **Check balance** re-reads it.
- **Top-ups:** an exhausted key is re-checked automatically (at most every 5 minutes, free) and used again once it has credits.
- **Turn off / remove** keys at any time. `SERPER_API_KEY` from `.env`, if set, appears as a key too. It can be reordered or turned off here, but removed only from `.env`.
- **Security:** keys are encrypted with AES-256-GCM using `APP_SECRET`, never sent to the browser (only the last four characters are shown), and the panel is behind `APP_PASSWORD` like the rest of the app. Set both on any deployment reachable from the internet.
- **Cache:** search results are cached per search, not per key, so a search already made with one key is never paid for again with another.

## Password protection

Set `APP_PASSWORD` to protect everything:

- **Pages** redirect to `/login`; **API routes** answer `401 { "error": ... }`.
- **Session:** after logging in, an HttpOnly cookie is set for 30 days. It holds an HMAC derived from the password, never the password itself. Changing `APP_PASSWORD` signs everyone out.
- **Guessing:** wrong passwords are answered after a short delay.
- **Sign out** is in the dashboard header.

With `APP_PASSWORD` empty, there is no login.

## Deploying to Vercel

1. **Create a hosted Postgres database** (Neon, Supabase or Vercel Postgres) and note two connection strings:
   - a **pooled** one for the app. On Neon, use the `-pooler` host and add `pgbouncer=true&connection_limit=5` to its query string (5 matches the companies processed at once in a batch).
   - a **direct** (non-pooled) one for migrations.
2. **Run the migrations once** from your machine against the direct URL:
   ```bash
   DATABASE_URL="<direct connection string>" npx prisma migrate deploy
   ```
   Run this again whenever `prisma/migrations` changes.
3. **Import the repository** in Vercel (New Project → Import). The framework preset is detected as Next.js; keep the default build command (`npm run build`, which runs `prisma generate` first).
4. **Add environment variables** in Project → Settings → Environment Variables: `DATABASE_URL` (pooled), `COMPANIES_HOUSE_API_KEY`, `APP_SECRET` (to save search keys from the dashboard), optionally `SERPER_API_KEY`, and optionally `APP_PASSWORD`, `MATCH_THRESHOLD`, `BATCH_SIZE`, `MAX_OWNER_COMPANIES`. Set `APP_PASSWORD` for any deployment reachable from the internet.
5. **Deploy.** `vercel.json` runs the functions in London (`lhr1`), next to a Neon database in AWS eu-west-2; keep the two in the same region, since every database query crosses that distance. The fetch, process and export routes set `maxDuration = 60`; the Hobby plan allows up to 60 seconds, which is enough, because each call stops starting new work after 40 seconds.

## Search credit costs

Each **uncached** Serper request costs 1 credit; cached ones are free.

| Step | Credits |
| --- | --- |
| Direct search for a company | 2 (Facebook + Places), or 3 when Places finds nothing and the organic fallback runs |
| Owner fallback | up to 3 per other company, checking up to `MAX_OWNER_COMPANIES` (default 10), stopping at the first match |
| LinkedIn (per lead, `LINKEDIN_SEARCH=found`) | up to 2 (company page + director profile) |
| Re-running a range already processed | ≈ 0 (search cache, 30 days) |

**Measured on live data** (September 2026 plumbing companies in Bristol, Manchester and Birmingham): 8 companies used 33 credits, about **4 per company**. The theoretical worst case is 33 per company (3 direct + 3 × 10 for the fallback), but fallbacks usually end early because most directors have few other companies. The dashboard shows an estimate before you start processing. For budgeting, allow roughly **4–6 credits per company**. Check Serper's current price per credit on serper.dev.

**When credits run out:** Serper answers "Not enough credits". The app then **pauses the run automatically** and shows a notice; no company is marked as an error, and the one that hit the limit goes back in the queue. Top up at serper.dev and click **Resume**. Very large runs (tens of thousands of companies) need tens of thousands of credits, so check the estimate on the ready screen first.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop, build (runs `prisma generate` first), serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest); the database tests are skipped unless `TEST_DATABASE_URL` is set |
| `npm run test:ch -- [YYYY-MM-DD]` | Live check of the Companies House client: 5 companies from yesterday (or the given day), plus the first one's officers and their other companies |
| `npm run test:search -- "Company Name" [--no-cache]` | Live check of the search layer: every Facebook and Google Business candidate with its score, the chosen result, and credits used |
| `npm run recheck:facebook [-- --apply \| --requeue]` | Re-check saved leads with the location checks, using the cache only (no credits). Dry run unless `--apply` or `--requeue` is given. |
| `npm run db:up` / `npm run db:migrate` | Start Docker Postgres / run migrations in development |

### Database integration tests

`tests/jobs.integration.test.ts` checks the job lifecycle against a real Postgres: fetching, atomic row claiming, stuck-row reset, pause/resume, retries, counters and result filters.

```bash
# use a separate database: the tests delete every job in it
export TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/leadfinder_test
DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy
npm test
```

## API

All routes return JSON (except the CSV export). Errors are always `{ "error": "..." }` with a matching status code: 400 invalid input, 401 not signed in, 404 unknown job, 409 wrong job state, 502 upstream API failure, 503 database unreachable or not migrated.

| Route | Purpose |
| --- | --- |
| `POST /api/jobs` | Body `{ incorporatedFrom, incorporatedTo, companyType?, companyStatus?, sicCodes?, location? }`. Creates a job and fetches companies for up to ~40 s. Returns `{ job, fetch: { done, totalCompanies, nextDate } }`. |
| `POST /api/jobs/{id}/fetch` | Continues fetching until `fetch.done`. The position is stored on the job; a failed fetch can be retried. |
| `POST /api/jobs/{id}/resume` | Starts (READY) or resumes (PAUSED) processing. |
| `POST /api/jobs/{id}/process` | Processes one batch of up to `BATCH_SIZE` companies. Returns `{ processed, remaining, status }`. |
| `POST /api/jobs/{id}/pause` | Pauses a running job. |
| `POST /api/jobs/{id}/retry-errors` | Re-queues every Error row and sets the job running. |
| `GET /api/jobs/{id}` | Summary and counters, plus `remaining` and `viaOwnerCount`. |
| `DELETE /api/jobs/{id}` | Permanently deletes the run and its results. The search cache is kept, so re-running the same range costs no credits. |
| `GET /api/jobs/{id}/results` | `?status=all\|found\|via_owner\|no_match\|error\|pending&search=&page=&pageSize=` (50 by default, 200 max). |
| `GET /api/jobs/{id}/export.csv` | CSV download of all results. |
| `GET /api/jobs` | The 50 most recent jobs. |
| `POST /api/login`, `POST /api/logout` | Password session (only when `APP_PASSWORD` is set). |

### How it stays within Vercel limits

- **Fetching** runs for about 40 seconds per call and saves its position (day + `start_index`) after every page.
- **Batches** claim rows with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, so overlapping calls never get the same company. Five companies are processed at a time, each result is saved as soon as it's ready, and rows not started within 40 seconds go back to the queue.
- **Stuck rows**, left in PROCESSING for more than 5 minutes (e.g. after a crash), are reset at the start of every batch and on resume.
- **Rate limiting:** Companies House requests go through a token bucket (burst 20, then 500 per 5 minutes, so at most 520 in any 5-minute window against the limit of 600). HTTP 429 responses are retried with exponential backoff.

## Project layout

```
app/                   pages (dashboard, login) and API routes under app/api/jobs
components/dashboard/  dashboard UI; components/ui holds the shadcn-style primitives
hooks/use-job-runner   drives fetching/processing from the browser and polls every 3 s
lib/companiesHouse.ts  Companies House client (rate limiting, retries, Zod-validated)
lib/matching.ts        name normalisation, similarity, Facebook URL rules, UK address check
lib/search/            search providers (Serper, Google CSE), 30-day cache, credit counting
lib/processCompany.ts  per-company logic: direct search, then owner fallback
lib/jobs.ts            job lifecycle: fetch steps, batch claiming, pause/resume/retry, queries
lib/csv.ts, lib/auth.ts, middleware.ts   CSV export, password protection
prisma/                schema and migrations
scripts/               test:ch and test:search live checks
tests/                 Vitest unit tests and the database integration tests
```

## Known limitations

- **Many new companies have no online presence yet**, so a high "No match" rate is normal. The owner fallback finds most of the leads that are found.
- **Accuracy depends on the search provider and `MATCH_THRESHOLD`.** Generic names ("Precision Plumbing") can match a different business of the same name. Google Business results are checked against UK addresses, but Facebook pages have no address to check, so treat low scores (0.85–0.9) on generic names with care. Raise `MATCH_THRESHOLD` for fewer false positives.
- **Google Business data comes from Serper's Places results**, not the official Google Places API. Switching to the official API is a possible future upgrade.
- **Companies House's search can't page past 10,000 results**, so companies are fetched one day at a time. A single day with more than 10,000 incorporations (not seen in practice; typical days have 1–3k) would be cut off, with a warning in the logs.
- **The Companies House rate limiter runs per server instance.** Normally only one instance handles a job at a time; otherwise the 429 retries absorb the overlap.
- **Processing needs an open dashboard tab**, since there is no background worker.
- **Data protection:** Companies House data is public, but any outreach to these leads must follow UK GDPR and PECR (for example the B2B marketing rules and opt-out handling). This tool only collects public business links; it does not contact anyone.

## Design decisions and assumptions

Where the spec was open or didn't fit, these choices were made:

**Companies House**
- **Day-by-day fetching:** a `start_index` of 10,000 or more returns HTTP 500 (checked against the live API), and one month can have 50,000+ companies. The fetch position is stored in an extra column, `Job.fetchCursor`.
- **Stuck rows:** a second extra column, `CompanyResult.claimedAt`, records when a row was claimed so stuck ones can be detected.
- **Director names:** spec 4.2 asks for them to be stored, but the schema has no column, so there's a third extra column, `CompanyResult.directorNames`. It's filled during the owner fallback.
- **Choosing the owner:** the primary officer must have an appointments link (the fallback depends on it); officers without one are skipped. If an officer holds several roles in the same company, that company is listed once. Only the first 50 appointments are read, as the spec says.
- **Empty and bad responses:** a 404 from Companies House means "nothing found". Malformed items are logged and skipped rather than failing the whole page.

**Matching**
- **Similarity score:** the higher of normalised **Levenshtein** and the token-set ratio. Jaro-Winkler was rejected because it rates names that start the same too highly ("smith builders" vs "smith brothers" ≈ 0.9).
- **Differing short words:** when both names contain a short word (≤ 4 letters) the other lacks, only the token-set ratio counts. This stops "SCN Refrigeration" matching "NCS Refrigeration", a false match seen on live data.
- **Name normalisation:** dots and apostrophes are removed so letters join ("J.K." → "jk"); other punctuation becomes a space. Suffixes are stripped repeatedly but never to an empty name.
- **Search queries** drop legal forms and a trailing "Co" but keep "Group" and "Holdings", which make the quoted phrase more specific.
- **Facebook titles:** also scored without trailing " - text" or " | text" (e.g. "Provenance Potatoes Limited | Great Mongeham", seen live), keeping the best score.
- **Facebook URLs:** blocked paths are matched as whole segments; sub-pages are cut back to the page; `profile.php?id=` keeps its ID.
- **Location bonus:** candidates are ranked before the 1.0 cap, so the bonus can still pick between two exact-name matches.

**Search**
- **UK location:** every Serper request sends `gl: "uk"` **and** `location: "United Kingdom"`. Without `location`, Serper searched around its own US servers, which returned Virginia and Pennsylvania businesses for UK names and sometimes missed UK businesses entirely. Seen on live data.
- **UK address check:** Google Business results whose address is clearly outside the UK (US state + ZIP, Canadian postcode, or a trailing foreign country) are dropped as a second safeguard.
- **Google Business fallback:** Places is searched without quotes. If it returns nothing, one organic search `"<name>" UK` runs, accepting Google Maps links or a knowledge-graph panel that has an address, phone or `cid`.
- **Cache:** parsed results are stored, keyed by provider, type and exact query (including the location). **Empty results are trusted for 24 hours only**, and non-empty ones for 30 days, so an unlucky empty response can't hide a business for a month. Failed requests are neither cached nor counted.

**Jobs and dashboard**
- **Date range:** at most 366 days, and it can't end in the future (UK time).
- **Starting and retrying:** `/resume` also starts a READY job. `/retry-errors` sets the job running again.
- **Counters** are recounted from the rows rather than incremented, so they can't drift; credits are added up per company.
- **Dashboard error handling:** network, 502 and 503 errors are retried with backoff; other errors stop the loop and show a **Try again** button. A 401 reloads the page, which sends you to the login page.
- **Versions:** Next.js 15 and Tailwind v4 (the spec asks for Next.js 14+). Prisma is pinned to v6.
