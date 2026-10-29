"""LangGraph Clinical Decision Support Graph for AImesis.
Strictly implements SPEC-backend-fixes.md, SPEC-storage-model.md, SPEC-backend-fixes-2.md, and SPEC-backend-fixes-3.md.
"""

import os
import json
from typing import TypedDict, List, Dict, Optional, Any
from langgraph.graph import StateGraph, START, END

from app.engine.rules import (
    TIER_HIGH, TIER_MODERATE, TIER_LOW, TIER_MINIMAL, TIER_UNKNOWN, TIER_UNDETERMINED, TIER_ORDER,
    resolve_drug,
    POLICY,
    evaluate_single_drug_tier,
    check_combination_escalations,
    evaluate_contraindications,
    calculate_antiemetic_doses,
    derive_schedule_medications,
)
from app.engine.gemini import generate_clinical_rationale, build_deterministic_rationale

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")

def load_family_resources() -> List[dict]:
    with open(os.path.join(DATA_DIR, "family_resources.json"), "r", encoding="utf-8") as f:
        return json.load(f)

def load_passport_i18n() -> dict:
    with open(os.path.join(DATA_DIR, "passport_i18n.json"), "r", encoding="utf-8") as f:
        return json.load(f)

def load_interactions() -> List[dict]:
    with open(os.path.join(DATA_DIR, "interactions.json"), "r", encoding="utf-8") as f:
        return json.load(f)

ALL_FAMILY_RESOURCES = load_family_resources()
PASSPORT_I18N = load_passport_i18n()
INTERACTION_RULES = load_interactions()

class CINVState(TypedDict, total=False):
    patient_alias: str
    age_years: float
    weight_kg: float
    bsa_m2: float
    height_cm: Optional[float]
    diagnosis: str
    diagnosis_category: Optional[str]
    regimen_contains_corticoids: bool
    dinutuximab_beta: bool
    car_t: bool
    protocol_name: str
    drugs: List[str]
    canonical_drugs: List[str]
    doses_mg_m2: Dict[str, float]
    concomitant_meds: List[str]
    previous_prophylaxis: List[dict]
    had_prior_nausea: bool
    anticipatory_symptoms: bool
    is_multiday: bool
    can_swallow_tablets: bool
    formulation_preference: Optional[str]
    target_language: str

    individual_tiers: Dict[str, dict]
    unrecognised_drugs: List[str]
    dose_missing_for: List[str]
    plan_status: str
    manual_review_required: bool
    combination_escalation: Optional[dict]
    base_tier: str
    effective_tier: str
    overall_tier: str
    tier_escalated: bool
    dex_contraindicated: bool
    dex_contraindication_reason: Optional[str]
    dex_soft_warning: Optional[str]
    schedule: Dict[str, Any]
    alternative_drug: Optional[dict]
    under_prophylaxis_warning: Optional[str]
    notes: List[str]
    ddi_alerts: List[dict]
    skip_llm_rationale: bool
    clinical_rationale: str
    llm_status: str
    patient_passport: Dict[str, Any]

