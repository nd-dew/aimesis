"""Persistent store and derivation layer for AImesis (SPEC-storage-model.md & SPEC-backend-fixes-3.md).
Handles re-entrant atomic file writes, seed reset, queries, feedback loop linking, and cycle derivation.
"""

import os
import shutil
import json
import threading
import secrets
import time
from uuid import uuid4
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Optional, Tuple, Any

from app.models import Patient, Cycle, NauseaLogEntry, compute_mosteller_bsa

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
SEED_DIR = os.path.join(DATA_DIR, "seed")
RUNTIME_DIR = os.path.join(DATA_DIR, "runtime")

_lock = threading.RLock()
_rate_limits: Dict[str, List[float]] = {}

class DuplicateIdError(Exception):
    pass

def _ensure_runtime_initialized():
    """Initializes data/runtime from data/seed if missing."""
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    for filename in ["patients.json", "cycles.json", "nausea_log.json", "patient_mobile_logs.json"]:
        runtime_path = os.path.join(RUNTIME_DIR, filename)
        seed_path = os.path.join(SEED_DIR, filename)
        if not os.path.exists(runtime_path):
            if os.path.exists(seed_path):
                shutil.copy2(seed_path, runtime_path)
            else:
                with open(runtime_path, "w", encoding="utf-8") as f:
                    json.dump([], f)

def _read_json(filename: str) -> list:
    _ensure_runtime_initialized()
    path = os.path.join(RUNTIME_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def _write_json_atomic(filename: str, data: list):
    """Thread-safe, atomic file write using temp file and os.replace."""
    _ensure_runtime_initialized()
    target_path = os.path.join(RUNTIME_DIR, filename)
    temp_path = f"{target_path}.tmp.{uuid4().hex}"

    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())

    os.replace(temp_path, target_path)

def reset_to_seed():
    """Restores data/runtime from data/seed."""
    with _lock:
        os.makedirs(RUNTIME_DIR, exist_ok=True)
        for filename in ["patients.json", "cycles.json", "nausea_log.json", "patient_mobile_logs.json"]:
            seed_path = os.path.join(SEED_DIR, filename)
            runtime_path = os.path.join(RUNTIME_DIR, filename)
            if os.path.exists(seed_path):
                shutil.copy2(seed_path, runtime_path)
            else:
                with open(runtime_path, "w", encoding="utf-8") as f:
                    json.dump([], f)
        _rate_limits.clear()

# --- Patient Operations ---

def list_patients() -> List[Patient]:
    with _lock:
        raw = _read_json("patients.json")
        return [Patient.model_validate(p) for p in raw]

def get_patient(patient_id: str) -> Optional[Patient]:
    with _lock:
        raw = _read_json("patients.json")
        for p in raw:
            if p["id"] == patient_id:
                return Patient.model_validate(p)
    return None

def get_patient_by_token(token: str) -> Optional[Patient]:
    if not token or not token.strip():
        return None
    with _lock:
        raw = _read_json("patients.json")
        for p in raw:
            if p.get("companion_token") == token:
                return Patient.model_validate(p)
    return None

def generate_companion_token(patient_id: str) -> Optional[str]:
    """Generates a secure, revocable token for companion access."""
    with _lock:
        raw = _read_json("patients.json")
        found_token = None
        for p in raw:
            if p["id"] == patient_id:
                found_token = secrets.token_urlsafe(16)
                p["companion_token"] = found_token
                break
        if found_token:
            _write_json_atomic("patients.json", raw)
            return found_token
    return None

def add_patient(patient: Patient) -> Patient:
    """H9: 409 on duplicate id; server-generated id when omitted."""
    with _lock:
        raw = _read_json("patients.json")
        if any(p["id"] == patient.id for p in raw):
            raise DuplicateIdError(f"Patient with id '{patient.id}' already exists")
        raw.append(patient.model_dump())
        _write_json_atomic("patients.json", raw)
    return patient

