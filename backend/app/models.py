"""Pydantic data models for AImesis storage layer and API validation.
Implements H2, H7, H9, H10, G9.
"""

import math
from typing import List, Dict, Optional, Literal
from uuid import uuid4
from datetime import datetime, timezone
from pydantic import BaseModel, Field, field_validator, model_validator

def compute_mosteller_bsa(weight_kg: float, height_cm: float) -> float:
    return round(math.sqrt((weight_kg * height_cm) / 3600.0), 2)

class Patient(BaseModel):
    id: str = Field(default_factory=lambda: f"pt-{uuid4().hex[:8]}", description="Short unique slug, e.g. pt-emma")
    alias: str = Field(description="De-identified patient alias only, e.g. Emma (16y)")
    sex: Optional[Literal["F", "M"]] = None
    age_years: float = Field(ge=0.0, le=30.0)
    diagnosis_text: str = Field(description="Clinical diagnosis narrative")
    diagnosis_category: Literal["ALL", "AML", "BRAIN_TUMOR", "OTHER"] = "OTHER"
    protocol: str = Field(description="Protocol name, e.g. HR-NBL2, ALLTogether1")
    weight_kg: Optional[float] = Field(default=None, ge=1.0, le=200.0)
    height_cm: Optional[float] = Field(default=None, ge=30.0, le=250.0)
    bsa_m2: Optional[float] = Field(default=None, ge=0.1, le=3.0)
    flags: Dict[str, bool] = Field(default_factory=dict, description="dinutuximab_beta, car_t, etc.")
    language: Literal["NL", "FR", "EN"] = "NL"
    swallow: Literal["tablets", "liquid_only", "ng_tube", "iv_only"] = "tablets"
    companion_token: Optional[str] = Field(default=None, description="Secret per-patient companion link token")
    fictional_fields: List[str] = Field(default_factory=list, description="Fields not from source docx")

    @model_validator(mode="after")
    def compute_bsa_if_missing(self):
        if (self.bsa_m2 is None or self.bsa_m2 <= 0) and self.weight_kg and self.height_cm:
            self.bsa_m2 = compute_mosteller_bsa(self.weight_kg, self.height_cm)
        return self

class PatientUpdate(BaseModel):
    """H7/H5: Partial updates only. Forbids id and companion_token modification."""
    alias: Optional[str] = None
    sex: Optional[Literal["F", "M"]] = None
    age_years: Optional[float] = Field(default=None, ge=0.0, le=30.0)
    diagnosis_text: Optional[str] = None
    diagnosis_category: Optional[Literal["ALL", "AML", "BRAIN_TUMOR", "OTHER"]] = None
    protocol: Optional[str] = None
    weight_kg: Optional[float] = Field(default=None, ge=1.0, le=200.0)
    height_cm: Optional[float] = Field(default=None, ge=30.0, le=250.0)
    bsa_m2: Optional[float] = Field(default=None, ge=0.1, le=3.0)
    flags: Optional[Dict[str, bool]] = None
    language: Optional[Literal["NL", "FR", "EN"]] = None
    swallow: Optional[Literal["tablets", "liquid_only", "ng_tube", "iv_only"]] = None
    fictional_fields: Optional[List[str]] = None

class CycleRegimenItem(BaseModel):
    drug: str
    dose_mg_m2: Optional[float] = Field(default=None, gt=0.0)
    days: Optional[List[int]] = None

class CycleProphylaxisItem(BaseModel):
    drug: str
    frequency: Optional[str] = None
    note: Optional[str] = None

class CycleOutcome(BaseModel):
    nausea: bool = False
    vomiting: bool = False
    first_day: Optional[int] = None
    note: Optional[str] = None
    source: Optional[str] = None

class PlanSnapshotItem(BaseModel):
    drug: str
    dose_mg: Optional[float] = None
    dose_text: Optional[str] = None
    route: Optional[str] = None
    frequency: Optional[str] = None
    timing: Optional[str] = None
    days: Optional[List[int]] = None

class PlanSnapshot(BaseModel):
    effective_tier: str
    items: List[PlanSnapshotItem] = Field(default_factory=list)
    evaluated_at: str
    approved: bool = False
    approved_by_alias: Optional[str] = None

class Cycle(BaseModel):
    id: str = Field(default_factory=lambda: f"cy-{uuid4().hex[:8]}", description="Short unique slug, e.g. cy-emma-b4")
    patient_id: str
    date: Optional[str] = None  # "YYYY-MM-DD" or null
    label: str = Field(description="Cycle label, e.g. B4, IE3, Induction B D8")
    course_type: str = Field(description="e.g. A, B, C, IE, VDC, Induction B")
    sequence: Optional[int] = Field(default=None, description="Explicit ordering sequence (H9)")
    status: Literal["planned", "given"] = "planned"
    regimen: List[CycleRegimenItem] = Field(default_factory=list)
    is_multiday: bool = False
    regimen_contains_corticoids: bool = False
    tier_assigned: Optional[str] = None
    prophylaxis_given: List[CycleProphylaxisItem] = Field(default_factory=list)
    outcome: Optional[CycleOutcome] = None
    plan_snapshot: Optional[PlanSnapshot] = None
    fictional_fields: List[str] = Field(default_factory=list)