def node_classify_risk(state: CINVState) -> Dict[str, Any]:
    """Story 1 & G1, G2, G3: Classify emetogenicity using canonical resolver and provisional tiers."""
    drugs = state.get("drugs", [])
    raw_doses = state.get("doses_mg_m2", {})

    # G2: Normalize dose keys using resolve_drug
    norm_doses = {}
    for k, v in raw_doses.items():
        canonical_k = resolve_drug(k)
        if canonical_k:
            norm_doses[canonical_k] = v

    individual_tiers = {}
    unrecognised = []
    dose_missing_drugs = []
    canonical_list = []
    highest_tier = TIER_MINIMAL
    has_known_drugs = False

    for drug in drugs:
        canonical = resolve_drug(drug)
        if canonical:
            canonical_list.append(canonical)
        dose = norm_doses.get(canonical) if canonical else None

        # Corticosteroids in the regimen are supportive agents: they block dexamethasone (G7)
        # but are not scored for emetogenicity and must not count as unknown drugs.
        if canonical in POLICY.get("corticosteroids", []):
            individual_tiers[drug] = {
                "canonical_name": canonical,
                "tier": "N/A",
                "reason": "Corticosteroid: not scored; blocks dexamethasone prophylaxis",
                "source": "CCLG CINV guideline 2025, Table 4",
                "dose_missing": False,
            }
            continue

        eval_res = evaluate_single_drug_tier(drug, dose)
        drug_tier = eval_res["tier"]
        individual_tiers[drug] = eval_res

        if drug_tier == TIER_UNKNOWN:
            unrecognised.append(drug)
        else:
            has_known_drugs = True
            if eval_res.get("dose_missing"):
                dose_missing_drugs.append(drug)
            if TIER_ORDER.get(drug_tier, 1) > TIER_ORDER.get(highest_tier, 1):
                highest_tier = drug_tier

    # Check combination escalation (G2: canonical matching)
    combo_escalation = None
    combo_res = check_combination_escalations(canonical_list, norm_doses)
    if combo_res:
        combo_tier = combo_res["tier"]
        combo_escalation = combo_res
        if TIER_ORDER.get(combo_tier, 1) > TIER_ORDER.get(highest_tier, 1):
            highest_tier = combo_tier

    # G1: Plan status and overall tier determination
    if unrecognised:
        plan_status = "INCOMPLETE"
        if not has_known_drugs:
            highest_tier = TIER_UNDETERMINED
    else:
        plan_status = "COMPLETE"

    return {
        "canonical_drugs": canonical_list,
        "individual_tiers": individual_tiers,
        "unrecognised_drugs": unrecognised,
        "dose_missing_for": dose_missing_drugs,
        "manual_review_required": len(unrecognised) > 0,
        "plan_status": plan_status,
        "combination_escalation": combo_escalation,
        "base_tier": highest_tier,
        "overall_tier": highest_tier,
        "effective_tier": highest_tier,
    }

def node_check_contraindications(state: CINVState) -> Dict[str, Any]:
    """Story 2 & G7, G8: Check corticosteroid contraindications."""
    diagnosis = state.get("diagnosis", "")
    diag_cat = state.get("diagnosis_category")
    reg_steroids = state.get("regimen_contains_corticoids", False)
    dinu = state.get("dinutuximab_beta", False)
    car = state.get("car_t", False)
    canonical_drugs = state.get("canonical_drugs", [])

    blocked, block_msg, soft_msg, source = evaluate_contraindications(
        diagnosis=diagnosis,
        diagnosis_category=diag_cat,
        regimen_contains_corticoids=reg_steroids,
        dinutuximab_beta=dinu,
        car_t=car,
        canonical_drugs=canonical_drugs,
    )

    return {
        "dex_contraindicated": blocked,
        "dex_contraindication_reason": block_msg,
        "dex_soft_warning": soft_msg,
    }

