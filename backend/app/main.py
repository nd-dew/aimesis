"""FastAPI Backend Server for AImesis Pediatric CINV CDS & Companion API.
Strictly implements SPEC-backend-fixes.md, SPEC-storage-model.md, SPEC-backend-fixes-2.md, and SPEC-backend-fixes-3.md.
"""

import os
import io
import re
import json
import base64
import secrets
import logging
from uuid import uuid4
from datetime import datetime, timezone
from typing import List, Dict, Optional, Any
from fastapi import FastAPI, HTTPException, Header, Depends, Query, Request, UploadFile, File, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import segno

import app.config as config
from app.models import (
    Patient, PatientUpdate, Cycle, PatchCycleRequest, NauseaLogEntry,
    CompanionLogRequest, CompanionLogResponse, CompanionLogOut,
    CompanionViewResponse, CompanionLinkResponse, CompanionTodayMedication,
    EvaluateRequest, NoteParseRequest, WatchoutsRequest,
)
import app.store as store
from app import patient_mobile
from app.engine.rules import derive_schedule_medications
from app.engine.graph import cinv_graph, PASSPORT_I18N, ALL_FAMILY_RESOURCES
from app.engine.gemini import parse_clinical_progress_note, parse_clinical_progress_note_image, generate_watchouts, USE_LLM

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("aimesis")

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
UPLOADS_DIR = os.path.join(DATA_DIR, "runtime", "uploads")
_photo_uploads_per_patient: Dict[str, List[float]] = {}

app = FastAPI(
    title="AImesis - Pediatric CINV CDS & Companion API",
    version="1.4.0",
    description="Pediatric CINV decision support based on published POGO and CCLG guidelines (demo, not for clinical use).",
)

# CORS Middleware (G9: explicit origins only)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Consistent Error Handlers
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    code = "ERROR"
    if exc.status_code == 401: code = "UNAUTHORIZED"
    elif exc.status_code == 403: code = "FORBIDDEN"
    elif exc.status_code == 404: code = "NOT_FOUND"
    elif exc.status_code == 409: code = "CONFLICT"
    elif exc.status_code == 413: code = "PAYLOAD_TOO_LARGE"
    elif exc.status_code == 415: code = "UNSUPPORTED_MEDIA_TYPE"
    elif exc.status_code == 422: code = "UNPROCESSABLE_ENTITY"
    elif exc.status_code == 429: code = "RATE_LIMIT_EXCEEDED"
    elif exc.status_code == 501: code = "NOT_IMPLEMENTED"

    message = exc.detail
    if isinstance(exc.detail, dict) and "error" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    elif isinstance(exc.detail, dict) and "message" in exc.detail:
        message = exc.detail["message"]
        code = exc.detail.get("code", code)

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": str(message)}},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"error": {"code": "VALIDATION_ERROR", "message": str(exc)}},
    )

# H7: Generic 500 handler returning request_id and generic message
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    req_id = str(uuid4())
    logger.exception(f"Unhandled server error [request_id={req_id}]: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_SERVER_ERROR", "message": "An internal server error occurred", "request_id": req_id}},
    )

# Request logging middleware without logging full secrets
@app.middleware("http")
async def log_requests(request: Request, call_next):
    path = request.url.path
    if path.startswith(("/api/companion/", "/api/patient-mobile/")):
        parts = path.split("/")
        if len(parts) >= 4 and parts[3]:
            masked_token = parts[3][:4] + "..."
            path = "/".join(parts[:3] + [masked_token] + parts[4:])
    elif path.startswith("/patient/"):
        path = "/patient/" + path.split("/")[2][:4] + "..."
    logger.info(f"{request.method} {path}")
    return await call_next(request)

