# SigmaSightExtra

SigmaSightExtra is a FastAPI dashboard for Six Sigma contact-data quality analysis.

It can run in two modes.

With the audit tracker filter on, it accepts two Excel files:

- Audit tracker
- Customer contact list

The audit tracker is used first as a filter. SigmaSightExtra only analyzes PSNs where `QuInsights POC Updated/Reviewed` is marked `Yes`. It then checks those matching US customer-contact rows for usable contact information and reports:

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
- PSN discrepancies between the tracker and contact list
- Possible alternate PSN matches for tracker rows missing from the contact list

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
