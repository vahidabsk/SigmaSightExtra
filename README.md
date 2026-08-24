# SigmaSightExtra

SigmaSightExtra is a FastAPI dashboard for Six Sigma contact-data quality analysis.

This package is offline-ready: Chart.js, the US map, and all dashboard assets are included locally. The desktop executable runs a local server on `127.0.0.1`; it does not need Render or internet access after the one-time package/build is complete.

It can run in two modes.

With the audit tracker filter on, it accepts two Excel files:

- Audit tracker
- Customer contact list

The audit tracker is used first as a filter. SigmaSightExtra only analyzes common PSNs that exist in both files, where `QuInsights POC Updated/Reviewed` is marked `Yes` and the tracker Column AD (`ASC Status`) is not marked `Withdrawn`. Tracker-only, contact-list-only, and withdrawn PSNs are excluded from the calculation and from the displayed discrepancy outputs.

With the audit tracker filter off, it accepts only the customer contact list and analyzes all US contact-list rows.

- Total units
- Defective units
- Total defects
- Percent defective
- DPMO
- Sigma level
- Defective PSNs by state
- Top 10 companies by defective PSNs
- Defective PSNs by assigned auditor
- Common non-withdrawn tracker/contact PSN analysis
- Possible alternate PSN matches for tracker rows missing from the contact list


## Email-Ready Portable Windows Package

Use the GitHub Actions artifact for coworkers. Do not send the source folder and do not ask the coworker to run `build_windows.bat`.

The final host-PC package is `SigmaSightExtraPortable.zip`. It contains an embedded Python runtime and all dependencies. The destination computer does not need Python, pip, package installs, Render, or internet access.

Recommended process:

1. Push this repo to GitHub.
2. Open the GitHub repo in your browser.
3. Go to `Actions`.
4. Run `Build portable Windows app`, or open the latest successful run.
5. Download the artifact named `SigmaSightExtraPortable`.
6. Email `SigmaSightExtraPortable.zip` to the coworker.
7. The coworker extracts the zip and double-clicks `Start SigmaSightExtra.cmd`.

The package does not use PyInstaller, so it avoids the unsigned generated EXE that Windows Defender was blocking. It runs using the included official embedded Python runtime.

If startup fails, `SigmaSightExtra-startup.log` is created in the same folder with the exact error.

## Expected Excel Layout

The customer contact list expects these columns:

| Column | Meaning |
| --- | --- |
| A | PSN |
| B | Company |
| E | State |
| F | Country |
| I | Contact details |

The audit tracker must include:

| Column | Meaning |
| --- | --- |
| PSN | PSN to match against the contact list |
| QuInsights POC Updated/Reviewed | Only rows marked `Yes` are analyzed |
| Withdrawn status/text | Rows with `Withdrawn` in Column AD (`ASC Status`) are excluded before analysis, discrepancies, possible matches, and exports |
| Calculation population | Only PSNs common to the non-withdrawn tracker Yes population and the current contact list are calculated or displayed |

The contact-details field is checked for sections such as:

```text
Primary - Name, Phone, Email
Secondary - Name, Phone, Email
Site Contact - Name, Phone, Email
Oracle - Name, Phone, Email
```

A PSN is counted as defective when the contact field is empty or when no contact section has a valid name, phone, and email.

## Run Locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

## Build Windows Desktop App

To create a Windows executable, use a Windows laptop.

1. Install Python for Windows.
2. Open this project folder.
3. Double-click `build_windows.bat`.
4. Wait for the build to finish.
5. Open:

```text
dist\SigmaSightExtra\SigmaSightExtra.exe
```

The executable opens SigmaSightExtra in its own desktop window. It does not use Render and does not need an internet browser tab.

After analysis, the dashboard shows Control Phase tabs for Capability, Pareto, Defect Types, Heatmap, Top 10, Table, Auditor Defects, Discrepancies, and Possible Matches.

The Discrepancies and Possible Matches tabs use the Customer Contact List as the current reference. Displayed lists exclude Canada records, show readable record cards, and include CSV/XLSX download buttons for each list. The Possible Matches tab compares company name, city, state, address, and file-like identifiers to suggest contact-list records that may be the same company with a different assigned PSN. It also flags groups that share the same file/location but have different company names and party site numbers.

Each KPI, chart, and result table includes a Formula button that explains the statistical calculation used by SigmaSightExtra.

## Improvements From Original

- Safer Excel upload handling
- Clearer backend metric names
- Shared baseline values returned by the API
- Safer sigma display when sigma cannot be calculated
- Better dashboard status and error messages
- Defects map handles empty data without breaking
- Static files resolve from the project folder instead of the launch folder