# HTTP Basic Auth Middleware for Team Access Protection
@app.middleware("http")
async def basic_auth_middleware(request: Request, call_next):
    if not config.BASIC_AUTH_ENABLED:
        return await call_next(request)

    # Allow CORS preflight requests
    if request.method == "OPTIONS":
        return await call_next(request)

    # Health check is exempt for Cloud Run probes
    path = request.url.path
    if path == "/health":
        return await call_next(request)

    # Skip basic auth for companion routes (/m/* and /api/companion/*)
    if path.startswith(("/m/", "/api/companion/", "/patient/", "/api/patient-mobile/")):
        return await call_next(request)

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Basic "):
        try:
            encoded_credentials = auth_header.split(" ", 1)[1]
            decoded = base64.b64decode(encoded_credentials).decode("utf-8")
            username, _, password = decoded.partition(":")
            correct_user = secrets.compare_digest(username, config.BASIC_AUTH_USER)
            correct_pass = secrets.compare_digest(password, config.BASIC_AUTH_PASS)
            if correct_user and correct_pass:
                return await call_next(request)
        except Exception:
            pass

    return Response(
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="AImesis Project Access", charset="UTF-8"'},
        content="Unauthorized: Access requires team credentials.",
        media_type="text/plain",
    )

# Security Dependency for Clinician Endpoints (open by default unless explicitly configured)
def verify_clinician_api_key(x_api_key: Optional[str] = Header(None)):
    if config.CLINICIAN_API_KEY:
        if not x_api_key or x_api_key != config.CLINICIAN_API_KEY:
            raise HTTPException(
                status_code=401,
                detail={"error": {"code": "UNAUTHORIZED", "message": "Invalid or missing X-API-Key"}},
            )
    return True

# Admin guard: if ADMIN_KEY is set, admin endpoints need it in X-Admin-Key or X-API-Key
# (X-API-Key lets the existing clinician UI key prompt work for the reset button)
def verify_admin_key(x_admin_key: Optional[str] = Header(None), x_api_key: Optional[str] = Header(None)):
    if config.ADMIN_KEY:
        sent = x_admin_key or x_api_key or ""
        if not secrets.compare_digest(sent, config.ADMIN_KEY):
            raise HTTPException(
                status_code=401,
                detail={"error": {"code": "UNAUTHORIZED", "message": "Invalid or missing admin key"}},
            )
    return True

app.mount("/patient/assets", StaticFiles(directory=os.path.join(config.FRONTEND_DIST, "patient", "assets"), check_dir=False), name="patient-mobile-assets")
app.include_router(patient_mobile.router)
app.include_router(patient_mobile.clinician_router, dependencies=[Depends(verify_clinician_api_key)])

# --- Health Endpoint ---

@app.get("/health", tags=["admin"])
def health():
    return {"status": "ok", "service": "AImesis API", "version": "1.4.0"}

# --- Companion Endpoints (H2, H3, H10) ---

