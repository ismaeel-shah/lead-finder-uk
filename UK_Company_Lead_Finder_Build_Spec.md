# Build Spec: UK Company Lead-Finder

> **Instructions for the AI building this:** Read this entire document before writing any code. Build the application exactly as specified. Where something is ambiguous, choose the simplest option that satisfies the acceptance criteria in Section 13, and note your assumption in the README. Build in the phases listed in Section 12 and make sure each phase runs before moving to the next.

---

## 1. What we are building

A web application that:

1. Pulls **newly incorporated UK companies** from the official Companies House API for a user-selected date range.
2. For each company, tries to find its **Facebook page** and **Google Business Profile (GMB)** using a search API.
3. If nothing is found, falls back to the company's **director(s)**, finds the **other companies** that director is involved with, and searches for those companies' Facebook/GMB instead.
4. Shows all results in a **live-updating dashboard table** and lets the user **export to CSV**.

The purpose is lead generation: every new company becomes a lead with discovery links attached.

---

## 2. Tech stack (required)

| Area | Choice |
| --- | --- |
| Framework | Next.js 14+ (App Router) with TypeScript (strict mode) |
| UI | Tailwind CSS + shadcn/ui components |
| Database | PostgreSQL via Prisma ORM (works with Neon / Vercel Postgres / Supabase in production, Docker Postgres locally) |
| Fuzzy matching | `fastest-levenshtein` or `string-similarity-js` (or a small hand-written Jaro-Winkler + token-set function) |
| Validation | Zod for all API route inputs and external API responses |
| HTTP | Native `fetch` |
| Hosting | Vercel |
| Tests | Vitest for unit tests |

Do **not** scrape Google, Facebook, or Google Maps HTML directly. All search goes through a search API provider (Section 6). Do **not** scrape the Companies House website; use its API.

---

## 3. Environment variables

Create `.env.example` with:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/leadfinder
COMPANIES_HOUSE_API_KEY=            # free key from https://developer.company-information.service.gov.uk/
SEARCH_PROVIDER=serper              # "serper" (default) or "google_cse"
SERPER_API_KEY=                     # https://serper.dev
GOOGLE_CSE_API_KEY=                 # only if SEARCH_PROVIDER=google_cse
GOOGLE_CSE_ID=                      # only if SEARCH_PROVIDER=google_cse
MATCH_THRESHOLD=0.85                # 0..1 similarity required to accept a result
BATCH_SIZE=10                       # companies processed per batch request
MAX_OWNER_COMPANIES=10              # max other companies checked per director in fallback
APP_PASSWORD=                       # optional: simple password protection for the dashboard
```

The app must start and show a clear error on the dashboard if a required key is missing, rather than crashing.

---

## 4. Companies House API integration

Base URL: `https://api.company-information.service.gov.uk`

**Authentication:** HTTP Basic auth. Username = API key, password = empty string.
`Authorization: Basic base64("<API_KEY>:")`

**Rate limit:** 600 requests per 5 minutes per key. Implement a shared rate limiter (token bucket) and, on HTTP 429, wait and retry with exponential backoff (max 5 retries). Keep usage safely under the limit (target ≤ 500 per 5 minutes).

### 4.1 Fetch new companies

```
GET /advanced-search/companies
  ?incorporated_from=YYYY-MM-DD
  &incorporated_to=YYYY-MM-DD
  &company_status=active          (configurable, default active)
  &size=5000
  &start_index=0
```

- Paginate using `start_index` until all results are fetched. `size` max is 5000.
- Optional filters exposed in the UI: `company_type` (default: `ltd`), `sic_codes` (comma-separated, optional), `location` (optional).
- Store for each company: `company_number`, `company_name`, `date_of_creation`, `company_type`, `company_status`, `registered_office_address` (as JSON), `sic_codes`.
- Deduplicate on `company_number`.

### 4.2 Fetch officers (used only in fallback)

```
GET /company/{company_number}/officers?items_per_page=100
```

- Consider only officers with **no `resigned_on`** and role `director` (fall back to any active officer if no director exists).
- Choose the **primary officer** = earliest `appointed_on`. If tied, first in the list. Also store all active director names for display.
- **Important:** each officer item has `links.officer.appointments` (e.g. `/officers/{officer_id}/appointments`). Use this **officer ID link**, NOT a name search. This avoids the "common name" ambiguity problem.