def node_calculate_dosing(state: CINVState) -> Dict[str, Any]:
    """Story 3 & G1, G4, G5: Calculate antiemetic dosing using effective tier."""
    base_tier = state.get("base_tier", TIER_LOW)
    plan_status = state.get("plan_status", "COMPLETE")
    weight = state.get("weight_kg", 20.0)
    bsa = state.get("bsa_m2", 0.8)
    age = state.get("age_years", 6.0)
    dex_blocked = state.get("dex_contraindicated", False)
    dex_block_msg = state.get("dex_contraindication_reason")
    dex_soft = state.get("dex_soft_warning")
    had_nausea = state.get("had_prior_nausea", False)
    is_multiday = state.get("is_multiday", False)
    can_swallow = state.get("can_swallow_tablets", True)
    form_pref = state.get("formulation_preference")
    prev_prop = state.get("previous_prophylaxis")

    # G1: If all drugs are unknown or plan is incomplete, do NOT present a dosing recommendation
    if plan_status == "INCOMPLETE" and base_tier == TIER_UNDETERMINED:
        return {
            "schedule": {},
            "notes": ["Unknown drug detected: manual review by the hospital pharmacy required."],
            "alternative_drug": None,
            "under_prophylaxis_warning": None,
            "base_tier": TIER_UNDETERMINED,
            "effective_tier": TIER_UNDETERMINED,
            "overall_tier": TIER_UNDETERMINED,
            "tier_escalated": False,
        }

    schedule, notes, alt_drug, under_warn, eff_tier = calculate_antiemetic_doses(
        tier=base_tier,
        weight_kg=weight,
        bsa_m2=bsa,
        age_years=age,
        dex_hard_blocked=dex_blocked,
        dex_block_message=dex_block_msg,
        dex_soft_warning=dex_soft,
        had_prior_nausea=had_nausea,
        is_multiday=is_multiday,
        can_swallow_tablets=can_swallow,
        formulation_preference=form_pref,
        previous_prophylaxis=prev_prop,
    )

    if plan_status == "INCOMPLETE":
        # G1: Do not present dosing schedule as recommendation if any drug is unknown
        schedule = {}
        notes.insert(0, "Regimen contains an unclassified drug: prophylaxis is provisional until manual validation.")

    return {
        "schedule": schedule,
        "notes": notes,
        "alternative_drug": alt_drug,
        "under_prophylaxis_warning": under_warn,
        "base_tier": base_tier,
        "effective_tier": eff_tier,
        "overall_tier": eff_tier,
        "tier_escalated": (eff_tier != base_tier),
    }

def node_screen_interactions(state: CINVState) -> Dict[str, Any]:
    """Screen interactions using canonical resolver and policy * triggers."""
    raw_concomitant = state.get("concomitant_meds", [])
    concomitant = [resolve_drug(m) or m.strip().lower() for m in raw_concomitant]
    canonical_regimen = state.get("canonical_drugs", [])
    schedule = state.get("schedule", {})

    antiemetics = []
    if "ondansetron" in schedule: antiemetics.append("ondansetron")
    if "aprepitant" in schedule and schedule["aprepitant"].get("status") == "RECOMMENDED": antiemetics.append("aprepitant")

    combined_drugs = set(canonical_regimen + antiemetics)
    fired_alerts = []

    for rule in INTERACTION_RULES:
        drug_match = any(td in combined_drugs for td in rule["trigger_drugs"])
        if not drug_match:
            continue

        if "*" in rule["concomitant_triggers"]:
            # Policy-sourced rule fires whenever trigger drug is in plan
            fired_alerts.append({
                "id": rule["id"],
                "level": rule["level"],
                "message": rule["message"],
                "source": rule["source"],
                "verified": rule["verified"]
            })
        elif concomitant:
            concom_match = any(
                ct in concomitant or any(ct in c for c in concomitant)
                for ct in rule["concomitant_triggers"]
            )
            if concom_match:
                fired_alerts.append({
                    "id": rule["id"],
                    "level": rule["level"],
                    "message": rule["message"],
                    "source": rule["source"],
                    "verified": rule["verified"]
                })

    return {"ddi_alerts": fired_alerts}