@app.get("/api/companion/{token}", response_model=CompanionViewResponse, tags=["companion"])
def get_companion_view(token: str):
    # H10: Validate token first
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "NOT_FOUND", "message": "Invalid or expired companion link"}},
        )

    # 1. Upcoming cycle
    cycles = store.cycles_for(patient.id)
    planned = next((c for c in cycles if c.status == "planned"), None)

    # 2. Localized templates
    lang = (patient.language or "NL").upper()
    if lang not in ["NL", "FR", "EN"]:
        lang = "NL"
    i18n = PASSPORT_I18N.get(lang, PASSPORT_I18N["NL"])
    filtered_resources = [r for r in ALL_FAMILY_RESOURCES if r.get("language") == lang]

    passport = {
        "hospital": i18n["hospital"],
        "emergency_contact": i18n["contact_info"],
        "time_labels": i18n["time_labels"],
        "red_flag_title": i18n["red_flag_title"],
        "red_flag_symptoms": i18n["red_flags"],
        "belgian_family_resources": filtered_resources,
    }

    # 3. H2: Medication schedule from approved snapshot only
    today_meds: List[CompanionTodayMedication] = []
    upcoming_dict = None
    schedule_msg = None

    if planned:
        has_approved_plan = bool(planned.plan_snapshot and planned.plan_snapshot.approved)
        assigned_tier = planned.plan_snapshot.effective_tier if has_approved_plan else planned.tier_assigned

        upcoming_dict = {
            "id": planned.id,
            "label": planned.label,
            "course_type": planned.course_type,
            "date": planned.date,
            "tier": assigned_tier if has_approved_plan else None,  # H2: never default to High
            "is_multiday": planned.is_multiday,
        }

        if has_approved_plan and planned.plan_snapshot:
            # Reconstruct schedule from snapshot for shared derive_schedule_medications
            mock_sched = {}
            extras = []
            standard = {"ondansetron", "dexamethasone", "aprepitant", "olanzapine"}
            for itm in planned.plan_snapshot.items:
                drug_key = itm.drug.lower().replace("(fos)", "").replace(" ", "").strip()
                if drug_key not in standard:
                    # added by the clinician: shown as typed, spread over the day by its frequency
                    extras.append({"drug": itm.drug, "dose_text": itm.dose_text, "frequency": itm.frequency})
                    continue
                entry = {
                    "drug": itm.drug,
                    "dose_mg": itm.dose_mg,
                    "dose": itm.dose_text,
                    "route": itm.route,
                    "frequency": itm.frequency,
                    "status": "RECOMMENDED",
                }
                if drug_key == "dexamethasone":
                    entry["dose"] = f"{itm.dose_text or ''} {itm.frequency or ''}"  # the helper reads "2x" from it
                if drug_key == "aprepitant":
                    first = re.search(r"\d+(?:\.\d+)?", itm.dose_text or "")
                    if first:
                        entry["single_dose_mg"] = float(first.group(0))
                mock_sched[drug_key] = entry
            if extras:
                mock_sched["_extra"] = extras
            raw_slots = derive_schedule_medications(mock_sched, i18n["time_labels"])
            today_meds = [
                CompanionTodayMedication(time=s["time"], drug=s["drug"], dose_text=s["dose_text"])
                for s in raw_slots
            ]
        else:
            schedule_msg = i18n.get("companion", {}).get("care_team_will_share", "Your care team will share the schedule")

    # 4. H10: Recent logs mapped to CompanionLogOut
    recent_raw = store.list_logs(patient.id, days=7)[:10]
    recent_logs = [
        CompanionLogOut(
            id=l.id,
            severity=l.severity,
            type=l.type,
            note=l.note,
            occurred_at=l.occurred_at or l.timestamp
        )
        for l in recent_raw
    ]

    return CompanionViewResponse(
        patient_alias=patient.alias,
        language=patient.language,
        upcoming_cycle=upcoming_dict,
        passport=passport,
        today=today_meds,
        schedule_message=schedule_msg,
        recent_logs=recent_logs,
        uploads_enabled=config.ENABLE_UPLOADS,
    )

@app.post("/api/companion/{token}/log", response_model=CompanionLogResponse, tags=["companion"])
def create_companion_log(token: str, req: CompanionLogRequest):
    # H10: Validate token FIRST before rate limiting
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "NOT_FOUND", "message": "Invalid or expired companion link"}},
        )

    # Rate limit check (60 writes per token per hour)
    if not store.check_rate_limit(token, max_requests=60, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "RATE_LIMIT_EXCEEDED", "message": "Too many log submissions. Please wait before retrying."}},
        )

    # H3: Append log with feedback loop linking
    entry = NauseaLogEntry(
        patient_id=patient.id,
        severity=req.severity,
        type=req.type or "acute",
        note=req.note,
        client_id=req.client_id,
        occurred_at=req.occurred_at,
    )
    # H3: link to the cycle whose window contains occurred_at (latest cycle starting on/before it)
    log_day = (entry.occurred_at or "")[:10]
    candidates = [c for c in store.cycles_for(patient.id) if c.date and c.date <= log_day and c.status in ("given", "planned")]
    if candidates:
        entry.cycle_id = candidates[-1].id
    saved_entry, deduplicated = store.add_log(entry)
    return CompanionLogResponse(
        entry=CompanionLogOut(
            id=saved_entry.id, severity=saved_entry.severity, type=saved_entry.type,
            note=saved_entry.note, occurred_at=saved_entry.occurred_at,
        ),
        deduplicated=deduplicated,
    )

@app.delete("/api/companion/{token}/log/{entry_id}", tags=["companion"])
def undo_companion_log(token: str, entry_id: str):
    # H10: Validate token first
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "NOT_FOUND", "message": "Invalid or expired companion link"}},
        )

    deleted = store.delete_log(entry_id, patient.id)
    if not deleted:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "CANNOT_UNDO", "message": "Entry not found or 10-minute undo window expired"}},
        )
    return {"status": "deleted", "entry_id": entry_id}

@app.get("/api/companion/{token}/logs", tags=["companion"])
def get_companion_logs(token: str, days: Optional[int] = Query(default=7, ge=1, le=30)):
    # H10: Validate token first and bound days 1-30
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "NOT_FOUND", "message": "Invalid or expired companion link"}},
        )
    raw_logs = store.list_logs(patient.id, days=days)
    out_logs = [
        CompanionLogOut(
            id=l.id,
            severity=l.severity,
            type=l.type,
            note=l.note,
            occurred_at=l.occurred_at or l.timestamp
        )
        for l in raw_logs
    ]
    return {"logs": out_logs}

