from pathlib import Path
import sys

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
import pandas as pd
import math
import re
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from typing import Optional

app = FastAPI()

BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
OPPORTUNITIES_PER_UNIT = 3
REQUIRED_COLUMNS = 9

COL_PSN = 0
COL_COMPANY = 1
COL_CITY = 3
COL_STATE = 4
COL_COUNTRY = 5
COL_CONTACTS = 8

US_COUNTRIES = {
    "UNITED STATES",
    "UNITED STATES OF AMERICA",
    "USA",
    "US",
    "U.S.",
    "PUERTO RICO",
    "GUAM",
    "AMERICAN SAMOA",
    "NORTHERN MARIANA ISLANDS",
    "U.S. VIRGIN ISLANDS",
    "US VIRGIN ISLANDS",
    "VIRGIN ISLANDS, U.S.",
    "UNITED STATES MINOR OUTLYING ISLANDS",
}
YES_VALUES = {"YES", "Y"}

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
latest_auditor_defects = []
latest_discrepancies = {
    "tracker_yes_missing_from_contact_list": [],
    "tracker_yes_found_but_not_us_contact": [],
    "contact_us_not_tracker_yes": [],
}
latest_possible_matches = {
    "missing_tracker_psn_possible_contact_matches": [],
    "same_file_location_different_company_psn": [],
}
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


def normalize_header(value):
    return re.sub(r'[^a-z0-9]', '', str(value).strip().lower())


def normalize_psn(value):
    if pd.isna(value):
        return ""

    text = str(value).strip()

    if not text or text.lower() in {"nan", "none", "n/a", "na"}:
        return ""

    if re.fullmatch(r'\d+\.0', text):
        text = text[:-2]

    return text



def normalize_key(value):
    text = clean_text(value, "")
    return re.sub(r'[^a-z0-9]', '', text.lower())


def is_us_reference_country(value):
    return clean_text(value, "").strip().upper() in US_COUNTRIES


def is_visible_reference_record(record):
    if not is_us_reference_country(record.get("country", "")):
        return False

    searchable = " ".join([
        clean_text(record.get("company", ""), ""),
        clean_text(record.get("country", ""), ""),
    ]).lower()
    return "canada" not in searchable


def company_identity_key(value):
    normalized = normalize_company(value)
    return normalize_key(normalized)


def text_similarity(left, right):
    left_key = normalize_key(left)
    right_key = normalize_key(right)

    if not left_key or not right_key:
        return 0

    return SequenceMatcher(None, left_key, right_key).ratio()


def company_similarity(left, right):
    left_key = company_identity_key(left)
    right_key = company_identity_key(right)

    if not left_key or not right_key:
        return 0

    return SequenceMatcher(None, left_key, right_key).ratio()


def find_first_column(df, header_row, candidates):
    normalized_candidates = [normalize_header(item) for item in candidates]

    for col_index in range(len(df.columns)):
        header = normalize_header(df.iat[header_row, col_index])

        if header in normalized_candidates:
            return col_index

        if any(candidate and candidate in header for candidate in normalized_candidates):
            return col_index

    return None

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


def format_date(value):
    parsed = pd.to_datetime(value, errors="coerce")

    if pd.isna(parsed):
        return None

    return f"{parsed.strftime('%B')} {parsed.day}, {parsed.year}"


def extract_report_date(df):
    search_rows = min(12, len(df.index))
    search_cols = min(12, len(df.columns))

    for row_index in range(search_rows):
        for col_index in range(search_cols):
            value = df.iat[row_index, col_index]

            if pd.isna(value):
                continue

            if not isinstance(value, str):
                formatted = format_date(value)
                if formatted:
                    return formatted
                continue

            text = value.strip()
            match = re.search(r'report\s*date\s*:?\s*(.+)', text, flags=re.I)

            if match:
                formatted = format_date(match.group(1).strip())
                if formatted:
                    return formatted

    now = datetime.now()
    return f"{now.strftime('%B')} {now.day}, {now.year}"