### 4.3 Fetch the officer's other companies

```
GET /officers/{officer_id}/appointments?items_per_page=50
```

- From `items[]`, take `appointed_to.company_number` and `appointed_to.company_name`.
- Exclude the original company.
- Prefer companies with status `active`, then sort by oldest appointment first (older businesses are more likely to have an online presence).
- Limit to `MAX_OWNER_COMPANIES`.

---

## 5. Name normalisation and matching

Create `lib/matching.ts` with pure, unit-tested functions.

### 5.1 `normaliseCompanyName(name)`
1. Lowercase, trim, collapse whitespace.
2. Replace `&` with `and`.
3. Remove punctuation (`. , ' " ( ) - _ / !`).
4. Remove legal suffixes at the end: `limited`, `ltd`, `plc`, `llp`, `lp`, `cic`, `company`, `co`, `uk ltd`, `(uk)`, `group`, `holdings`.
5. Remove standalone generic words only for matching purposes: `the`, `uk`, `services` should be **kept** by default (they can be meaningful) — make the stopword list configurable in one constant.

### 5.2 `similarity(a, b)` → number 0..1
Use the **maximum** of:
- Jaro-Winkler (or normalised Levenshtein) on the normalised strings.
- Token-set ratio: overlap of word sets / size of the larger set.

### 5.3 Candidate extraction
For each search result, compare the normalised company name against a **cleaned title**:
- Facebook titles: strip `| Facebook`, `- Facebook`, `Facebook`, `- Home`, `| Home`, trailing location text after ` - ` if present.
- GMB/Places: use the place `title` directly.

Accept a result only if `similarity >= MATCH_THRESHOLD`. Store the score with the result. If multiple candidates pass, take the highest score.

### 5.4 Facebook URL rules
Accept only URLs whose host is `facebook.com`, `www.facebook.com`, `m.facebook.com`, or `en-gb.facebook.com` AND that look like a page. **Reject** paths containing: `/groups/`, `/posts/`, `/events/`, `/photos/`, `/videos/`, `/people/` (optional: allow via setting), `/login`, `/sharer`, `/marketplace/`, `/watch/`, `/story.php`, `/permalink.php`. Normalise the stored URL to `https://www.facebook.com/<path>` without query strings.

### 5.5 Location bonus (optional, nice to have)
If the result snippet or place address contains the company's registered-office town or postcode prefix (e.g. "M1", "B15"), add +0.05 to the score (cap at 1.0). This helps pick the correct business among same-named ones.

---

## 6. Search provider layer

Create an interface so providers are swappable:

```ts
interface SearchProvider {
  searchFacebook(companyName: string): Promise<SearchResult[]>;
  searchBusinessProfile(companyName: string): Promise<PlaceResult[]>;
}
```

### 6.1 Serper provider (default)
- Facebook: `POST https://google.serper.dev/search` with header `X-API-KEY`, body `{ "q": "site:facebook.com \"<Company Name>\"", "gl": "uk", "num": 10 }`. Use `organic[]` results (title, link, snippet).
- GMB: `POST https://google.serper.dev/places` with body `{ "q": "<Company Name>", "gl": "uk" }`. Use `places[]` (title, address, cid, website, phoneNumber, rating if present). Build the Google Maps URL as `https://www.google.com/maps?cid=<cid>` when `cid` is present.
- If `places` returns nothing, do one fallback organic search `"<Company Name>" UK` and accept a `google.com/maps` link or knowledge-graph entry if present.
- Search query uses the company name **without** the legal suffix (e.g. "Acme Plumbing" not "ACME PLUMBING LTD"), but in quotes.

### 6.2 Google Custom Search provider (optional)
Implement using the Custom Search JSON API for the Facebook search only; for GMB, return an empty list and log that GMB needs Serper. Keep it behind `SEARCH_PROVIDER=google_cse`.

### 6.3 Reliability
- Timeout each request at 15 seconds.
- Retry on 429/5xx with exponential backoff (max 3 retries).
- Cache search responses in the DB table `SearchCache` keyed by `(provider, type, query)` for 30 days, so re-runs do not burn credits.
- Count and display search credits used per job.

