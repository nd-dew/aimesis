"""Standalone patient diary; keeps legacy companion and tracker contracts intact."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
import segno

from app import config, store
from app.models import CompanionLinkResponse, Cycle, Patient

router = APIRouter(tags=['patient-mobile'])
clinician_router = APIRouter(tags=['clinician'])
_LOG_FILE = 'patient_mobile_logs.json'


class Report(BaseModel):
    client_id: str
    occurred_at: datetime


class NauseaReport(Report):
    kind: Literal['nausea']
    severity: Literal[0, 1, 2, 3]


class VomitingReport(Report):
    kind: Literal['vomiting']
    severity: None = None


MobileReport = Annotated[NauseaReport | VomitingReport, Body(discriminator='kind')]


class DiaryEntry(BaseModel):
    id: str
    kind: Literal['nausea', 'vomiting']
    severity: Literal[0, 1, 2, 3] | None
    occurred_at: str
    note: str | None = None


class StoredEntry(DiaryEntry):
    patient_id: str
    client_id: str
    cycle_id: str | None
    received_at: str


class DiaryView(BaseModel):
    patient_alias: str
    language: Literal['NL', 'FR', 'EN']
    recent_logs: list[DiaryEntry]


class SaveResult(BaseModel):
    entry: DiaryEntry
    deduplicated: bool


def _patient(token: str) -> Patient:
    patient = store.get_patient_by_token(token)
    if not patient:
        raise HTTPException(status_code=404, detail={'error': {'code': 'NOT_FOUND', 'message': 'Invalid patient link'}})
    return patient


def _entries() -> list[StoredEntry]:
    return [StoredEntry.model_validate(entry) for entry in store._read_json(_LOG_FILE)]


def _recent(patient_id: str) -> list[StoredEntry]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    with store._lock:
        return sorted(
            [entry for entry in _entries() if entry.patient_id == patient_id and datetime.fromisoformat(entry.occurred_at) >= cutoff],
            key=lambda entry: entry.occurred_at, reverse=True,
        )


def reports_for_cycle(cycle: Cycle, window_end: str | None) -> list[StoredEntry]:
    with store._lock:
        result = []
        for entry in _entries():
            if entry.patient_id != cycle.patient_id:
                continue
            day = entry.occurred_at[:10]
            if entry.cycle_id == cycle.id or (entry.cycle_id is None and cycle.date and day >= cycle.date and (window_end is None or day < window_end)):
                result.append(entry)
        return result


@router.get('/patient/{token}', include_in_schema=False)
def patient_page(token: str):
    return FileResponse(Path(config.FRONTEND_DIST) / 'patient' / 'patient.html', headers={'Cache-Control': 'no-cache'})


@router.get('/api/patient-mobile/{token}', response_model=DiaryView)
def diary_view(token: str):
    patient = _patient(token)
    return DiaryView(patient_alias=patient.alias, language=patient.language, recent_logs=_recent(patient.id))


@router.post('/api/patient-mobile/{token}/log', response_model=SaveResult)
def save_report(token: str, report: MobileReport):
    patient = _patient(token)
    with store._lock:
        entries = _entries()
        existing = next((entry for entry in entries if entry.patient_id == patient.id and entry.client_id == report.client_id), None)
        if existing:
            return SaveResult(entry=existing, deduplicated=True)
        if not store.check_rate_limit(f'patient-mobile:{token}'):
            raise HTTPException(status_code=429, detail={'error': {'code': 'RATE_LIMIT_EXCEEDED', 'message': 'Too many reports'}})
        occurred_at = store.clamp_occurred_at(report.occurred_at.isoformat())
        entry = StoredEntry(
            id=f'pm-{uuid4().hex}', patient_id=patient.id, client_id=report.client_id,
            kind=report.kind, severity=report.severity,
            occurred_at=occurred_at, cycle_id=store.find_cycle_for_timestamp(patient.id, occurred_at),
            received_at=datetime.now(timezone.utc).isoformat(),
        )
        entries.append(entry)
        store._write_json_atomic(_LOG_FILE, [item.model_dump() for item in entries])
        return SaveResult(entry=entry, deduplicated=False)


@router.delete('/api/patient-mobile/{token}/log/{entry_id}')
def undo_report(token: str, entry_id: str):
    patient = _patient(token)
    with store._lock:
        entries = _entries()
        entry = next((item for item in entries if item.patient_id == patient.id and item.id == entry_id), None)
        if not entry:
            raise HTTPException(status_code=404, detail={'error': {'code': 'NOT_FOUND', 'message': 'Report not found'}})
        if datetime.now(timezone.utc) - datetime.fromisoformat(entry.received_at) > timedelta(minutes=10):
            raise HTTPException(status_code=400, detail={'error': {'code': 'UNDO_EXPIRED', 'message': 'Undo window expired'}})
        store._write_json_atomic(_LOG_FILE, [item.model_dump() for item in entries if item.id != entry_id])
    return {'status': 'deleted'}


@clinician_router.get('/api/patients/{patient_id}/patient-mobile-logs', response_model=list[DiaryEntry])
def clinician_diary(patient_id: str):
    if not store.get_patient(patient_id):
        raise HTTPException(status_code=404, detail={'error': {'code': 'NOT_FOUND', 'message': 'Patient not found'}})
    return _recent(patient_id)


@clinician_router.get('/api/patients/{patient_id}/patient-mobile-link', response_model=CompanionLinkResponse)
def patient_mobile_link(patient_id: str):
    patient = store.get_patient(patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail={'error': {'code': 'NOT_FOUND', 'message': 'Patient not found'}})
    token = patient.companion_token or store.generate_companion_token(patient_id)
    url = f'{config.PUBLIC_BASE_URL}/patient/{token}'
    return CompanionLinkResponse(token=token, url=url, qr_svg=segno.make(url).svg_inline(scale=4, omitsize=True))
