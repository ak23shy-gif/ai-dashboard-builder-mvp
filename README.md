# Google Extract — personal Google data extraction

Local ETL application: **Connect Google → Select Product → Select Account/Property → Select Data → Extract → Table → CSV/JSON**.

The main app is an extraction workspace, with no Power BI integration. React/Next.js provides the UI; Python/FastAPI calls Google APIs. SQLite stores batches and removes exact duplicate rows without loading whole datasets into memory. CSV/JSON exports stream from disk. Pandas is intentionally unnecessary for this bounded-memory pipeline.

## Production deployment

Vercel should host the Next.js frontend. The Python/FastAPI extractor must run as a persistent backend service with durable storage because it performs OAuth token refresh, Google/API extraction, streaming exports, and per-user job storage. Do not deploy the Python extractor as an ephemeral Vercel serverless function.

Recommended production layout:

| Layer | Host | Purpose |
| --- | --- | --- |
| Frontend | Vercel | Next.js UI and `/extract-api/*` proxy |
| Backend | Render Web Service from the `backend` root directory | FastAPI extractor, OAuth callback, direct query API |
| Storage | Managed Postgres or persistent disk-backed SQLite for a small private deployment | Tokens, sessions, OAuth state, jobs, rows, checkpoints |

Keep only one Vercel frontend project. Use `google-api-data-extractor` and remove/ignore any Vercel project named `backend` or old preview project names.

For Vercel project `google-api-data-extractor`, set:

```text
EXTRACT_API_BASE_URL=https://google-api-data-extractor-backend.onrender.com
```

For the backend, set:

```text
APP_ORIGIN=https://google-api-data-extractor.vercel.app
GOOGLE_REDIRECT_URI=https://google-api-data-extractor.vercel.app/extract-api/auth/callback
BACKEND_ALLOWED_HOSTS=google-api-data-extractor-backend.onrender.com,localhost,127.0.0.1
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...
GOOGLE_ADS_DEVELOPER_TOKEN=...
```

In Google Cloud Console, add the production redirect URI:

```text
https://google-api-data-extractor.vercel.app/extract-api/auth/callback
```

For a real multi-user launch, move the OAuth consent screen from Testing to Production after verification and publish only after configuring HTTPS, durable backend storage, backups, log retention, and secret rotation. The application separates workspaces by Google subject ID; each workspace receives its own direct-query API key.

Git deployment commands:

```powershell
npm run build
git add .
git commit -m "Prepare Google extraction app for production deployment"
git push origin main
```

## Run locally on Windows

Requires Python 3.11+ and Node.js 20+.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

Configure the credentials below, then start the backend in one terminal:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:3001**. Use this hostname consistently; `localhost` has different cookies and OAuth redirect matching. Next.js forwards `/extract-api/*` to FastAPI on port 8000. Run a single backend worker; authentication sessions, OAuth state, and running tasks belong to that process.

After installing dependencies, `powershell -ExecutionPolicy Bypass -File .\start-local.ps1` starts both services together. Keep the terminal open while using the app.

## One-time Google OAuth setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the APIs needed for your selected products (table below).
3. Configure Google Auth Platform / OAuth consent. For a personal external app in Testing, add your own Google email as a test user. Google may expire testing refresh tokens after seven days; reconnect when required. A Workspace Internal app is another option if your organization allows it.
4. Create an OAuth client of type **Web application**. Add this exact authorized redirect URI:

   `http://127.0.0.1:3001/extract-api/auth/callback`