def find_tracker_columns(df):
    search_rows = min(25, len(df.index))

    for row_index in range(search_rows):
        psn_col = None
        quinsights_col = None

        for col_index in range(len(df.columns)):
            header = normalize_header(df.iat[row_index, col_index])

            if header == "psn":
                psn_col = col_index

            if "quinsights" in header and ("updated" in header or "reviewed" in header):
                quinsights_col = col_index

        if psn_col is not None and quinsights_col is not None:
            return {
                "header_row": row_index,
                "psn": psn_col,
                "quinsights": quinsights_col,
                "auditor": find_first_column(df, row_index, ["Assigned Auditor", "Auditor"]),
                "company": find_first_column(df, row_index, ["Company/ Service Center Name", "Company Name", "Company"]),
                "city": find_first_column(df, row_index, ["City"]),
                "state": find_first_column(df, row_index, ["State", "State/Province"]),
                "file": find_first_column(df, row_index, ["File", "File Number", "File #"]),
                "address": find_first_column(df, row_index, ["Address", "Street Address"]),
            }

    raise HTTPException(
        status_code=400,
        detail="The audit tracker must include PSN and QuInsights POC Updated/Reviewed columns.",
    )


def extract_quinsights_yes_psns(tracker_df):
    columns = find_tracker_columns(tracker_df)
    header_row = columns["header_row"]
    psn_col = columns["psn"]
    quinsights_col = columns["quinsights"]
    yes_psns = set()
    tracker_psns = set()
    yes_psn_details = {}
    tracker_psn_details = {}

    for _, row in tracker_df.iloc[header_row + 1:].iterrows():
        psn = normalize_psn(row[psn_col])
        if not psn:
            continue

        tracker_psns.add(psn)
        tracker_psn_details[psn] = {
            "psn": psn,
            "auditor": cell_value(row, columns["auditor"], "Unknown"),
            "company": cell_value(row, columns["company"], "Unknown"),
            "city": cell_value(row, columns["city"], "Unknown"),
            "state": cell_value(row, columns["state"], "Unknown"),
            "file": cell_value(row, columns["file"], ""),
            "address": cell_value(row, columns["address"], ""),
        }
        status = clean_text(row[quinsights_col], "").strip().upper()

        if status in YES_VALUES:
            yes_psns.add(psn)
            yes_psn_details[psn] = tracker_psn_details[psn]

    if not yes_psns:
        raise HTTPException(
            status_code=400,
            detail="No PSNs with QuInsights POC Updated/Reviewed = Yes were found in the audit tracker.",
        )

    return yes_psns, yes_psn_details, tracker_psn_details, {
        "tracker_psns": len(tracker_psns),
        "quinsights_yes_psns": len(yes_psns),
    }


def find_contact_columns(df):
    search_rows = min(10, len(df.index))

    for row_index in range(search_rows):
        psn_col = find_first_column(df, row_index, ["PSN", "Party Site Number"])
        company_col = find_first_column(df, row_index, ["Company Name", "Company/ Service Center Name", "Company"])

        if psn_col is not None and company_col is not None:
            return {
                "header_row": row_index,
                "psn": psn_col,
                "company": company_col,
                "address": find_first_column(df, row_index, ["Address", "Street Address"]),
                "city": find_first_column(df, row_index, ["City"]),
                "state": find_first_column(df, row_index, ["State/Province", "State"]),
                "country": find_first_column(df, row_index, ["Country"]),
                "file": find_first_column(df, row_index, ["File", "File Number", "File #", "SCN"]),
            }

    return {
        "header_row": 0,
        "psn": COL_PSN,
        "company": COL_COMPANY,
        "address": 2,
        "city": COL_CITY,
        "state": COL_STATE,
        "country": COL_COUNTRY,
        "file": None,
    }


def cell_value(row, col_index, fallback=""):
    if col_index is None:
        return fallback

    try:
        return clean_text(row[col_index], fallback)
    except Exception:
        return fallback


def build_contact_records(df):
    columns = find_contact_columns(df)
    records = []

    for _, row in df.iloc[columns["header_row"] + 1:].iterrows():
        psn = normalize_psn(row[columns["psn"]])
        if not psn:
            continue

        country = cell_value(row, columns["country"], "Unknown")

        records.append({
            "psn": psn,
            "company": cell_value(row, columns["company"], "Unknown"),
            "address": cell_value(row, columns["address"], ""),
            "city": cell_value(row, columns["city"], "Unknown"),
            "state": cell_value(row, columns["state"], "Unknown"),
            "country": country,
            "file": cell_value(row, columns["file"], ""),
            "is_us_reference": is_us_reference_country(country),
        })

    return records