def update_patient(patient_id: str, updates: dict) -> Optional[Patient]:
    """H1: Re-entrant safe update returning model directly."""
    with _lock:
        raw = _read_json("patients.json")
        updated_obj = None
        updated_list = []
        for p in raw:
            if p["id"] == patient_id:
                # Forbid modifying immutable fields
                updates.pop("id", None)
                updates.pop("companion_token", None)
                p.update(updates)
                updated_obj = Patient.model_validate(p)
            updated_list.append(p)
        if updated_obj:
            _write_json_atomic("patients.json", updated_list)
            return updated_obj
    return None

# --- Cycle Operations ---

def list_cycles() -> List[Cycle]:
    with _lock:
        raw = _read_json("cycles.json")
        return [Cycle.model_validate(c) for c in raw]

def get_cycle(cycle_id: str) -> Optional[Cycle]:
    with _lock:
        raw = _read_json("cycles.json")
        for c in raw:
            if c["id"] == cycle_id:
                return Cycle.model_validate(c)
    return None

def cycles_for(patient_id: str) -> List[Cycle]:
    with _lock:
        raw = _read_json("cycles.json")
        patient_cycles = [Cycle.model_validate(c) for c in raw if c["patient_id"] == patient_id]
        # H9: Sort by sequence if present, then date
        patient_cycles.sort(key=lambda x: (x.sequence if x.sequence is not None else 999, x.date or "1970-01-01"))
        return patient_cycles

def add_cycle(cycle: Cycle) -> Cycle:
    """H9: 409 on duplicate id; sequence assigned if omitted."""
    with _lock:
        raw = _read_json("cycles.json")
        if any(c["id"] == cycle.id for c in raw):
            raise DuplicateIdError(f"Cycle with id '{cycle.id}' already exists")

        # Assign sequence if missing
        if cycle.sequence is None:
            patient_cycles = [c for c in raw if c.get("patient_id") == cycle.patient_id]
            cycle.sequence = len(patient_cycles) + 1

        raw.append(cycle.model_dump())
        _write_json_atomic("cycles.json", raw)
    return cycle

def update_cycle(cycle_id: str, updates: dict) -> Optional[Cycle]:
    """H1: Re-entrant safe update returning model directly."""
    with _lock:
        raw = _read_json("cycles.json")
        updated_obj = None
        updated_list = []
        for c in raw:
            if c["id"] == cycle_id:
                updates.pop("id", None)
                updates.pop("patient_id", None)
                c.update(updates)
                updated_obj = Cycle.model_validate(c)
            updated_list.append(c)
        if updated_obj:
            _write_json_atomic("cycles.json", updated_list)
            return updated_obj
    return None

# --- Nausea Log Operations & Feedback Loop (H3) ---