5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.
6. Generate an encryption key and paste it into `TOKEN_ENCRYPTION_KEY` in that same file:

   ```powershell
   .\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

7. Restart the backend, select a product, and click **Connect Google**. On first use of another product, click **Authorize [product]** if prompted. This grants API scopes for that product, not permissions on individual properties.

Keep `backend/.env` private and preserve the encryption key. Never paste secrets into the frontend. Existing `.env.local` AI settings are not used by this extraction app.

### Discovery and connector coverage

| Connector | Enable these Google APIs | What is discovered / extracted |
| --- | --- | --- |
| GA4 | Google Analytics Admin API; Google Analytics Data API | All accessible account summaries and properties; reporting dimensions and metrics, including property-specific metadata |
| Google Ads | Google Ads API | Accessible customers and clients under manager accounts; campaign performance with selected fields |
| Search Console | Google Search Console API | Accessible verified sites; search performance by date/query/page/country/device and search type |
| YouTube Analytics | YouTube Data API v3; YouTube Analytics API | Channels available to the selected OAuth identity; channel analytics reports |
| Business Profile | My Business Account Management API; My Business Business Information API | Accessible business accounts; location inventory with addresses, contact details, and URLs |
| Google Sheets | Google Drive API; Google Sheets API | Accessible spreadsheet files and tabs; worksheet rows |
| Google Drive | Google Drive API | Accessible file metadata; names, IDs, MIME types, sizes, modified times, links |

GA4 uses [accountSummaries.list](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list), which discovers accounts/properties accessible to the caller. You do **not** add this app to each property or grant a service account access. Google OAuth cannot give access the signed-in user does not already possess.

Google Ads additionally requires `GOOGLE_ADS_DEVELOPER_TOKEN`; its access level must permit the accounts being queried. See [Google Ads authorization](https://developers.google.com/google-ads/api/rest/auth). The REST version is configurable with `GOOGLE_ADS_API_VERSION` (default `v25`); update it when Google sunsets that version. `metrics.cost_micros` remains in micros and is named `metrics_cost_micros` in exports; divide by 1,000,000 to obtain account-currency units.

Business Profile requires [Google API access approval](https://developers.google.com/my-business/content/prereqs). Google requires `business.manage` even for these read operations; the connector does not modify locations. Performance/reviews are outside this connector's current inventory scope.

YouTube Brand Account/channel selection can require reconnecting with the relevant identity. Content-owner reporting and the bulk YouTube Reporting API are outside this implementation. Google validates [report dimension/metric compatibility](https://developers.google.com/youtube/analytics/reference/reports/query); incompatible selections return the API error without fabricating a result.

## Extraction and output behavior

### Multiple Google logins and properties

Click **Add Google account** to connect additional Google logins without replacing the existing ones. Resources appear grouped by email. Authorize each login for the Google product you want to use, then check one or more properties (up to 100), or use **Select all visible** after searching. The same property cannot be selected twice through different logins. Select common dimensions/metrics and click **Extract N sources**.

The combined CSV/JSON includes `source_google_account`, `source_resource_id`, and `source_resource_name`. Each source runs separately and has its own progress, row count, error, and incremental checkpoint. Identical data rows from different properties remain separate. GA4 field choices are restricted to fields shared by all selected properties. For Sheets, choose a tab for each spreadsheet; differing columns are combined with nulls for missing values. Source headers that collide with provenance columns receive a numeric suffix.

If a source fails, its incomplete rows are removed from the combined result and its checkpoint stays unchanged. Successful sources remain available via exports explicitly labelled **successful sources**. Incremental retries skip sources already up to date and retry the remaining dates for the others. A single run still uses one Google product; it can span many logins and resources.

Your first Google login owns the local workspace. Add other logins from inside that workspace. After a backend restart, reconnect the **primary workspace login** to reopen its saved connections and history. A fresh sign-in using a different primary login opens that login's separate workspace. Tokens from the original single-account app migrate automatically when that same Google identity reconnects.

- API-specific pagination: tokens, offsets, row windows, or start indices. GA4 uses 10,000-row pages, Sheets uses 2,000-row windows, and the preview uses 50 rows per page.
- Six attempts for transient network errors, rate limits, and eligible server failures, using exponential backoff/jitter and bounded `Retry-After`. Invalid requests and authorization errors are surfaced promptly. Quota exhaustion can still require retrying later.
- Server-side jobs persist status and rows in `backend/data/extract.db`. One extraction runs at a time to keep this personal app and API quotas manageable. Restarted/interrupted jobs become failed and can be rerun; partial results are never exportable as a completed dataset.
- Exact duplicate rows are removed across batches using a SQLite uniqueness constraint. Dimensions/IDs stay strings; Google numeric metric types become JSON numbers. Empty Sheet cells become null; sheet numeric/boolean values retain their source types. Sheets row 1 must contain headers. Duplicate/blank headers receive deterministic unique names.
- Column names use snake_case. GA4 dates become ISO `YYYY-MM-DD`. Other API date strings are retained. CSV uses UTF-8 with BOM, CRLF, standard quoting, and empty fields for null; JSON retains null and boolean values. CSV naturally does not carry a type schema. Source text is retained verbatim, including spreadsheet-like formulas; import it as data.
- Exports contain **all** rows in the completed run, not just the visible preview. They are suitable for manual import into your preferred analysis tool.
- Empty analytics reports still export the requested headers. Empty inventory exports can have no columns when the source returns no records.
- No sample data is presented as live Google data.

### Incremental extraction

Available for GA4, Ads, Search Console, and YouTube when the appropriate date dimension is selected (`date`, `segments.date`, or `day`). Enable it for the baseline and subsequent runs. A successful incremental run stores an end-date checkpoint keyed by Google user, connector, resource, selected fields, and product options. A later run starts at the later of the selected start date and the day after that checkpoint. Failures never advance the checkpoint.

Each run exports its own new date slice; it does not merge prior files. Incremental extraction does not revisit late conversions, corrected historical data, or incomplete recent days. Use an ordinary extraction to refresh an overlapping historical range. Changing fields or options creates a separate checkpoint. Sheets, Drive, and Business Profile use full snapshots. Deleting a run removes its rows but retains its incremental checkpoint; turn off incremental mode to re-extract historical dates.

Google can withhold, threshold, or limit data. In particular, [Search Console returns top rows rather than guaranteeing every row](https://developers.google.com/webmaster-tools/v1/searchanalytics/query). Pagination cannot bypass these limits. GA4 reports may have thresholding or sampling, and recent YouTube/GA4 dates may still be incomplete. Choose settled date ranges when establishing incremental checkpoints.

## Security and local storage

OAuth uses a browser-bound, expiring, single-use state and PKCE. Access/refresh tokens are encrypted using Fernet before being saved. Browser cookies are HttpOnly and SameSite=Lax. Mutation requests require the configured app origin; backend Host headers are restricted by `BACKEND_ALLOWED_HOSTS`. Tokens and client secrets never go to browser JavaScript. Browser sessions and OAuth state are persisted in the backend database so ordinary backend restarts do not drop signed-in users.

Disconnect beside a Google login removes only that login's stored token. Other connected logins and extraction history remain available. Wait for active jobs to finish before disconnecting. This does not revoke consent in your Google account; revoke app access in Google Account settings if desired. Extracted rows remain in backend storage until deleted from history. Rows are not encrypted by this app; use encrypted disks or managed database encryption for production data.

## Development and checks

```powershell
.\.venv\Scripts\python.exe -m pytest backend -q
npm run typecheck
npm run build
```

Tests use simulated Google responses and isolated temporary databases. A real OAuth round trip and live API extraction require your Google Cloud credentials and source access.

Add a new connector by implementing `discover()`, optional `fields(resource)`, and the async batch generator `extract(query)` in `backend/connectors.py`, then registering its scopes and fields in `CATALOG` and its implementation in `CONNECTORS`.