def record_list(records_by_psn, psns):
    return [records_by_psn[psn] for psn in sorted(psns, key=str) if psn in records_by_psn]


def tracker_record_list(yes_psn_details, psns):
    return [yes_psn_details[psn] for psn in sorted(psns, key=str) if psn in yes_psn_details]


def possible_match_score(tracker_record, contact_record):
    score = 0
    reasons = []
    company_match_ratio = company_similarity(tracker_record.get("company"), contact_record.get("company"))

    same_city = normalize_key(tracker_record.get("city")) and normalize_key(tracker_record.get("city")) == normalize_key(contact_record.get("city"))
    same_state = normalize_key(tracker_record.get("state")) and normalize_key(tracker_record.get("state")) == normalize_key(contact_record.get("state"))
    same_address = normalize_key(tracker_record.get("address")) and normalize_key(tracker_record.get("address")) == normalize_key(contact_record.get("address"))
    same_file = normalize_key(tracker_record.get("file")) and normalize_key(tracker_record.get("file")) == normalize_key(contact_record.get("file"))

    if company_match_ratio >= 0.94:
        score += 45
        reasons.append("same/similar company name")
    elif company_match_ratio >= 0.82:
        score += 30
        reasons.append("possible company-name match")
    elif company_match_ratio >= 0.72:
        score += 18
        reasons.append("weak company-name similarity")

    if same_city:
        score += 18
        reasons.append("same city")

    if same_state:
        score += 15
        reasons.append("same state")

    if same_address:
        score += 35
        reasons.append("same address")

    if same_file:
        score += 35
        reasons.append("same file/SCN")

    if same_file and same_state:
        score += 15
        reasons.append("same file/SCN and state")

    if same_address and company_match_ratio < 0.82:
        reasons.append("possible name change or acquisition")

    if same_file and company_match_ratio < 0.82:
        reasons.append("possible file carried to different PSN/company")

    return score, reasons, company_match_ratio


def build_possible_matches(yes_psn_details, contact_records, missing_psns):
    reference_contacts = [record for record in contact_records if is_visible_reference_record(record)]
    missing_matches = []

    for psn in sorted(missing_psns, key=str):
        tracker_record = yes_psn_details.get(psn)
        if not tracker_record:
            continue

        candidates = []

        for contact_record in reference_contacts:
            if contact_record["psn"] == psn:
                continue

            score, reasons, company_similarity = possible_match_score(tracker_record, contact_record)

            strong_location_or_file = ("same address" in reasons) or ("same file/SCN" in reasons) or ("same city" in reasons and "same state" in reasons)
            strong_company = company_similarity >= 0.82

            if score >= 60 and (strong_location_or_file or strong_company):
                candidates.append({
                    "score": score,
                    "reasons": reasons,
                    "company_similarity": round(company_similarity, 3),
                    "contact_psn": contact_record["psn"],
                    "contact_company": contact_record["company"],
                    "contact_address": contact_record["address"],
                    "contact_city": contact_record["city"],
                    "contact_state": contact_record["state"],
                    "contact_country": contact_record["country"],
                    "contact_file": contact_record["file"],
                })

        candidates = sorted(candidates, key=lambda item: (-item["score"], -item["company_similarity"], item["contact_psn"]))[:8]

        if candidates:
            missing_matches.append({
                "tracker_psn": psn,
                "tracker_company": tracker_record.get("company", "Unknown"),
                "tracker_address": tracker_record.get("address", ""),
                "tracker_city": tracker_record.get("city", "Unknown"),
                "tracker_state": tracker_record.get("state", "Unknown"),
                "tracker_file": tracker_record.get("file", ""),
                "tracker_auditor": tracker_record.get("auditor", "Unknown"),
                "possible_matches": candidates,
            })

    grouped = defaultdict(list)

    for contact_record in reference_contacts:
        file_key = normalize_key(contact_record.get("file"))
        city_key = normalize_key(contact_record.get("city"))
        state_key = normalize_key(contact_record.get("state"))
        address_key = normalize_key(contact_record.get("address"))

        if not state_key or not (file_key or address_key):
            continue

        grouped[(file_key, address_key, city_key, state_key)].append(contact_record)

    file_location_conflicts = []

    for records in grouped.values():
        companies = {normalize_key(record.get("company")) for record in records if normalize_key(record.get("company"))}
        psns = {record.get("psn") for record in records if record.get("psn")}

        if len(records) > 1 and len(companies) > 1 and len(psns) > 1:
            first = records[0]
            file_location_conflicts.append({
                "file": first.get("file", ""),
                "address": first.get("address", ""),
                "city": first.get("city", "Unknown"),
                "state": first.get("state", "Unknown"),
                "records": sorted([
                    {
                        "psn": record.get("psn", ""),
                        "company": record.get("company", "Unknown"),
                        "address": record.get("address", ""),
                        "city": record.get("city", "Unknown"),
                        "state": record.get("state", "Unknown"),
                        "country": record.get("country", "Unknown"),
                        "file": record.get("file", ""),
                    }
                    for record in records
                ], key=lambda item: (item["company"], item["psn"])),
            })

    return {
        "missing_tracker_psn_possible_contact_matches": missing_matches,
        "same_file_location_different_company_psn": sorted(
            file_location_conflicts,
            key=lambda item: (item["file"], item["state"], item["city"]),
        ),
    }


