from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import pandas as pd
import math
import re
from collections import defaultdict
from datetime import datetime

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
OPPORTUNITIES_PER_UNIT = 3
REQUIRED_COLUMNS = 9

COL_PSN = 0
COL_COMPANY = 1
COL_CITY = 3
COL_STATE = 4
COL_COUNTRY = 5
COL_CONTACTS = 8

US_COUNTRIES = {"UNITED STATES", "USA", "US"}

BASELINE = {
    "total": 1630,
    "defective_units": 564,
    "total_defects": 1692,
    "defect_rate": 34.60,
    "dpmo": 346012,
    "sigma": 1.90,
}

app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")

latest_state_map = {}
latest_state_details = {}
latest_companies = []
latest_company_counts = []
latest_defect_types = {}
latest_summary = None
analysis_history = []


# ✅ CLEAN COMPANY NAME (SMART GROUPING)
def normalize_company(name):

    name = str(name).lower()

    # ✅ remove punctuation
    name = re.sub(r'[^a-z0-9\s]', '', name)

    words = name.split()

    # ✅ remove noise words
    ignore_words = {
        "the", "and", "of", "for",
        "llc", "inc", "ltd", "lp", "co", "corp", "corporation",
        "company", "group", "systems", "solutions", "technology", "technologies"
    }

    words = [w for w in words if w not in ignore_words]

    if not words:
        return "Unknown"

    # ✅ take first 2-3 meaningful words
    key = words[:3]

    return " ".join(key).title()


# ✅ VALIDATION FUNCTIONS (UNCHANGED)
def check_name(val):
    if not val:
        return 0
    val = str(val).strip().lower()
    return 0 if val in ["", "na", "n/a", "none"] else 1

def check_phone(val):
    if not val:
        return 0
    digits = re.sub(r'\D', '', str(val))
    return 1 if len(digits) >= 7 else 0

def check_email(val):
    if not val:
        return 0
    return 1 if re.search(r'[\w\.-]+@[\w\.-]+\.\w+', str(val)) else 0


def parse_section(section):
    section = re.sub(r'^(Primary|Secondary|Site Contact|Oracle)\s*-\s*', '', section, flags=re.I)
    parts = section.split(",", 2)

    name = parts[0] if len(parts) > 0 else ""
    phone = parts[1] if len(parts) > 1 else ""
    email = parts[2] if len(parts) > 2 else ""

    return 1 if (check_name(name) and check_phone(phone) and check_email(email)) else 0


def section_reasons(section):
    section = re.sub(r'^(Primary|Secondary|Site Contact|Oracle)\s*-\s*', '', section, flags=re.I)
    parts = section.split(",", 2)

    name = parts[0] if len(parts) > 0 else ""
    phone = parts[1] if len(parts) > 1 else ""
    email = parts[2] if len(parts) > 2 else ""

    reasons = []
    if not check_name(name):
        reasons.append("Missing name")
    if not check_phone(phone):
        reasons.append("Missing or invalid phone")
    if not check_email(email):
        reasons.append("Missing or invalid email")

    return reasons


def extract_sections(text):
    parts = re.split(r'(Primary\s*-\s*|Secondary\s*-\s*|Site Contact\s*-\s*|Oracle\s*-\s*)', text)

    sections = []
    current = ""

    for part in parts:
        if re.match(r'(Primary|Secondary|Site Contact|Oracle)\s*-\s*', part, re.I):
            if current:
                sections.append(current.strip())
            current = part
        else:
            current += part

    if current:
        sections.append(current.strip())

    return sections


def clean_state(value):
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "n/a", "na"}:
        return "Unknown"
    return text


def clean_text(value, fallback="Unknown"):
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "n/a", "na"}:
        return fallback
    return text


def evaluate_contacts(blob):
    if pd.isna(blob) or str(blob).strip() == "":
        return True, ["Missing contact details"]

    sections = extract_sections(str(blob))

    if not sections:
        return True, ["Contact section not found"]

    scores = [parse_section(sec) for sec in sections]
    if any(scores):
        return False, []

    reasons = []
    for section in sections:
        reasons.extend(section_reasons(section))

    if not reasons:
        reasons.append("Invalid contact format")

    return True, sorted(set(reasons))


def erfinv(y):
    a = 0.147
    sign = 1 if y >= 0 else -1
    ln = math.log(1 - y*y)
    term = (2/(math.pi*a) + ln/2)
    inside = term*term - ln/a
    return sign * math.sqrt(math.sqrt(inside) - term)