@app.post("/api/companion/{token}/photo", tags=["companion"])
async def upload_companion_photo(token: str, file: UploadFile = File(...)):
    if not config.ENABLE_UPLOADS:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "FEATURE_DISABLED", "message": "Photo uploads are disabled"}},
        )

    # H10: Validate token first
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "NOT_FOUND", "message": "Invalid or expired companion link"}},
        )

    # H10: Limit to 10 photos per patient per hour
    now = datetime.now(timezone.utc).timestamp()
    upload_history = _photo_uploads_per_patient.get(patient.id, [])
    upload_history = [t for t in upload_history if now - t < 3600]
    if len(upload_history) >= 10:
        raise HTTPException(
            status_code=429,
            detail={"error": {"code": "RATE_LIMIT_EXCEEDED", "message": "Photo upload hourly limit (10/hr) reached"}},
        )
    upload_history.append(now)
    _photo_uploads_per_patient[patient.id] = upload_history

    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail={"error": {"code": "PAYLOAD_TOO_LARGE", "message": "File exceeds maximum 8 MB limit"}},
        )

    try:
        img = Image.open(io.BytesIO(content))
        img.verify()
        img = Image.open(io.BytesIO(content))
        if img.format not in ("JPEG", "PNG", "WEBP", "MPO"):
            raise ValueError(f"Unsupported format: {img.format}")
    except Exception:
        raise HTTPException(
            status_code=415,
            detail={"error": {"code": "UNSUPPORTED_MEDIA_TYPE", "message": "Invalid image file"}},
        )

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    upload_id = f"up-{uuid4().hex[:12]}"
    dest_path = os.path.join(UPLOADS_DIR, f"{upload_id}.jpg")

    img_rgb = img.convert("RGB")
    img_rgb.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
    img_rgb.save(dest_path, "JPEG", quality=85, optimize=True)

    return {"status": "uploaded", "id": upload_id, "upload_id": upload_id, "patient_id": patient.id}

# --- Clinician Endpoints (Protected by X-API-Key) ---

