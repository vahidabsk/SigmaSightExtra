# SigmaSightExtra

SigmaSightExtra is a FastAPI dashboard for Six Sigma contact-data quality analysis.

It accepts two Excel files:

- Audit tracker
- Customer contact list

The audit tracker is used first as a filter. SigmaSightExtra only analyzes PSNs where `QuInsights POC Updated/Reviewed` is marked `Yes`. It then checks those matching US customer-contact rows for usable contact information and reports:

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

After analysis, the dashboard shows Control Phase tabs for Capability, Stability, Pareto, Defect Types, Heatmap, Top 10, Table, Auditor Defects, and Discrepancies.

## Improvements From Original

- Safer Excel upload handling
- Clearer backend metric names
- Shared baseline values returned by the API
- Safer sigma display when sigma cannot be calculated
- Better dashboard status and error messages
- Defects map handles empty data without breaking
- Static files resolve from the project folder instead of the launch folder