---

## 7. Processing logic (per company)

```
processCompany(company):
  1. Direct search
     fb  = best matching Facebook result for company.name
     gmb = best matching GMB result for company.name
     if fb or gmb:
        save status=found, match_source="business"
        return

  2. Owner fallback
     officers = getActiveOfficers(company.number)
     if none: save status=no_match, note="no active officers"; return
     primary = earliest appointed active director
     others = getOtherCompanies(primary.officer_id) excluding this company, max MAX_OWNER_COMPANIES
     if none: save status=no_match, note="owner has no other companies"; return

     for other in others (in priority order):
        fb  = best Facebook match for other.name
        gmb = best GMB match for other.name
        if fb or gmb:
           save status=found, match_source="owner_other_business",
                matched_via_company_name=other.name,
                matched_via_company_number=other.number,
                officer_name=primary.name
           return        # stop at the first other company that matches

     save status=no_match, officer_name=primary.name, note="no match on owner's companies"
     return

  On any unhandled error: save status=error, error_message=<message>; continue to next company.
```

Rules:
- Fallback is **one level deep only**. Never look up the officers of the owner's other companies.
- Never retry a company endlessly. A company is processed once per job (unless the user clicks "Retry errors").

---

## 8. Database schema (Prisma)

```prisma
model Job {
  id               String    @id @default(cuid())
  createdAt        DateTime  @default(now())
  incorporatedFrom DateTime
  incorporatedTo   DateTime
  filters          Json      // company_type, company_status, sic_codes, location
  status           JobStatus @default(FETCHING)
  totalCompanies   Int       @default(0)
  processedCount   Int       @default(0)
  foundCount       Int       @default(0)
  noMatchCount     Int       @default(0)
  errorCount       Int       @default(0)
  searchCreditsUsed Int      @default(0)
  errorMessage     String?
  results          CompanyResult[]
}

enum JobStatus { FETCHING READY RUNNING PAUSED COMPLETED FAILED }

model CompanyResult {
  id                      String   @id @default(cuid())
  jobId                   String
  job                     Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  companyNumber           String
  companyName             String
  incorporationDate       DateTime
  companyType             String?
  registeredAddress       Json?
  sicCodes                String[]
  status                  ResultStatus @default(PENDING)
  facebookUrl             String?
  facebookScore           Float?
  googleBusinessUrl       String?
  googleBusinessName      String?
  googleBusinessAddress   String?
  googleBusinessPhone     String?
  googleBusinessWebsite   String?
  googleBusinessScore     Float?
  matchSource             MatchSource?
  matchedViaCompanyName   String?
  matchedViaCompanyNumber String?
  officerName             String?
  officerId               String?
  note                    String?
  errorMessage            String?
  processedAt             DateTime?

  @@unique([jobId, companyNumber])
  @@index([jobId, status])
}

enum ResultStatus { PENDING PROCESSING FOUND NO_MATCH ERROR }
enum MatchSource  { BUSINESS OWNER_OTHER_BUSINESS }

model SearchCache {
  id        String   @id @default(cuid())
  provider  String
  type      String   // "facebook" | "places" | "organic"
  query     String
  response  Json
  createdAt DateTime @default(now())
  @@unique([provider, type, query])
}
```

---

## 9. Batch processing (must fit Vercel limits)

Vercel serverless functions have short execution limits, so there is **no single long-running job**.

- `POST /api/jobs` → creates a Job, fetches all companies from Companies House (paginated), inserts `CompanyResult` rows with status `PENDING`, sets job status `READY`. If the fetch is large, do it in pages across multiple calls (`POST /api/jobs/{id}/fetch` with `start_index`) so no single request exceeds ~50 seconds.
- `POST /api/jobs/{id}/process` → atomically claims up to `BATCH_SIZE` `PENDING` rows (set to `PROCESSING` using a transaction / `UPDATE ... WHERE status='PENDING' ... LIMIT` pattern so two calls never process the same row), processes them, updates counters, returns `{ processed, remaining }`. Export `maxDuration = 60`.
- The **dashboard drives the loop**: while the job is `RUNNING` and `remaining > 0`, the browser calls `/process` again. This also means closing the tab pauses the job, and reopening resumes it.
- On start, reset any rows stuck in `PROCESSING` for more than 5 minutes back to `PENDING`.
- `POST /api/jobs/{id}/pause`, `POST /api/jobs/{id}/resume`, `POST /api/jobs/{id}/retry-errors`.
- `GET /api/jobs/{id}` → job summary + counters.
- `GET /api/jobs/{id}/results?status=&search=&page=&pageSize=` → paginated results.
- `GET /api/jobs/{id}/export.csv` → CSV download of all results.
- `GET /api/jobs` → list of past jobs.