def node_generate_passport_and_summary(state: CINVState) -> Dict[str, Any]:
    """Story 4 & G10: Localized passport generation from passport_i18n.json."""
    lang = state.get("target_language", "NL").upper()
    if lang not in ["NL", "FR", "EN"]:
        lang = "NL"

    i18n = PASSPORT_I18N.get(lang, PASSPORT_I18N["NL"])
    schedule = state.get("schedule", {})
    eff_tier = state.get("effective_tier", TIER_LOW)

    filtered_resources = [
        {"title": r["title"], "url": r["url"], "format": r["format"], "institute": r["institute"]}
        for r in ALL_FAMILY_RESOURCES if r.get("language") == lang
    ]
    if not filtered_resources:
        filtered_resources = [
            {"title": r["title"], "url": r["url"], "format": r["format"], "institute": r["institute"]}
            for r in ALL_FAMILY_RESOURCES if r.get("language") in ["NL", "EN"]
        ][:4]

    # Use shared H2 helper to build slot medications strictly in mg
    time_labels = i18n["time_labels"]
    slot_meds = derive_schedule_medications(schedule, time_labels)

    morning_items = [f"{m['drug']} {m['dose_text']}" for m in slot_meds if m["time"] == time_labels.get("morning")]
    afternoon_items = [f"{m['drug']} {m['dose_text']}" for m in slot_meds if m["time"] == time_labels.get("afternoon")]
    evening_items = [f"{m['drug']} {m['dose_text']}" for m in slot_meds if m["time"] == time_labels.get("evening")]

    empty = i18n.get("empty_slots", {
        "morning": "Geen ochtendmedicatie",
        "afternoon": "Geen middagmedicatie",
        "evening": "Geen avondmedicatie"
    })

    passport = {
        "patient_alias": state.get("patient_alias", "Patient"),
        "emetogenicity_tier": eff_tier,
        "dexamethasone_blocked": state.get("dex_contraindicated", False),
        "hospital": i18n["hospital"],
        "emergency_contact": i18n["contact_info"],
        "time_labels": time_labels,
        "schedule_summary": {
            "morning": " + ".join(morning_items) if morning_items else empty["morning"],
            "afternoon": " + ".join(afternoon_items) if afternoon_items else empty["afternoon"],
            "evening": " + ".join(evening_items) if evening_items else empty["evening"],
        },
        "red_flag_title": i18n["red_flag_title"],
        "red_flag_symptoms": i18n["red_flags"],
        "belgian_family_resources": filtered_resources,
    }

    patient_summary = {
        "patient_alias": state.get("patient_alias"),
        "age_years": state.get("age_years"),
        "weight_kg": state.get("weight_kg"),
        "bsa_m2": state.get("bsa_m2"),
        "diagnosis": state.get("diagnosis"),
        "drugs": state.get("drugs"),
        "base_tier": state.get("base_tier"),
        "effective_tier": eff_tier,
        "overall_tier": eff_tier,
        "combination_escalation": state.get("combination_escalation"),
        "dex_contraindicated": state.get("dex_contraindicated"),
        "dex_contraindication_reason": state.get("dex_contraindication_reason"),
        "dex_soft_warning": state.get("dex_soft_warning"),
        "under_prophylaxis_warning": state.get("under_prophylaxis_warning"),
    }
    warnings = [a["message"] for a in state.get("ddi_alerts", [])]
    if state.get("skip_llm_rationale"):
        rationale, llm_status = build_deterministic_rationale(patient_summary, schedule, warnings), "skipped"
    else:
        rationale, llm_status = generate_clinical_rationale(patient_summary, schedule, warnings)

    return {
        "clinical_rationale": rationale,
        "llm_status": llm_status,
        "patient_passport": passport,
    }

def build_cinv_cds_graph():
    workflow = StateGraph(CINVState)

    workflow.add_node("classify_risk", node_classify_risk)
    workflow.add_node("check_contraindications", node_check_contraindications)
    workflow.add_node("calculate_dosing", node_calculate_dosing)
    workflow.add_node("screen_interactions", node_screen_interactions)
    workflow.add_node("generate_passport", node_generate_passport_and_summary)

    workflow.add_edge(START, "classify_risk")
    workflow.add_edge("classify_risk", "check_contraindications")
    workflow.add_edge("check_contraindications", "calculate_dosing")
    workflow.add_edge("calculate_dosing", "screen_interactions")
    workflow.add_edge("screen_interactions", "generate_passport")
    workflow.add_edge("generate_passport", END)

    return workflow.compile()

cinv_graph = build_cinv_cds_graph()