class PatchCycleRequest(BaseModel):
    """H7: Restricted cycle patch fields."""
    status: Optional[Literal["planned", "given"]] = None
    outcome: Optional[CycleOutcome] = None
    tier_assigned: Optional[str] = None
    prophylaxis_given: Optional[List[CycleProphylaxisItem]] = None
    plan_snapshot: Optional[PlanSnapshot] = None

class NauseaLogEntry(BaseModel):
    id: str = Field(default_factory=lambda: f"log-{uuid4().hex[:8]}")
    patient_id: str
    cycle_id: Optional[str] = None
    timestamp: Optional[str] = None
    occurred_at: Optional[str] = None
    received_at: Optional[str] = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    client_id: Optional[str] = None
    severity: int = Field(ge=1, le=5, description="1 (Mild) to 5 (Severe vomiting)")
    type: Literal["acute", "delayed", "anticipatory"] = "acute"
    note: Optional[str] = None

    @model_validator(mode="after")
    def sync_timestamps(self):
        if not self.occurred_at:
            self.occurred_at = self.timestamp or self.received_at
        if not self.timestamp:
            self.timestamp = self.occurred_at or self.received_at
        return self

class CompanionLogRequest(BaseModel):
    severity: int = Field(default=3, ge=1, le=5)
    type: Optional[Literal["acute", "delayed", "anticipatory"]] = None
    note: Optional[str] = None
    client_id: str = Field(description="Client-generated unique ID for tap idempotency")
    occurred_at: Optional[str] = Field(default=None, description="ISO timestamp")

class CompanionLogOut(BaseModel):
    """H10: Privacy-safe companion log view omitting internal IDs."""
    id: str
    severity: int
    type: str
    note: Optional[str] = None
    occurred_at: Optional[str] = None

class CompanionLogResponse(BaseModel):
    entry: CompanionLogOut
    deduplicated: bool = False

class CompanionTodayMedication(BaseModel):
    time: str
    drug: str
    dose_text: str

class CompanionViewResponse(BaseModel):
    patient_alias: str
    language: str
    upcoming_cycle: Optional[dict] = None
    passport: dict
    today: List[CompanionTodayMedication]
    schedule_message: Optional[str] = None
    recent_logs: List[CompanionLogOut]
    uploads_enabled: bool = False

class CompanionLinkResponse(BaseModel):
    token: str
    url: str
    qr_svg: str

class EvaluateRequest(BaseModel):
    """H7/G9: Fully validated CDS evaluation request."""
    patient_id: Optional[str] = Field(default=None, description="Patient slug, e.g. pt-emma")
    cycle_id: Optional[str] = Field(default=None, description="Planned cycle slug, e.g. cy-emma-b4")

    patient_alias: Optional[str] = Field(default=None)
    age_years: Optional[float] = Field(default=None, ge=0.0, le=30.0)
    weight_kg: Optional[float] = Field(default=None, ge=1.0, le=200.0)
    height_cm: Optional[float] = Field(default=None, ge=30.0, le=250.0)
    bsa_m2: Optional[float] = Field(default=None, ge=0.1, le=3.0)
    diagnosis: Optional[str] = Field(default=None)
    diagnosis_category: Optional[Literal["ALL", "AML", "BRAIN_TUMOR", "OTHER"]] = None
    regimen_contains_corticoids: Optional[bool] = Field(default=None)
    dinutuximab_beta: Optional[bool] = Field(default=None)
    car_t: Optional[bool] = Field(default=None)
    protocol_name: Optional[str] = Field(default=None)
    drugs: Optional[List[str]] = Field(default=None)
    doses_mg_m2: Optional[Dict[str, float]] = Field(default=None)
    concomitant_meds: Optional[List[str]] = Field(default_factory=list)
    previous_prophylaxis: Optional[List[dict]] = Field(default=None)
    had_prior_nausea: Optional[bool] = Field(default=None)
    anticipatory_symptoms: Optional[bool] = Field(default=None)
    is_multiday: Optional[bool] = Field(default=None)
    can_swallow_tablets: Optional[bool] = Field(default=None)
    formulation_preference: Optional[Literal["oral_liquid", "oral_tablet", "iv", "ng_tube"]] = None
    target_language: Optional[Literal["NL", "FR", "EN"]] = None

    @field_validator("doses_mg_m2")
    @classmethod
    def validate_doses(cls, v):
        if v:
            for d, val in v.items():
                if val <= 0:
                    raise ValueError(f"Dose for {d} must be > 0")
        return v

class NoteParseRequest(BaseModel):
    note_text: str = Field(description="Unstructured progress note text")
    patient_id: Optional[str] = None
    cycle_id: Optional[str] = None
    apply: Optional[bool] = False
    confirmed_outcome: Optional[CycleOutcome] = None
    user_note: Optional[str] = None

class WatchoutFact(BaseModel):
    """One verified fact the watch-out narrative may use. The LLM may only cite facts by id."""
    id: str = Field(max_length=40)
    kind: Literal["patient", "clinician", "chemo", "engine", "rescue"]
    text: str = Field(max_length=600)
    required: bool = Field(default=False, description="Must be cited by at least one item (rescue doses)")

class WatchoutsRequest(BaseModel):
    patient_id: str
    cycle_id: Optional[str] = None
    facts: List[WatchoutFact] = Field(max_length=60)