All inputs validated with Zod. All routes return JSON errors `{ error: string }` with proper status codes.

---

## 10. Dashboard UI

Single-page dashboard at `/` with these parts:

**A. New Run panel**
- Date inputs: "Incorporated from" and "Incorporated to" (default: first day of current month → today). Validate from ≤ to and to ≤ today.
- Optional filters: company type (dropdown, default `ltd`), status (default `active`), SIC codes (text), location (text).
- "Fetch companies" button → shows how many companies were found, then a "Start processing" button.
- A warning if the count is large (e.g. > 2,000) showing the estimated search credits (≈ 2 per company direct, up to 2 × MAX_OWNER_COMPANIES more for fallback).

**B. Progress panel** (visible when a job is selected)
- Progress bar: processed / total.
- Counters: Found, No match, Errors, Search credits used.
- Buttons: Pause / Resume, Retry errors, Export CSV.
- Poll `GET /api/jobs/{id}` every 3 seconds while running.

**C. Results table**
Columns: Company name (link to `https://find-and-update.company-information.service.gov.uk/company/<number>`), Company number, Incorporation date, Status (coloured badge), Facebook (icon link), Google Business (icon link), Match source ("Direct" / "Via owner"), Matched via company, Officer name, Score.
- Filter tabs: All / Found / Via owner / No match / Errors.
- Text search on company name.
- Pagination (50 per page).
- Row click → side drawer with full details (address, SIC codes, GMB phone/website, notes, error message).

**D. Job history**
- List of past jobs with date range, created time, counts; click to open.

**Other UI requirements**
- Responsive (works on mobile).
- Light/dark mode.
- Empty states and loading skeletons.
- Friendly error messages (e.g. "Companies House API key is missing or invalid").
- If `APP_PASSWORD` is set, protect all pages and API routes with a simple password login (cookie session via middleware).

---

## 11. CSV export format

Header row, in this order:

```
company_name,company_number,incorporation_date,status,facebook_url,google_business_url,google_business_name,google_business_address,google_business_phone,google_business_website,match_source,matched_via_company,matched_via_company_number,officer_name,facebook_score,google_business_score,note
```

- `match_source` values: `business` or `owner_other_business`.
- Dates in `YYYY-MM-DD`.
- Proper CSV escaping (quotes, commas, newlines). UTF-8 with BOM so Excel opens it correctly.

---

## 12. Build phases

1. **Scaffold:** Next.js + TypeScript + Tailwind + shadcn/ui + Prisma. `.env.example`, `docker-compose.yml` for local Postgres, README with setup steps.
2. **Companies House client:** `lib/companiesHouse.ts` with rate limiter, retries, Zod-validated responses; functions `searchNewCompanies`, `getOfficers`, `getOfficerAppointments`. Include a script `npm run test:ch` that fetches 5 companies for yesterday and prints them.
3. **Matching library:** `lib/matching.ts` + Vitest tests (Section 14).
4. **Search provider layer:** `lib/search/` with Serper provider, CSE provider, caching. Script `npm run test:search -- "Company Name"` that prints the chosen Facebook/GMB result and scores.
5. **Processing engine:** `lib/processCompany.ts` implementing Section 7, fully testable with mocked clients.
6. **API routes:** Section 9.
7. **Dashboard UI:** Section 10.
8. **CSV export, password protection, polish, README.**

---

## 13. Acceptance criteria

The build is complete when all of these are true:

- [ ] `npm install && npx prisma migrate dev && npm run dev` runs locally with only `.env` filled in.
- [ ] Selecting a date range and clicking "Fetch companies" loads the correct companies from Companies House, with pagination beyond 5,000 handled.
- [ ] Processing finds Facebook/GMB links for companies that have them and rejects clearly wrong results (e.g. a different business that ranks first).
- [ ] Companies with no direct match go through the owner fallback using the **officer ID appointments link**, and results found this way show "Via owner" plus the other company name.
- [ ] Fallback never goes more than one level deep.
- [ ] Companies where nothing is found are marked "No match" with a note explaining why.
- [ ] One failing company never stops the job; it is marked "Error".
- [ ] The job can be paused, resumed, and continues correctly after closing and reopening the browser.
- [ ] Re-running the same date range uses the search cache and uses (near) zero new search credits.
- [ ] Companies House rate limits are respected (no sustained 429 errors).
- [ ] CSV export opens correctly in Excel and contains every result.
- [ ] Deploys to Vercel with a hosted Postgres database; README explains how.
- [ ] `npm run test` passes.

---

## 14. Required unit tests (Vitest)

- `normaliseCompanyName`:
  - `"ACME PLUMBING LTD"` → `"acme plumbing"`
  - `"Smith & Sons Limited"` → `"smith and sons"`
  - `"J.K. Builders (UK) Ltd."` → `"jk builders"`
- `similarity`:
  - `"Acme Plumbing"` vs `"Acme Plumbing | Facebook"` (after title cleaning) ≥ 0.95
  - `"Acme Plumbing"` vs `"Apex Roofing"` < 0.6
  - `"Smith and Sons"` vs `"Smith & Sons Builders"` passes token-set check reasonably (≥ 0.7)
- Facebook URL filter: accepts `facebook.com/acmeplumbing`, rejects `/groups/…`, `/posts/…`, `/login`, `/sharer.php`.
- `processCompany` with mocked clients:
  - direct match → `FOUND`, `BUSINESS`
  - no direct match, owner's 2nd other company matches → `FOUND`, `OWNER_OTHER_BUSINESS`, correct `matchedVia` fields, stops after first match
  - no officers → `NO_MATCH` with note
  - owner has no other companies → `NO_MATCH` with note
  - search provider throws → `ERROR`, job continues

---

## 15. Project structure (suggested)

```
/app
  /page.tsx                      dashboard
  /login/page.tsx                (if APP_PASSWORD)
  /api/jobs/route.ts             POST create, GET list
  /api/jobs/[id]/route.ts        GET summary
  /api/jobs/[id]/fetch/route.ts
  /api/jobs/[id]/process/route.ts
  /api/jobs/[id]/pause/route.ts
  /api/jobs/[id]/resume/route.ts
  /api/jobs/[id]/retry-errors/route.ts
  /api/jobs/[id]/results/route.ts
  /api/jobs/[id]/export.csv/route.ts
/components                      UI components
/lib
  companiesHouse.ts
  rateLimiter.ts
  matching.ts
  processCompany.ts
  csv.ts
  /search
    types.ts
    serper.ts
    googleCse.ts
    cache.ts
    index.ts                     provider factory
/prisma/schema.prisma
/scripts                         test:ch, test:search
/tests                           vitest tests
middleware.ts                    password protection
docker-compose.yml
.env.example
README.md
```

---

## 16. Known limitations to document in the README

- Very new companies often have no Facebook page or GMB yet, so a high "No match" rate is normal; the owner fallback is what finds most leads.
- Search results depend on the search provider; accuracy depends on `MATCH_THRESHOLD` (raise it for fewer false positives, lower it for more matches).
- GMB data comes from the search provider's Places results; it is not the official Google Places API. Switching to the official Places API is a possible future upgrade.
- Companies House data is public, but any outreach to leads must follow UK GDPR and PECR rules (e.g. B2B marketing rules, opt-out handling). The tool only collects public business links; it does not send messages.

---

## 17. Code quality rules

- TypeScript strict, no `any` except at validated boundaries.
- Every external API call goes through one client module with timeout, retry, and logging.
- No secrets in client-side code; all API keys used server-side only.
- Small, pure, testable functions for matching and processing.
- Clear comments on the non-obvious parts (rate limiter, row claiming, fallback logic).
- README includes: setup, getting API keys, running locally, running tests, deploying to Vercel, and cost estimates for search credits.