def build_auditor_defects(auditor_map):
    rows = []

    for auditor, psns in auditor_map.items():
        rows.append({
            "auditor": auditor,
            "count": len(psns),
            "psns": sorted(psns, key=str),
        })

    return sorted(rows, key=lambda item: (-item["count"], item["auditor"]))


def erfinv(y):
    a = 0.147
    sign = 1 if y >= 0 else -1
    ln = math.log(1 - y*y)
    term = (2/(math.pi*a) + ln/2)
    inside = term*term - ln/a
    return sign * math.sqrt(math.sqrt(inside) - term)


# ✅ MAIN ENDPOINT
@app.post("/upload")
async def upload(
    contact_file: Optional[UploadFile] = File(None),
    tracker_file: Optional[UploadFile] = File(None),
    file: Optional[UploadFile] = File(None),
    use_tracker_filter: bool = Form(True),
):

    global latest_state_map, latest_state_details, latest_companies
    global latest_company_counts, latest_defect_types, latest_auditor_defects
    global latest_discrepancies, latest_possible_matches, latest_summary, analysis_history

    selected_contact_file = contact_file or file

    if selected_contact_file is None:
        raise HTTPException(
            status_code=400,
            detail="Please upload the customer contact list.",
        )

    if use_tracker_filter and tracker_file is None:
        raise HTTPException(
            status_code=400,
            detail="Please upload the audit tracker or turn off the tracker filter.",
        )

    try:
        tracker_df = pd.read_excel(tracker_file.file, sheet_name=0, header=None) if use_tracker_filter else None
        df = pd.read_excel(selected_contact_file.file, header=None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read one of the uploaded Excel files.") from exc

    if df.shape[1] < REQUIRED_COLUMNS:
        raise HTTPException(
            status_code=400,
            detail=f"Expected at least {REQUIRED_COLUMNS} columns, but found {df.shape[1]}.",
        )

    if use_tracker_filter:
        eligible_psns, yes_psn_details, tracker_psn_details, tracker_meta = extract_quinsights_yes_psns(tracker_df)
    else:
        eligible_psns = None
        yes_psn_details = {}
        tracker_psn_details = {}
        tracker_meta = {
            "tracker_psns": None,
            "quinsights_yes_psns": None,
        }

    report_date = extract_report_date(df)
    contact_records = build_contact_records(df)
    contact_records_by_psn = {record["psn"]: record for record in contact_records}
    contact_reference_records = [record for record in contact_records if is_visible_reference_record(record)]
    contact_reference_records_by_psn = {record["psn"]: record for record in contact_reference_records}

    total = 0
    defective_units = 0
    contact_us_rows = 0
    contact_all_psns = set()
    contact_us_psns = set()
    matched_psns = set()

    state_map = defaultdict(list)
    state_details = defaultdict(list)
    company_map = defaultdict(int)
    defect_type_map = defaultdict(int)
    auditor_defect_map = defaultdict(list)

    for _, row in df.iloc[1:].iterrows():
        psn = normalize_psn(row[COL_PSN])
        if psn:
            contact_all_psns.add(psn)

        country = str(row[COL_COUNTRY]).strip().upper()

        if not is_us_reference_country(country):
            continue

        contact_us_rows += 1
        if psn:
            contact_us_psns.add(psn)

        if eligible_psns is not None and psn not in eligible_psns:
            continue

        matched_psns.add(psn)
        total += 1

        state = clean_state(row[COL_STATE])

        raw_company = row[COL_COMPANY]
        company = normalize_company(raw_company)
        asc_name = clean_text(raw_company)
        city = clean_text(row[COL_CITY])

        blob = row[COL_CONTACTS]

        is_defect, defect_reasons = evaluate_contacts(blob)

        if is_defect:
            defective_units += 1
            auditor = yes_psn_details.get(psn, {}).get("auditor", "Unknown")
            state_map[state].append(psn)
            state_details[state].append({
                "psn": psn,
                "asc_name": asc_name,
                "city": city,
                "state": state,
                "auditor": auditor,
            })
            if use_tracker_filter:
                auditor_defect_map[auditor].append(psn)
            company_map[company] += 1
            for reason in defect_reasons:
                defect_type_map[reason] += 1

    latest_state_map = dict(state_map)
    latest_state_details = dict(state_details)
    latest_auditor_defects = build_auditor_defects(auditor_defect_map)
    if use_tracker_filter:
        tracker_all_psns = set(tracker_psn_details.keys())
        missing_tracker_psns = tracker_all_psns - contact_all_psns
        contact_reference_not_tracker_psns = contact_us_psns - tracker_all_psns
        latest_discrepancies = {
            "tracker_yes_missing_from_contact_list": tracker_record_list(tracker_psn_details, missing_tracker_psns),
            "tracker_yes_found_but_not_us_contact": [],
            "contact_us_not_tracker_yes": record_list(contact_reference_records_by_psn, contact_reference_not_tracker_psns),
        }
        latest_possible_matches = build_possible_matches(tracker_psn_details, contact_reference_records, missing_tracker_psns)
    else:
        latest_discrepancies = {
            "tracker_yes_missing_from_contact_list": [],
            "tracker_yes_found_but_not_us_contact": [],
            "contact_us_not_tracker_yes": [],
        }
        latest_possible_matches = {
            "missing_tracker_psn_possible_contact_matches": [],
            "same_file_location_different_company_psn": [],
        }

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
            "report_date": report_date,
            "use_tracker_filter": use_tracker_filter,
            "contact_us_rows": contact_us_rows,
            "matched_psns": len(matched_psns),
            "auditors_with_defects": len(latest_auditor_defects),
            "tracker_yes_missing_from_contact_list": len(latest_discrepancies["tracker_yes_missing_from_contact_list"]),
            "tracker_yes_found_but_not_us_contact": len(latest_discrepancies["tracker_yes_found_but_not_us_contact"]),
            "contact_us_not_tracker_yes": len(latest_discrepancies["contact_us_not_tracker_yes"]),
            "possible_match_groups": len(latest_possible_matches["missing_tracker_psn_possible_contact_matches"]),
            "same_file_location_conflicts": len(latest_possible_matches["same_file_location_different_company_psn"]),
            **tracker_meta,
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

    latest_summary = {
        "total": total,
        "defective_units": defective_units,
        "defects": defective_units,
        "total_defects": total_defects,
        "defect_rate": defect_rate,
        "dpmo": dpmo,
        "sigma": sigma,
        "report_date": report_date,
        "use_tracker_filter": use_tracker_filter,
        "contact_us_rows": contact_us_rows,
        "matched_psns": len(matched_psns),
        "auditors_with_defects": len(latest_auditor_defects),
        "tracker_yes_missing_from_contact_list": len(latest_discrepancies["tracker_yes_missing_from_contact_list"]),
        "tracker_yes_found_but_not_us_contact": len(latest_discrepancies["tracker_yes_found_but_not_us_contact"]),
        "contact_us_not_tracker_yes": len(latest_discrepancies["contact_us_not_tracker_yes"]),
        "possible_match_groups": len(latest_possible_matches["missing_tracker_psn_possible_contact_matches"]),
        "same_file_location_conflicts": len(latest_possible_matches["same_file_location_different_company_psn"]),
        **tracker_meta,
        "baseline": BASELINE,
    }

    analysis_history.append({
        "label": report_date,
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


@app.get("/auditor-defects")
def auditor_defects():
    return latest_auditor_defects


def export_rows_for_dataset(dataset):
    if dataset == "tracker-missing":
        return [
            {
                "Source": "Audit Tracker",
                "PSN": row.get("psn", ""),
                "Company / ASC": row.get("company", ""),
                "Address": row.get("address", ""),
                "City": row.get("city", ""),
                "State": row.get("state", ""),
                "File Number": row.get("file", ""),
                "Auditor": row.get("auditor", ""),
            }
            for row in latest_discrepancies.get("tracker_yes_missing_from_contact_list", [])
        ]

    if dataset == "contact-not-tracker":
        return [
            {
                "Source": "Customer Contact List",
                "PSN": row.get("psn", ""),
                "Company / ASC": row.get("company", ""),
                "Address": row.get("address", ""),
                "City": row.get("city", ""),
                "State": row.get("state", ""),
                "Country": row.get("country", ""),
                "File / SCN": row.get("file", ""),
            }
            for row in latest_discrepancies.get("contact_us_not_tracker_yes", [])
            if is_visible_reference_record(row)
        ]

    if dataset == "possible-matches":
        rows = []
        for group in latest_possible_matches.get("missing_tracker_psn_possible_contact_matches", []):
            for match in group.get("possible_matches", []):
                if not is_visible_reference_record({"company": match.get("contact_company", ""), "country": match.get("contact_country", "")}):
                    continue
                rows.append({
                    "Tracker PSN": group.get("tracker_psn", ""),
                    "Tracker Company / ASC": group.get("tracker_company", ""),
                    "Tracker City": group.get("tracker_city", ""),
                    "Tracker State": group.get("tracker_state", ""),
                    "Tracker File Number": group.get("tracker_file", ""),
                    "Tracker Auditor": group.get("tracker_auditor", ""),
                    "Possible Current PSN": match.get("contact_psn", ""),
                    "Current Company / ASC": match.get("contact_company", ""),
                    "Current Address": match.get("contact_address", ""),
                    "Current City": match.get("contact_city", ""),
                    "Current State": match.get("contact_state", ""),
                    "Current Country": match.get("contact_country", ""),
                    "Current File / SCN": match.get("contact_file", ""),
                    "Match Score": match.get("score", ""),
                    "Why Matched": "; ".join(match.get("reasons", [])),
                })
        return rows

    if dataset == "file-location-conflicts":
        rows = []
        for group in latest_possible_matches.get("same_file_location_different_company_psn", []):
            for row in group.get("records", []):
                if not is_visible_reference_record(row):
                    continue
                rows.append({
                    "PSN": row.get("psn", ""),
                    "Company / ASC": row.get("company", ""),
                    "Address": row.get("address", group.get("address", "")),
                    "City": row.get("city", group.get("city", "")),
                    "State": row.get("state", group.get("state", "")),
                    "Country": row.get("country", ""),
                    "File / SCN": row.get("file", group.get("file", "")),
                    "Conflict Group": f"{group.get('file', '')} | {group.get('city', '')}, {group.get('state', '')}",
                })
        return rows

    raise HTTPException(status_code=404, detail="Unknown export list.")


@app.get("/export/{dataset}/{fmt}")
def export_dataset(dataset: str, fmt: str):
    rows = export_rows_for_dataset(dataset)
    df = pd.DataFrame(rows)
    safe_dataset = re.sub(r"[^a-z0-9_-]", "-", dataset.lower())

    if fmt == "csv":
        csv_text = df.to_csv(index=False)
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=sigmasight-{safe_dataset}.csv"},
        )

    if fmt in {"xlsx", "excel"}:
        from io import BytesIO
        output = BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="SigmaSight")
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=sigmasight-{safe_dataset}.xlsx"},
        )

    raise HTTPException(status_code=400, detail="Export format must be csv or xlsx.")


@app.get("/psn-discrepancies")
def psn_discrepancies():
    return latest_discrepancies




@app.get("/possible-matches")
def possible_matches():
    return latest_possible_matches


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