# ✅ MAIN ENDPOINT
@app.post("/upload")
async def upload(file: UploadFile = File(...)):

    global latest_state_map, latest_state_details, latest_companies
    global latest_company_counts, latest_defect_types, latest_summary, analysis_history

    try:
        df = pd.read_excel(file.file, header=None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read the uploaded Excel file.") from exc

    if df.shape[1] < REQUIRED_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail=f"Expected at least {REQUIRED_COLUMNS} columns, but found {df.shape[1]}.",
        )

    total = 0
    defective_units = 0

    state_map = defaultdict(list)
    state_details = defaultdict(list)
    company_map = defaultdict(int)
    defect_type_map = defaultdict(int)

    for _, row in df.iloc[1:].iterrows():

        country = str(row[COL_COUNTRY]).strip().upper()

        if country not in US_COUNTRIES:
            continue

        total += 1

        psn = row[COL_PSN]
        state = clean_state(row[COL_STATE])

        raw_company = row[COL_COMPANY]
        company = normalize_company(raw_company)
        asc_name = clean_text(raw_company)
        city = clean_text(row[COL_CITY])

        blob = row[COL_CONTACTS]

        is_defect, defect_reasons = evaluate_contacts(blob)

        if is_defect:
            defective_units += 1
            state_map[state].append(psn)
            state_details[state].append({
                "psn": clean_text(psn),
                "asc_name": asc_name,
                "city": city,
                "state": state,
            })
            company_map[company] += 1
            for reason in defect_reasons:
                defect_type_map[reason] += 1

    latest_state_map = dict(state_map)
    latest_state_details = dict(state_details)

    latest_company_counts = sorted(company_map.items(), key=lambda x: x[1], reverse=True)
    latest_companies = latest_company_counts[:10]
    latest_defect_types = dict(sorted(defect_type_map.items(), key=lambda x: x[1], reverse=True))

    if total == 0:
        latest_summary = {
            "total": 0,
            "defective_units": 0,
            "defects": 0,
            "total_defects": 0,
            "defect_rate": 0,
            "dpmo": 0,
            "sigma": None,
            "baseline": BASELINE,
        }
        return latest_summary

    p = defective_units / total
    dpmo = p * 1_000_000
    total_defects = defective_units * OPPORTUNITIES_PER_UNIT
    defect_rate = p * 100

    if 0 < p < 1:
        inv = erfinv(1 - 2*p)
        sigma = math.sqrt(2) * inv + 1.5
    else:
        sigma = None

    now = datetime.now()
    analyzed_at = f"{now.strftime('%B')} {now.day}, {now.year}"
    latest_summary = {
        "total": total,
        "defective_units": defective_units,
        "defects": defective_units,
        "total_defects": total_defects,
        "defect_rate": defect_rate,
        "dpmo": dpmo,
        "sigma": sigma,
        "baseline": BASELINE,
    }

    analysis_history.append({
        "label": analyzed_at,
        "total": total,
        "defective_units": defective_units,
        "total_defects": total_defects,
        "defect_rate": defect_rate,
        "dpmo": dpmo,
        "sigma": sigma,
    })

    analysis_history = analysis_history[-12:]

    return latest_summary


# ✅ DATA ENDPOINTS
@app.get("/defects-data")
def defects_data():
    return latest_state_map


@app.get("/defects-details")
def defects_details():
    return latest_state_details


@app.get("/top-companies")
def get_top_companies():
    return latest_companies


@app.get("/control-data")
def control_data():
    total_company_defects = sum(count for _, count in latest_company_counts) or 1
    cumulative = 0
    pareto = []

    for name, count in latest_company_counts[:10]:
        cumulative += count
        pareto.append({
            "name": name,
            "count": count,
            "cumulative": (cumulative / total_company_defects) * 100,
        })

    latest_rate = (latest_summary or {}).get("defect_rate", 0)
    latest_sigma = (latest_summary or {}).get("sigma")

    if not latest_summary or latest_summary.get("total", 0) == 0:
        status = "Waiting"
        status_color = ""
    elif latest_rate <= 10 and latest_sigma is not None and latest_sigma >= 2.8:
        status = "Controlled"
        status_color = "green"
    elif latest_rate <= 15:
        status = "Watch"
        status_color = "yellow"
    else:
        status = "Action Required"
        status_color = "red"

    return {
        "baseline": BASELINE,
        "latest": latest_summary,
        "history": analysis_history,
        "pareto": pareto,
        "defect_types": [
            {"type": name, "count": count}
            for name, count in latest_defect_types.items()
        ],
        "reaction": {
            "status": status,
            "status_color": status_color,
            "latest_rate": latest_rate,
            "latest_sigma": latest_sigma,
        },
    }


# ✅ ROUTES
@app.get("/")
def home():
    return FileResponse(BASE_DIR / "index.html")

@app.get("/defects")
def defects_page():
    return FileResponse(BASE_DIR / "defects.html")