def clamp_occurred_at(occurred_at_str: Optional[str]) -> str:
    """Clamps occurred_at between (now - 7 days) and now."""
    now = datetime.now(timezone.utc)
    if not occurred_at_str:
        return now.isoformat()
    try:
        dt = datetime.fromisoformat(occurred_at_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt > now:
            dt = now
        elif dt < now - timedelta(days=7):
            dt = now - timedelta(days=7)
        return dt.isoformat()
    except Exception:
        return now.isoformat()

def find_cycle_for_timestamp(patient_id: str, occurred_at_iso: str) -> Optional[str]:
    """H3: Auto-links a companion log to the cycle whose window contains occurred_at."""
    try:
        target_dt = datetime.fromisoformat(occurred_at_iso.replace("Z", "+00:00"))
        if target_dt.tzinfo is None:
            target_dt = target_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

    patient_cycles = cycles_for(patient_id)
    dated_cycles = [c for c in patient_cycles if c.date]

    for i, c in enumerate(dated_cycles):
        try:
            c_start = datetime.fromisoformat(c.date).replace(tzinfo=timezone.utc)
            if i + 1 < len(dated_cycles):
                c_end = datetime.fromisoformat(dated_cycles[i + 1].date).replace(tzinfo=timezone.utc)
            else:
                c_end = c_start + timedelta(days=7)

            if c_start <= target_dt <= c_end:
                return c.id
        except Exception:
            continue

    return None

def add_log(entry: NauseaLogEntry) -> Tuple[NauseaLogEntry, bool]:
    """Appends nausea log entry with H3 auto cycle-linking, classification, and client_id deduplication."""
    with _lock:
        raw = _read_json("nausea_log.json")

        # 1. Idempotency Check
        if entry.client_id:
            for item in raw:
                if item.get("patient_id") == entry.patient_id and item.get("client_id") == entry.client_id:
                    return NauseaLogEntry.model_validate(item), True

        # 2. Clamping timestamps
        entry.occurred_at = clamp_occurred_at(entry.occurred_at)
        entry.received_at = datetime.now(timezone.utc).isoformat()
        entry.timestamp = entry.occurred_at

        # 3. H3: Auto-link to cycle window if cycle_id is None
        if not entry.cycle_id:
            entry.cycle_id = find_cycle_for_timestamp(entry.patient_id, entry.occurred_at)

        # 4. H3: Auto-classify acute vs delayed if not specified
        if not entry.type or entry.type == "acute":
            # If linked to a cycle with a date, check if > 24h from start
            linked_cycle = get_cycle(entry.cycle_id) if entry.cycle_id else None
            if linked_cycle and linked_cycle.date:
                try:
                    c_dt = datetime.fromisoformat(linked_cycle.date).replace(tzinfo=timezone.utc)
                    occ_dt = datetime.fromisoformat(entry.occurred_at.replace("Z", "+00:00"))
                    if occ_dt.tzinfo is None: occ_dt = occ_dt.replace(tzinfo=timezone.utc)
                    diff_hours = (occ_dt - c_dt).total_seconds() / 3600.0
                    if diff_hours > 24:
                        entry.type = "delayed"
                except Exception:
                    pass

        raw.append(entry.model_dump())
        _write_json_atomic("nausea_log.json", raw)
        return entry, False

def delete_log(entry_id: str, patient_id: str) -> bool:
    """Deletes an entry only if within 10 minutes of creation."""
    with _lock:
        raw = _read_json("nausea_log.json")
        now = datetime.now(timezone.utc)
        target = None
        for item in raw:
            if item.get("id") == entry_id and item.get("patient_id") == patient_id:
                target = item
                break

        if not target:
            return False

        try:
            received_dt = datetime.fromisoformat(target.get("received_at", "").replace("Z", "+00:00"))
            if received_dt.tzinfo is None:
                received_dt = received_dt.replace(tzinfo=timezone.utc)
            if (now - received_dt).total_seconds() > 600:
                return False
        except Exception:
            pass

        raw = [item for item in raw if not (item.get("id") == entry_id and item.get("patient_id") == patient_id)]
        _write_json_atomic("nausea_log.json", raw)
        return True

def list_logs(patient_id: Optional[str] = None, days: Optional[int] = None) -> List[NauseaLogEntry]:
    with _lock:
        raw = _read_json("nausea_log.json")
        entries = [NauseaLogEntry.model_validate(e) for e in raw]
        if patient_id:
            entries = [e for e in entries if e.patient_id == patient_id]

        if days is not None:
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            filtered = []
            for e in entries:
                try:
                    ts = datetime.fromisoformat((e.occurred_at or e.received_at).replace("Z", "+00:00"))
                    if ts.tzinfo is None: ts = ts.replace(tzinfo=timezone.utc)
                    if ts >= cutoff:
                        filtered.append(e)
                except Exception:
                    filtered.append(e)
            entries = filtered

        entries.sort(key=lambda x: x.timestamp or x.received_at, reverse=True)
        return entries

def check_rate_limit(token: str, max_requests: int = 60, window_seconds: int = 3600) -> bool:
    """Checks in-memory rate limit for companion writes. Caps bucket size (H10)."""
    now = time.time()
    cutoff = now - window_seconds
    with _lock:
        # Cap overall buckets if too many tokens
        if len(_rate_limits) > 500:
            _rate_limits.clear()

        timestamps = _rate_limits.get(token, [])
        timestamps = [ts for ts in timestamps if ts > cutoff]
        if len(timestamps) >= max_requests:
            _rate_limits[token] = timestamps
            return False
        timestamps.append(now)
        _rate_limits[token] = timestamps
        return True

# --- Derivation Engine (H3, H8) ---

def derive_evaluation_payload(
    patient_id: Optional[str],
    cycle_id: Optional[str],
    request_data: dict,
) -> Tuple[dict, Dict[str, str]]:
    """Derives clinical inputs from Patient + Cycle history + Nausea logs.
    H8: No silent defaults: missing weight, age, or BSA/height returns missing_fields.
    H3: Unlinked companion logs in cycle window feed prior nausea.
    """
    derived_from: Dict[str, str] = {}
    payload: Dict[str, Any] = {}

    patient: Optional[Patient] = None
    if patient_id:
        patient = get_patient(patient_id)

    # 1. Patient Level Attributes
    if patient:
        payload["patient_alias"] = patient.alias
        derived_from["patient_alias"] = "patient"

        payload["age_years"] = patient.age_years
        derived_from["age_years"] = "patient"

        if patient.weight_kg is not None:
            payload["weight_kg"] = patient.weight_kg
            derived_from["weight_kg"] = "patient"

        if patient.height_cm is not None:
            payload["height_cm"] = patient.height_cm
            derived_from["height_cm"] = "patient"

        if patient.bsa_m2 is not None:
            payload["bsa_m2"] = patient.bsa_m2
            derived_from["bsa_m2"] = "patient"
        elif patient.weight_kg and patient.height_cm:
            payload["bsa_m2"] = compute_mosteller_bsa(patient.weight_kg, patient.height_cm)
            derived_from["bsa_m2"] = "patient"

        payload["diagnosis"] = patient.diagnosis_text
        derived_from["diagnosis"] = "patient"

        payload["diagnosis_category"] = patient.diagnosis_category
        derived_from["diagnosis_category"] = "patient"

        payload["dinutuximab_beta"] = patient.flags.get("dinutuximab_beta", False)
        derived_from["dinutuximab_beta"] = "patient"

        payload["car_t"] = patient.flags.get("car_t", False)
        derived_from["car_t"] = "patient"

        payload["target_language"] = patient.language
        derived_from["target_language"] = "patient"

        payload["can_swallow_tablets"] = (patient.swallow == "tablets")
        payload["formulation_preference"] = "iv" if patient.swallow == "iv_only" else ("oral_liquid" if patient.swallow == "liquid_only" else None)
        derived_from["can_swallow_tablets"] = "patient"

        # H8: Use patient.protocol for protocol_name
        payload["protocol_name"] = patient.protocol
        derived_from["protocol_name"] = "patient"

    # 2. Cycle Level Attributes
    planned_cycle: Optional[Cycle] = None
    if cycle_id:
        planned_cycle = get_cycle(cycle_id)

    if planned_cycle:
        payload["cycle_label"] = planned_cycle.label
        derived_from["cycle_label"] = f"cycle:{planned_cycle.id}"

        drugs = [r.drug for r in planned_cycle.regimen]
        doses = {r.drug.lower(): r.dose_mg_m2 for r in planned_cycle.regimen if r.dose_mg_m2 is not None}
        payload["drugs"] = drugs
        payload["doses_mg_m2"] = doses
        derived_from["drugs"] = f"cycle:{planned_cycle.id}"
        derived_from["doses_mg_m2"] = f"cycle:{planned_cycle.id}"

        payload["is_multiday"] = planned_cycle.is_multiday
        derived_from["is_multiday"] = f"cycle:{planned_cycle.id}"

        payload["regimen_contains_corticoids"] = planned_cycle.regimen_contains_corticoids
        derived_from["regimen_contains_corticoids"] = f"cycle:{planned_cycle.id}"

        patient_cycles = cycles_for(planned_cycle.patient_id)
        given_cycles = [c for c in patient_cycles if c.status == "given"]
        if planned_cycle.date:
            given_cycles = [c for c in given_cycles if (c.date or "") < planned_cycle.date]

        matching_course_cycles = [c for c in given_cycles if c.course_type == planned_cycle.course_type]
        previous_cycle = matching_course_cycles[-1] if matching_course_cycles else (given_cycles[-1] if given_cycles else None)

        if previous_cycle:
            had_nausea = False
            had_vomiting = False
            source_tag = f"cycle:{previous_cycle.id}"

            # Check outcome recorded in cycle
            if previous_cycle.outcome:
                if previous_cycle.outcome.nausea: had_nausea = True
                if previous_cycle.outcome.vomiting: had_vomiting = True

            # H3: Include linked logs AND unlinked logs whose occurred_at falls in window
            patient_logs = list_logs(planned_cycle.patient_id)
            c_logs = []
            prev_start = previous_cycle.date
            # Determine window end
            prev_idx = patient_cycles.index(previous_cycle) if previous_cycle in patient_cycles else -1
            next_given = patient_cycles[prev_idx + 1] if prev_idx + 1 < len(patient_cycles) else None
            prev_end = next_given.date if next_given and next_given.date else None

            for l in patient_logs:
                if l.cycle_id == previous_cycle.id:
                    c_logs.append(l)
                elif prev_start and l.occurred_at:
                    l_dt = l.occurred_at[:10]
                    if prev_end:
                        if prev_start <= l_dt <= prev_end:
                            c_logs.append(l)
                    else:
                        if prev_start <= l_dt:
                            c_logs.append(l)

            # Check severity from logs
            for l in c_logs:
                if l.severity >= 2:
                    had_nausea = True
                    source_tag = "log"
                if l.severity >= 4 or ("braken" in (l.note or "").lower() or "vomit" in (l.note or "").lower()):
                    had_vomiting = True
                    source_tag = "log"

            from app.patient_mobile import reports_for_cycle
            if any(report.kind == "vomiting" or report.severity > 0 for report in reports_for_cycle(previous_cycle, prev_end)):
                had_nausea = True
                source_tag = "patient_mobile"

            payload["had_prior_nausea"] = had_nausea
            derived_from["had_prior_nausea"] = source_tag

            prev_prop = [p.model_dump() for p in previous_cycle.prophylaxis_given]
            payload["previous_prophylaxis"] = prev_prop
            derived_from["previous_prophylaxis"] = f"cycle:{previous_cycle.id}"

            has_anticipatory = any(l.type == "anticipatory" for l in c_logs)
            payload["anticipatory_symptoms"] = has_anticipatory
            if has_anticipatory:
                derived_from["anticipatory_symptoms"] = "log"
        else:
            payload["had_prior_nausea"] = False
            payload["previous_prophylaxis"] = []
            payload["anticipatory_symptoms"] = False

    # 3. Explicit Overrides from Request Body
    for field, val in request_data.items():
        if val is not None and field not in ("patient_id", "cycle_id"):
            payload[field] = val
            derived_from[field] = "request"

    # H8: Strict validation: check for missing fields after derivation
    missing = []
    if "age_years" not in payload or payload["age_years"] is None:
        missing.append("age_years")
    if "weight_kg" not in payload or payload["weight_kg"] is None:
        missing.append("weight_kg")
    if ("bsa_m2" not in payload or payload["bsa_m2"] is None) and ("height_cm" not in payload or payload["height_cm"] is None):
        missing.append("bsa_m2 or height_cm")

    if missing:
        payload["_missing_fields"] = missing

    return payload, derived_from