@app.post("/api/patients/{patient_id}/companion-token", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def create_companion_token(patient_id: str):
    p = store.get_patient(patient_id)
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    token = store.generate_companion_token(patient_id)
    url = f"{config.PUBLIC_BASE_URL}/m/{token}"
    return {"token": token, "url": url}

@app.get("/api/patients/{patient_id}/companion-link", response_model=CompanionLinkResponse, tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_companion_link(patient_id: str):
    p = store.get_patient(patient_id)
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")

    token = p.companion_token
    if not token:
        token = store.generate_companion_token(patient_id)

    url = f"{config.PUBLIC_BASE_URL}/m/{token}"
    qr = segno.make(url)
    qr_svg = qr.svg_inline(scale=4)

    return CompanionLinkResponse(token=token, url=url, qr_svg=qr_svg)

@app.get("/api/patients/{patient_id}/passport", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_patient_passport(patient_id: str, lang: Optional[str] = Query(default=None)):
    p = store.get_patient(patient_id)
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")

    target_lang = (lang or p.language or "NL").upper()
    i18n = PASSPORT_I18N.get(target_lang, PASSPORT_I18N["NL"])
    filtered_resources = [r for r in ALL_FAMILY_RESOURCES if r.get("language") == target_lang]

    return {
        "patient_id": p.id,
        "patient_alias": p.alias,
        "language": target_lang,
        "hospital": i18n["hospital"],
        "emergency_contact": i18n["contact_info"],
        "time_labels": i18n["time_labels"],
        "red_flag_title": i18n["red_flag_title"],
        "red_flag_symptoms": i18n["red_flags"],
        "belgian_family_resources": filtered_resources,
    }

@app.get("/api/patients", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def list_patients():
    return store.list_patients()

@app.get("/api/patients/{patient_id}", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_patient_detail(patient_id: str):
    p = store.get_patient(patient_id)
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    cycles = store.cycles_for(patient_id)
    logs = store.list_logs(patient_id)
    return {
        "patient": p,
        "cycles": cycles,
        "logs": logs,
    }

@app.post("/api/patients", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def create_patient(patient: Patient):
    try:
        return store.add_patient(patient)
    except store.DuplicateIdError as e:
        raise HTTPException(status_code=409, detail=str(e))

@app.put("/api/patients/{patient_id}", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def edit_patient(patient_id: str, updates: PatientUpdate):
    update_dict = updates.model_dump(exclude_unset=True)
    updated = store.update_patient(patient_id, update_dict)
    if not updated:
        raise HTTPException(status_code=404, detail="Patient not found")
    return updated

@app.post("/api/patients/{patient_id}/cycles", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def add_patient_cycle(patient_id: str, cycle: Cycle):
    p = store.get_patient(patient_id)
    if not p:
        raise HTTPException(status_code=404, detail="Patient not found")
    cycle.patient_id = patient_id
    try:
        return store.add_cycle(cycle)
    except store.DuplicateIdError as e:
        raise HTTPException(status_code=409, detail=str(e))

@app.patch("/api/cycles/{cycle_id}", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def patch_cycle(cycle_id: str, req: PatchCycleRequest):
    update_dict = req.model_dump(exclude_unset=True)
    updated = store.update_cycle(cycle_id, update_dict)
    if not updated:
        raise HTTPException(status_code=404, detail="Cycle not found")
    return updated

# H2: Clinician Plan Approval Endpoint
@app.post("/api/cycles/{cycle_id}/approve-plan", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def approve_cycle_plan(cycle_id: str, approved_by_alias: Optional[str] = Query(default="Supervising Oncologist")):
    cycle = store.get_cycle(cycle_id)
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    patient = store.get_patient(cycle.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    payload, _ = store.derive_evaluation_payload(patient.id, cycle.id, {})
    result = cinv_graph.invoke(payload)

    sched = result.get("schedule", {})
    items = []
    if "ondansetron" in sched:
        ond = sched["ondansetron"]
        items.append({
            "drug": "Ondansetron",
            "dose_mg": ond.get("dose_mg"),
            "dose_text": f"{ond.get('dose_mg')} mg ({ond.get('route', 'IV/PO')})",
            "route": ond.get("route"),
            "frequency": ond.get("frequency"),
            "timing": ond.get("timing"),
        })
    if "dexamethasone" in sched and sched["dexamethasone"].get("status") == "RECOMMENDED":
        dex = sched["dexamethasone"]
        items.append({
            "drug": "Dexamethasone",
            "dose_text": f"{dex.get('dose')} ({dex.get('route', 'IV/PO')})",
            "route": dex.get("route"),
            "frequency": "2x/d" if "2x" in str(dex.get("dose", "")) else "1x/d",
            "timing": "bij maaltijd",
        })
    if "aprepitant" in sched and sched["aprepitant"].get("status") == "RECOMMENDED":
        aprep = sched["aprepitant"]
        items.append({
            "drug": "(Fos)Aprepitant",
            "dose_text": str(aprep.get("schedule")),
            "route": aprep.get("route"),
            "frequency": "1x/d",
            "timing": "1 uur voor chemo",
        })
    if "olanzapine" in sched and sched["olanzapine"].get("status") == "RECOMMENDED":
        olanz = sched["olanzapine"]
        items.append({
            "drug": "Olanzapine",
            "dose_mg": olanz.get("dose_mg"),
            "dose_text": f"{olanz.get('dose_mg')} mg ({olanz.get('route', 'PO')})",
            "route": olanz.get("route"),
            "frequency": "1x/d",
            "timing": "'s avonds",
        })

    plan_snapshot = {
        "effective_tier": result.get("effective_tier") or result.get("overall_tier"),
        "items": items,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "approved": True,
        "approved_by_alias": approved_by_alias,
    }
    updated = store.update_cycle(cycle_id, {"plan_snapshot": plan_snapshot, "tier_assigned": plan_snapshot["effective_tier"]})
    return {"status": "plan_approved", "cycle": updated}

@app.post("/api/tracker/log", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def log_tracker_event(entry: NauseaLogEntry):
    saved, deduplicated = store.add_log(entry)
    return {"status": "logged", "entry": saved, "deduplicated": deduplicated}

@app.get("/api/tracker/logs", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_tracker_logs(patient_id: Optional[str] = Query(default=None)):
    return {"logs": store.list_logs(patient_id)}

@app.get("/api/calendar/events", tags=["clinician"])
def get_calendar_events():
    patients = store.list_patients()
    pmap = {p.id: p for p in patients}
    cycles = store.list_cycles()

    events = []
    for c in cycles:
        p = pmap.get(c.patient_id)
        if not p:
            continue
        reg_drugs = [r.drug.capitalize() for r in c.regimen]
        events.append({
            "date": c.date or "",
            "cycle_id": c.id,
            "cycle_label": c.label,
            "course_type": c.course_type,
            "status": c.status,
            "patient_id": p.id,
            "patient_alias": p.alias,
            "protocol": p.protocol,
            "diagnosis": p.diagnosis_text,
            "regimen_summary": ", ".join(reg_drugs) if reg_drugs else "Standard",
            "is_multiday": c.is_multiday,
            "tier": c.tier_assigned or ("HIGH" if c.course_type in ["B", "IE"] else "MODERATE")
        })
    events.sort(key=lambda e: (e["date"], e["patient_alias"]))
    return {"events": events, "default_date": "2026-09-25"}

@app.get("/api/cases", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_benchmark_cases():
    patients = store.list_patients()
    cases = []
    for p in patients:
        cycles = store.cycles_for(p.id)
        planned = next((c for c in cycles if c.status == "planned"), cycles[-1] if cycles else None)
        drugs = [r.drug for r in planned.regimen] if planned else []
        doses = {r.drug.lower(): r.dose_mg_m2 for r in planned.regimen if r.dose_mg_m2 is not None} if planned else {}
        cases.append({
            "id": p.id,
            "patient_id": p.id,
            "cycle_id": planned.id if planned else None,
            "title": f"{p.alias} — {p.protocol} ({planned.label if planned else 'Cycle'})",
            "patient_alias": p.alias,
            "age_years": p.age_years,
            "weight_kg": p.weight_kg,
            "height_cm": p.height_cm,
            "bsa_m2": p.bsa_m2,
            "diagnosis": p.diagnosis_text,
            "diagnosis_category": p.diagnosis_category,
            "protocol_name": planned.label if planned else p.protocol,
            "drugs": drugs,
            "doses_mg_m2": doses,
            "is_multiday": planned.is_multiday if planned else False,
            "clinical_background": f"Protocol: {p.protocol}. Patient has {len(cycles)} total documented cycles.",
        })
    return cases

@app.post("/api/evaluate", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def evaluate_cinv(req: EvaluateRequest, save: Optional[bool] = False, llm_rationale: Optional[bool] = True):
    req_data = req.model_dump(exclude_unset=True)
    patient_id = req.patient_id
    cycle_id = req.cycle_id

    # H7: Ownership and existence verification
    if patient_id and not store.get_patient(patient_id):
        raise HTTPException(status_code=404, detail=f"Patient '{patient_id}' not found")
    if cycle_id:
        cycle = store.get_cycle(cycle_id)
        if not cycle:
            raise HTTPException(status_code=404, detail=f"Cycle '{cycle_id}' not found")
        if patient_id and cycle.patient_id != patient_id:
            raise HTTPException(
                status_code=422,
                detail={"error": {"code": "CYCLE_MISMATCH", "message": f"Cycle {cycle_id} does not belong to patient {patient_id}"}}
            )

    # Derivation
    payload, derived_from = store.derive_evaluation_payload(patient_id, cycle_id, req_data)

    # H8: Check for missing fields
    if payload.get("_missing_fields"):
        raise HTTPException(
            status_code=422,
            detail={"error": {"code": "MISSING_FIELDS", "missing_fields": payload["_missing_fields"]}}
        )

    # llm_rationale=false: views that do not show the rationale skip the Gemini call and get the plan at once
    result = cinv_graph.invoke({**payload, "skip_llm_rationale": not llm_rationale})
    result["derived_from"] = derived_from

    if cycle_id:
        cycle = store.get_cycle(cycle_id)
        if cycle and (cycle.status == "given" or save):
            store.update_cycle(cycle_id, {"tier_assigned": result.get("overall_tier")})

    return result

@app.post("/api/parse-note", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def parse_note(req: NoteParseRequest):
    extracted = parse_clinical_progress_note(req.note_text)
    if req.apply and req.cycle_id:
        if req.confirmed_outcome:
            outcome = req.confirmed_outcome.model_dump()
        else:
            outcome = {
                "nausea": extracted.get("had_prior_nausea", False),
                "vomiting": extracted.get("had_prior_vomiting", False),
                "note": req.user_note or "Progress note extraction confirmed",
                "source": "toernota",
            }
        store.update_cycle(req.cycle_id, {"outcome": outcome})
        extracted["applied_to_cycle"] = req.cycle_id
    return extracted

@app.post("/api/parse-note-image", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
async def parse_note_image(file: UploadFile = File(...)):
    """H4: Real vision extractor or 501 when USE_LLM=false."""
    content = await file.read()
    try:
        img = Image.open(io.BytesIO(content))
        img.verify()
        img = Image.open(io.BytesIO(content))
        if img.format not in ("JPEG", "PNG", "WEBP", "MPO"):
            raise ValueError(f"Unsupported format: {img.format}")
    except Exception:
        raise HTTPException(
            status_code=415,
            detail={"error": {"code": "UNSUPPORTED_MEDIA_TYPE", "message": "Invalid image file"}},
        )

    if not USE_LLM:
        raise HTTPException(
            status_code=501,
            detail={"error": {"code": "NOT_IMPLEMENTED", "message": "Vision processing requires USE_LLM=true"}},
        )

    mime = file.content_type or "image/jpeg"
    return parse_clinical_progress_note_image(content, mime)

@app.post("/api/watchouts", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def narrate_watchouts(req: WatchoutsRequest):
    """Gemini handover text for the "Rescue and watch-outs" box. Empty items mean: show the deterministic list."""
    patient = store.get_patient(req.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail=f"Patient '{req.patient_id}' not found")
    pronoun = {"F": "she/her", "M": "he/him"}.get(patient.sex or "", "they/them or 'the patient'")
    context = {
        "age_years": patient.age_years,
        "weight_kg": patient.weight_kg,
        "diagnosis": patient.diagnosis_text,
        "family_language": patient.language,
        "swallow": patient.swallow,
        "pronoun_hint": pronoun,
    }
    items, status_ = generate_watchouts(context, [f.model_dump() for f in req.facts])
    return {"items": items, "llm_status": status_, "model": config.GEMINI_MODEL}

@app.get("/api/uploads/{upload_id}", tags=["clinician"], dependencies=[Depends(verify_clinician_api_key)])
def get_uploaded_file(upload_id: str):
    # H10: Regex check for upload id
    if not re.match(r"^up-[0-9a-f]{12}$", upload_id):
        raise HTTPException(status_code=400, detail="Invalid upload ID format")

    file_path = os.path.join(UPLOADS_DIR, f"{upload_id}.jpg")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Upload not found")
    return FileResponse(file_path, media_type="image/jpeg")

# --- Admin Endpoints ---

@app.post("/api/admin/reset", tags=["admin"], dependencies=[Depends(verify_clinician_api_key), Depends(verify_admin_key)])
def reset_database():
    if not config.ENABLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admin reset is disabled in this environment")
    store.reset_to_seed()
    return {"status": "reset_successful", "message": "Runtime database restored from seed data"}

# --- H6: Unmatched API 404 handler ---

@app.api_route("/api/{unmatched:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def unmatched_api(unmatched: str):
    return JSONResponse(
        status_code=404,
        content={"error": {"code": "NOT_FOUND", "message": f"API endpoint '/api/{unmatched}' not found"}}
    )

# --- H6: Single Origin Static & SPA Routing ---

@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa_or_static(full_path: str):
    dist_dir = config.FRONTEND_DIST
    if not os.path.exists(dist_dir):
        raise HTTPException(status_code=404, detail="Frontend static directory not found")

    target_file = os.path.abspath(os.path.join(dist_dir, full_path))
    # H6: Prevent directory traversal
    try:
        common = os.path.commonpath([dist_dir, target_file])
        if common != dist_dir:
            raise HTTPException(status_code=403, detail="Forbidden")
    except ValueError:
        raise HTTPException(status_code=403, detail="Forbidden")

    if full_path and os.path.isfile(target_file):
        return FileResponse(target_file)

    index_file = os.path.join(dist_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file, headers={"Cache-Control": "no-cache"})

    raise HTTPException(status_code=404, detail="Page not found")
