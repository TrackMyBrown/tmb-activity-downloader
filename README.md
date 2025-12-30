## TrackMyBets – Sportsbet Exporter Extension

This manifest-v3 browser extension runs entirely on your machine. It paginates through the Sportsbet transaction API using your logged-in session, builds a CSV with the exact headers TrackMyBets expects, and triggers a download.

### Install (Chrome/Edge/Brave)

1. `chrome://extensions` → enable **Developer mode**.
2. Click **Load unpacked** and select the `trackmybets-extension/` folder from this repo.
3. Pin the “TrackMyBets Exporter” icon so it’s easy to find.

### Usage

1. Log into [sportsbet.com.au](https://www.sportsbet.com.au) and open **Account → Transactions** (this page must stay active when you run the exporter).
2. Click the TrackMyBets extension icon, pick the exact `from`/`to` dates you want exported using the date pickers (limit 24 months per export), then hit **Download CSV**. The extension doesn’t inspect the Sportsbet page for dates—it only uses the values you choose.
3. The extension gathers every page (50 rows per request), creates a file called `sportsbet-transactions-<from>-to-<to>.csv`, and saves it locally. Large ranges can take a few minutes because of Sportsbet’s API limits.
4. Upload that CSV via Step 1 inside the TrackMyBets dashboard to ingest it.

### Privacy

- The extension only talks to `sportsbet.com.au` and your local browser. No data is sent to TrackMyBets or any third-party.
- The source is bundled here—feel free to inspect or modify it before loading.
- Remove the extension at any time once you have your CSV.
