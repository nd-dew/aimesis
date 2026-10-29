"""Clinical rule engine for AImesis, based only on published pediatric guidelines:

- POGO classification of acute emetogenicity (Dupuis et al.; quick summary Tables 1-2): risk tiers.
  https://www.pogo.ca/wp-content/uploads/2014/10/POGO-Emetogenicity-Classification-Guideline-Summary-Final-rev-250111.pdf
- POGO Satellite Manual 4.3 Antiemetics (2022): drugs per tier, doses, breakthrough/refractory/anticipatory rules.
  https://www.pogo.ca/wp-content/uploads/2023/01/4.3-Antiemetics.pdf
- CCLG Guideline for the Management of CINV (v3.1, March 2025), Table 4: ondansetron max per dose,
  olanzapine and metoclopramide doses, dexamethasone contraindications.

Demo software, not validated for clinical use.
"""

import os
import json
import re
from typing import Dict, List, Optional, Tuple, Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")

SRC_POGO_DOSES = "POGO Satellite Manual 4.3 (2022)"
SRC_CCLG = "CCLG CINV guideline 2025, Table 4"

def load_policy_data() -> dict:
    path = os.path.join(DATA_DIR, "policy.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

POLICY = load_policy_data()

TIER_HIGH = "High"
TIER_MODERATE = "Moderate"
TIER_LOW = "Low"
TIER_MINIMAL = "Minimal"
TIER_UNKNOWN = "UNKNOWN"
TIER_UNDETERMINED = "UNDETERMINED"

TIER_ORDER = {
    TIER_MINIMAL: 1,
    TIER_LOW: 2,
    TIER_MODERATE: 3,
    TIER_HIGH: 4,
}

def resolve_drug(name: str) -> Optional[str]:
    """Canonical resolver: lowercase, strip strengths/units ('200mg', '5mg/ml'),
    strip brackets/punctuation, and map aliases to canonical drug names.
    """
    if not name:
        return None
    cleaned = name.strip().lower()
    # Strip strengths/units like '200mg', '1.5 mg/m2', '100 mg'
    cleaned = re.sub(r'\b\d+(\.\d+)?\s*(mg|g|mcg|µg)(/(m2|m²|kg|ml|d))?\b', '', cleaned)
    # Strip brackets and extra symbols
    cleaned = re.sub(r'[\(\)\[\]\{\}\®\™]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # Direct canonical lookup or alias lookup
    if cleaned in POLICY.get("aliases", {}):
        return POLICY["aliases"][cleaned]

    # Partial / word cleanup check in aliases
    for alias, canonical in POLICY.get("aliases", {}).items():
        if cleaned == alias or re.search(r'\b' + re.escape(alias) + r'\b', cleaned):
            return canonical

    # Check direct canonical names in tiers
    for tier_data in POLICY["tiers"].values():
        if cleaned in tier_data["drugs"]:
            return cleaned
        for td in tier_data.get("threshold_drugs", []):
            if cleaned == td["name"]:
                return cleaned

    return cleaned if cleaned else None

def evaluate_threshold_condition(dose: float, td: dict) -> bool:
    """Safe evaluation of structured dose thresholds without eval()."""
    min_val = td.get("min")
    max_val = td.get("max")
    min_inc = td.get("min_inclusive", True)
    max_inc = td.get("max_inclusive", False)

    if min_val is not None:
        if min_inc and dose < min_val:
            return False
        if not min_inc and dose <= min_val:
            return False

    if max_val is not None:
        if max_inc and dose > max_val:
            return False
        if not max_inc and dose >= max_val:
            return False

    return True

def evaluate_single_drug_tier(drug: str, dose_mg_m2: Optional[float] = None) -> Dict[str, Any]:
    """Returns the POGO classification of one drug. A dose-dependent drug without a dose
    gets its highest possible tier, marked provisional.
    """
    canonical = resolve_drug(drug)
    if not canonical:
        return {
            "canonical_name": None,
            "tier": TIER_UNKNOWN,
            "reason": f"Drug '{drug}' not found in the POGO classification",
            "source": "POGO classification: not listed",
            "dose_missing": False,
        }

    # 1. Direct drug match across tiers
    for tier_name in ["High", "Moderate", "Low", "Minimal"]:
        tier_data = POLICY["tiers"][tier_name]
        if canonical in tier_data["drugs"]:
            return {
                "canonical_name": canonical,
                "tier": tier_name,
                "reason": f"{canonical.capitalize()} is {tier_data['label']}",
                "source": tier_data["source"],
                "dose_missing": False,
            }

    # 2. Threshold drug match
    threshold_matches = []
    for tier_name in ["High", "Moderate", "Low", "Minimal"]:
        tier_data = POLICY["tiers"][tier_name]
        for td in tier_data.get("threshold_drugs", []):
            if canonical == td["name"]:
                threshold_matches.append((tier_name, td, td.get("source") or tier_data["source"]))

    if threshold_matches:
        if dose_mg_m2 is not None:
            for tier_name, td, source in threshold_matches:
                if evaluate_threshold_condition(dose_mg_m2, td):
                    return {
                        "canonical_name": canonical,
                        "tier": tier_name,
                        "reason": f"{canonical.capitalize()} {dose_mg_m2} mg/m² is {POLICY['tiers'][tier_name]['label']}",
                        "source": source,
                        "dose_missing": False,
                    }
        else:
            # Missing dose for a dose-dependent drug -> highest possible tier as provisional
            possible_tiers = [tm[0] for tm in threshold_matches]
            possible_tiers.sort(key=lambda t: TIER_ORDER.get(t, 1), reverse=True)
            highest_tier = possible_tiers[0]
            highest_source = next(tm[2] for tm in threshold_matches if tm[0] == highest_tier)
            return {
                "canonical_name": canonical,
                "tier": highest_tier,
                "tier_is_provisional": True,
                "dose_missing": True,
                "possible_tiers": possible_tiers,
                "reason": f"{canonical.capitalize()} needs a dose to confirm the tier; provisionally {POLICY['tiers'][highest_tier]['label']}",
                "source": highest_source,
            }

    return {
        "canonical_name": canonical,
        "tier": TIER_UNKNOWN,
        "reason": f"Drug '{canonical}' not found in the POGO classification",
        "source": "POGO classification: not listed",
        "dose_missing": False,
    }

def check_combination_escalations(canonical_drugs: List[str], doses_mg_m2: Optional[Dict[str, float]] = None) -> Optional[Dict[str, Any]]:
    """POGO Table 2: specific combinations that are highly emetogenic as a whole.
    A combination with a dose condition is applied when the dose is in range, or (conservatively) when it is unknown.
    """
    drugs_set = set(canonical_drugs)
    doses = doses_mg_m2 or {}
    anthracyclines = set(POLICY.get("anthracyclines", []))

    for combo in POLICY["combination_escalations"]:
        all_of = set(combo.get("all_of", []))
        if not all_of.issubset(drugs_set):
            continue
        if "any_of" in combo and not any(d in drugs_set for d in combo["any_of"]):
            continue
        if combo.get("group") == "anthracyclines" and not any(d in drugs_set for d in anthracyclines):
            continue

        unknown_dose = []
        out_of_range = False
        for drug, rng in combo.get("dose_ranges", {}).items():
            dose = doses.get(drug)
            if dose is None:
                unknown_dose.append(drug)
            elif not (rng["min"] <= dose <= rng["max"]):
                out_of_range = True
        if out_of_range:
            continue

        reason = f"Combination {' + '.join(sorted(all_of | ({'anthracycline'} if combo.get('group') else set())))} is highly emetogenic as a whole"
        if unknown_dose:
            reason += f" (dose of {', '.join(unknown_dose)} not given: applied conservatively)"
        return {
            "tier": combo["escalate_to"],
            "reason": reason,
            "source": combo["source"],
        }

    return None

def check_corticoids_in_regimen(canonical_drugs: List[str]) -> bool:
    """Detects if corticosteroids are already present in the chemotherapy regimen."""
    corticosteroids = set(POLICY.get("corticosteroids", []))
    return any(d in corticosteroids for d in canonical_drugs)

def evaluate_contraindications(
    diagnosis: str,
    diagnosis_category: Optional[str] = None,
    regimen_contains_corticoids: bool = False,
    dinutuximab_beta: bool = False,
    car_t: bool = False,
    canonical_drugs: Optional[List[str]] = None,
) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
    """Dexamethasone contraindications per CCLG 2025 Table 4: brain tumour patients, steroids in the
    chemotherapy regimen, mifamurtide; caution in osteosarcoma. (dinutuximab_beta / car_t are kept in the
    signature for API compatibility; they are not part of the published rules used here.)
    Returns (is_hard_blocked, block_message, soft_warning_message, source).
    """
    diag_clean = (diagnosis or "").strip().lower()
    drugs = canonical_drugs or []

    # 1. Steroids already in the chemotherapy regimen
    reg_has_steroids = regimen_contains_corticoids or check_corticoids_in_regimen(drugs)
    if reg_has_steroids or any(k in diag_clean for k in ["corticoid", "prednisolone", "prednison"]):
        return True, "No dexamethasone: the chemotherapy regimen already contains steroids", None, SRC_CCLG

    # 2. Mifamurtide
    if "mifamurtide" in drugs or "mifamurtide" in diag_clean:
        return True, "No dexamethasone: patient receives mifamurtide", None, SRC_CCLG

    # 3. Brain tumours
    brain_keywords = ["brain", "hersen", "hersentumor", "hersentumoren", "medulloblastoma", "medulloblastoom", "glioma", "glioblastoma", "astrocytoma", "ependymoma", "dipg", "atrt"]
    if diagnosis_category == "BRAIN_TUMOR" or any(re.search(r'\b' + re.escape(w) + r'\b', diag_clean) for w in brain_keywords):
        return True, "No dexamethasone: brain tumour patient", None, SRC_CCLG

    # 4. Caution: osteosarcoma
    if "osteosarc" in diag_clean:
        return False, None, "Caution with dexamethasone in osteosarcoma: discuss with the consultant", SRC_CCLG

    return False, None, None, None

def _round_to(x: float, step: float) -> float:
    return round(round(x / step) * step, 2)

def calculate_antiemetic_doses(
    tier: str,
    weight_kg: float,
    bsa_m2: float,
    age_years: float,
    dex_hard_blocked: bool,
    dex_block_message: Optional[str] = None,
    dex_soft_warning: Optional[str] = None,
    had_prior_nausea: bool = False,
    is_multiday: bool = False,
    can_swallow_tablets: bool = True,
    formulation_preference: Optional[str] = None,
    previous_prophylaxis: Optional[List[dict]] = None,
) -> Tuple[Dict[str, Any], List[str], Optional[dict], Optional[str], str]:
    """Acute-phase prophylaxis per the POGO Satellite Manual 4.3, with breakthrough step-up.
    Returns (schedule, notes, alternative_drug, under_prophylaxis_warning, effective_tier).
    """
    schedule: Dict[str, Any] = {}
    notes: List[str] = []
    alternative_drug: Optional[dict] = None
    under_prophylaxis_warning: Optional[str] = None

    # Breakthrough in the previous block: minimal/low/moderate -> prophylaxis of the next higher tier;
    # highly emetogenic -> add olanzapine (POGO Satellite Manual 4.3, breakthrough and refractory CINV)
    base_tier = tier
    effective_tier = tier
    if had_prior_nausea:
        step_up = {TIER_MINIMAL: TIER_LOW, TIER_LOW: TIER_MODERATE, TIER_MODERATE: TIER_HIGH}
        if base_tier in step_up:
            effective_tier = step_up[base_tier]
            notes.append(f"Nausea in the previous cycle: prophylaxis raised from {base_tier.lower()} to {effective_tier.lower()} emetogenic ({SRC_POGO_DOSES})")
        elif base_tier == TIER_HIGH:
            notes.append(f"Nausea in the previous cycle on highly emetogenic chemotherapy: olanzapine added ({SRC_POGO_DOSES})")

    # Under-prophylaxis check: ondansetron is given q8h (3x/d) at high, q12h (2x/d) at moderate, once at low
    if previous_prophylaxis:
        for prev in previous_prophylaxis:
            d_name = resolve_drug(prev.get("drug") or "")
            freq_str = (prev.get("frequency") or "").lower()
            m = re.search(r'(\d)x', freq_str)
            given_freq = int(m.group(1)) if m else None

            if d_name == "ondansetron" and given_freq is not None:
                required_freq = 3 if effective_tier == TIER_HIGH else (2 if effective_tier == TIER_MODERATE else 1)
                if given_freq < required_freq:
                    under_prophylaxis_warning = f"Previous cycle: ondansetron {given_freq}x/d; {effective_tier.lower()} emetogenic chemotherapy calls for {required_freq}x/d"

    prefer_iv = not can_swallow_tablets or formulation_preference == "iv"
    route = "IV" if prefer_iv else "IV or PO"
    aprepitant_eligible = age_years >= 0.5
    acute_phase = "acute phase: from the first chemotherapy dose until 24 h after the last dose of the block"

    # 1. 5-HT3 antagonist: ondansetron
    if effective_tier in (TIER_HIGH, TIER_MODERATE):
        raw = 5.0 * bsa_m2
        ond = min(8.0, round(raw, 1))
        freq = "3x/d" if effective_tier == TIER_HIGH else "2x/d"
        schedule["ondansetron"] = {
            "drug": "Ondansetron",
            "dose_mg": ond,
            "dose_calc": f"5 mg/m² × {bsa_m2} m² = {round(raw, 2)} mg (max 8 mg/dose)",
            "frequency": freq,
            "route": route,
            "duration": acute_phase,
            "timing": "first dose before chemotherapy, then every 8 h" if freq == "3x/d" else "first dose before chemotherapy, then every 12 h",
            "source": f"{SRC_POGO_DOSES}; max 8 mg: {SRC_CCLG}",
        }
    elif effective_tier == TIER_LOW:
        raw = 10.0 * bsa_m2
        cap = 16.0 if prefer_iv else 24.0
        schedule["ondansetron"] = {
            "drug": "Ondansetron",
            "dose_mg": min(cap, round(raw, 1)),
            "dose_calc": f"10 mg/m² × {bsa_m2} m² = {round(raw, 2)} mg (max 16 mg IV / 24 mg PO)",
            "frequency": "1x/d",
            "route": route,
            "duration": "once before chemotherapy",
            "timing": "before chemotherapy",
            "source": SRC_POGO_DOSES,
        }
    else:
        schedule["ondansetron"] = {
            "drug": "Ondansetron",
            "dose_mg": None,
            "frequency": "no routine prophylaxis",
            "route": "-",
            "duration": "N/A",
            "source": SRC_POGO_DOSES,
        }

    # 2. Aprepitant (children >= 6 months)
    if aprepitant_eligible:
        d1 = min(125.0, round(3.0 * weight_kg, 1))
        d23 = min(80.0, round(2.0 * weight_kg, 1))
        aprep_data = {
            "drug": "(Fos)Aprepitant",
            "status": "RECOMMENDED",
            "route": "PO",
            "day1_mg": d1,
            "day2_3_mg": d23,
            "schedule": f"PO day 1: {d1} mg (3 mg/kg, max 125); days 2-3: {d23} mg (2 mg/kg, max 80)",
            "interactions_alert": "Check interactions (CYP3A4). IV fosaprepitant if oral is not possible: dose with the pharmacist.",
            "source": SRC_POGO_DOSES,
        }
    else:
        aprep_data = {
            "drug": "(Fos)Aprepitant",
            "status": "NO_INDICATION",
            "note": "Under 6 months: not recommended",
            "source": SRC_POGO_DOSES,
        }

    blocked_entry = {
        "drug": "Dexamethasone",
        "status": "HARD_CONTRAINDICATION",
        "dose": "0 mg (BLOCKED)",
        "warning": dex_block_message or "No dexamethasone",
        "source": SRC_CCLG,
    }

    # 3. Tier-specific combination
    if effective_tier == TIER_HIGH:
        schedule["aprepitant"] = aprep_data
        if dex_hard_blocked:
            schedule["dexamethasone"] = blocked_entry
            if not aprepitant_eligible:
                notes.append("Dexamethasone and aprepitant not possible: palonosetron is the recommended 5-HT3 antagonist (POGO)")
        else:
            with_aprep = aprepitant_eligible
            per_dose = round((3.0 if with_aprep else 6.0) * bsa_m2, 1)
            schedule["dexamethasone"] = {
                "drug": "Dexamethasone",
                "status": "RECOMMENDED",
                "dose": f"{per_dose} mg 4x/d " + ("(6 mg/m² halved with aprepitant)" if with_aprep else "(6 mg/m²)"),
                "route": route,
                "duration": acute_phase,
                "timing": "every 6 h",
                "soft_warning": dex_soft_warning,
                "source": SRC_POGO_DOSES,
            }

    elif effective_tier == TIER_MODERATE:
        if dex_hard_blocked:
            schedule["dexamethasone"] = blocked_entry
            if aprepitant_eligible:
                schedule["aprepitant"] = aprep_data
                notes.append("Moderately emetogenic, dexamethasone contraindicated: ondansetron + aprepitant (POGO)")
            else:
                notes.append("Moderately emetogenic, under 6 months and dexamethasone contraindicated: palonosetron (POGO)")
        else:
            per_dose = 2.0 if bsa_m2 <= 0.6 else 4.0
            schedule["dexamethasone"] = {
                "drug": "Dexamethasone",
                "status": "RECOMMENDED",
                "dose": f"{per_dose:g} mg 2x/d (BSA {'≤' if bsa_m2 <= 0.6 else '>'} 0.6 m²)",
                "route": route,
                "duration": acute_phase,
                "timing": "every 12 h",
                "soft_warning": dex_soft_warning,
                "source": SRC_POGO_DOSES,
            }
            if aprepitant_eligible:
                alternative_drug = {
                    "drug": "(Fos)Aprepitant",
                    "status": "ALTERNATIVE",
                    "note": "If dexamethasone cannot be given: ondansetron + aprepitant",
                    "schedule": aprep_data["schedule"],
                    "source": SRC_POGO_DOSES,
                }

    # 4. Olanzapine: breakthrough on highly emetogenic chemotherapy (POGO), dose per CCLG 2025
    if effective_tier == TIER_HIGH and had_prior_nausea and base_tier == TIER_HIGH:
        if age_years > 1.0 and weight_kg >= 10.0:
            raw_olz = 0.14 * weight_kg
            olz = min(10.0, max(1.25, _round_to(raw_olz, 1.25)))
            schedule["olanzapine"] = {
                "drug": "Olanzapine",
                "status": "RECOMMENDED",
                "dose_mg": olz,
                "frequency": "1x/d",
                "route": "PO",
                "raw_calc": f"{weight_kg} kg × 0.14 mg/kg = {round(raw_olz, 2)} mg, rounded to the nearest 1.25 mg (max 10 mg) = {olz:g} mg",
                "rounding_rule": "Round to the nearest 1.25 mg; max 10 mg",
                "formulation_note": None if can_swallow_tablets else "Orodispersible tablet, or tablet dispersed in water",
                "timing": "once a day; do not combine with metoclopramide or levomepromazine",
                "source": f"Breakthrough: {SRC_POGO_DOSES}; dose: {SRC_CCLG}",
            }
        else:
            schedule["olanzapine"] = {
                "drug": "Olanzapine",
                "status": "NO_INDICATION",
                "note": "Under 1 year or under 10 kg: no dose in CCLG table",
                "source": SRC_CCLG,
            }

    # 5. Refractory CINV on highly emetogenic chemotherapy: switch to palonosetron (POGO)
    if effective_tier == TIER_HIGH and had_prior_nausea:
        if age_years < 17.0:
            palon = min(1.5, round(0.02 * weight_kg, 2))
            palon_str = f"{palon:g} mg IV once before chemotherapy (0.02 mg/kg, max 1.5 mg)"
        else:
            palon_str = "0.25 mg IV or 0.5 mg PO once before chemotherapy"
        schedule["palonosetron_switch_suggestion"] = {
            "drug": "Palonosetron",
            "status": "SUGGESTION",
            "condition": "If nausea keeps breaking through (refractory CINV): switch the 5-HT3 antagonist from ondansetron to palonosetron",
            "dose": palon_str,
            "safety_restriction": "Replaces ondansetron; do not give both",
            "source": SRC_POGO_DOSES,
        }

    # 6. Rescue: metoclopramide (> 1 year), not together with olanzapine (CCLG)
    on_olanzapine = schedule.get("olanzapine", {}).get("status") == "RECOMMENDED"
    if age_years > 1.0 and not on_olanzapine:
        raw_lo, raw_hi = 0.1 * weight_kg, 0.15 * weight_kg
        lo, hi = min(10.0, round(raw_lo, 1)), min(10.0, round(raw_hi, 1))
        schedule["breakthrough_options"] = [{
            "drug": "Metoclopramide",
            "dose": f"{lo:g} - {hi:g} mg",
            "dose_calc": f"{round(raw_lo, 2)} - {round(raw_hi, 2)} mg (100-150 µg/kg, max 10 mg/dose)",
            "capped": raw_hi > 10.0,
            "route": route,
            "frequency": "every 8-12 h, max 5 days",
            "source": f"Breakthrough: {SRC_POGO_DOSES}; dose: {SRC_CCLG}",
        }]
    else:
        schedule["breakthrough_options"] = []
        if on_olanzapine:
            notes.append("Olanzapine is in the plan: do not add metoclopramide or levomepromazine (CCLG)")

    # 7. Anticipatory nausea: lorazepam (POGO)
    raw_ant_low = 0.04 * weight_kg
    raw_ant_high = 0.08 * weight_kg
    schedule["anticipatory_option"] = {
        "drug": "Lorazepam",
        "dose": f"{min(2.0, round(raw_ant_low, 2)):g} - {min(2.0, round(raw_ant_high, 2)):g} mg",
        "dose_calc": f"{round(raw_ant_low, 2)} - {round(raw_ant_high, 2)} mg (0.04-0.08 mg/kg, max 2 mg)",
        "capped": raw_ant_high > 2.0,
        "timing": "the night before chemotherapy and again before chemotherapy the next day",
        "non_pharmacological": "Psychological interventions such as hypnosis or systematic desensitization",
        "source": SRC_POGO_DOSES,
    }

    return schedule, notes, alternative_drug, under_prophylaxis_warning, effective_tier

def _freq_n(freq) -> int:
    m = re.search(r'(\d+)\s*x', str(freq or ""), re.I)
    return int(m.group(1)) if m else 1


def _slots(n: int, time_labels: dict) -> List[str]:
    """Time-of-day labels for a drug taken n times a day."""
    m, a, e = time_labels.get("morning", "Morning"), time_labels.get("afternoon", "Afternoon"), time_labels.get("evening", "Evening")
    if n <= 1:
        return [m]
    if n == 2:
        return [m, e]
    if n == 3:
        return [m, a, e]
    return [m, a, e, time_labels.get("night", "Night")]


def derive_schedule_medications(schedule: dict, time_labels: dict) -> List[dict]:
    """Maps an approved CDS schedule into today's parent/companion
    time-slotted medication lines with doses strictly in mg (never mg/m²).
    """
    meds = []
    if "ondansetron" in schedule and schedule["ondansetron"].get("dose_mg"):
        ond = schedule["ondansetron"]
        dose_txt = f"{ond.get('dose_mg')} mg ({ond.get('route', 'IV/PO')})"
        freq = ond.get("frequency", "")
        if freq:
            for t in _slots(_freq_n(freq), time_labels):
                meds.append({"time": t, "drug": "Ondansetron", "dose_text": dose_txt})

    if "dexamethasone" in schedule and schedule["dexamethasone"].get("status") == "RECOMMENDED":
        dex = schedule["dexamethasone"]
        dose_str = str(dex.get("dose", ""))
        m = re.search(r'(\d+(?:\.\d+)?)\s*mg', dose_str)
        mg_val = m.group(1) if m else "?"
        dex_txt = f"{mg_val} mg ({dex.get('route', 'IV/PO')})"
        for t in _slots(_freq_n(dose_str), time_labels):
            meds.append({"time": t, "drug": "Dexamethasone", "dose_text": dex_txt})

    if "aprepitant" in schedule and schedule["aprepitant"].get("status") == "RECOMMENDED":
        aprep = schedule["aprepitant"]
        single = aprep.get("single_dose_mg")
        d1 = aprep.get("day1_mg")
        dose_val = f"{single or d1} mg"
        meds.append({"time": time_labels.get("morning", "Morning"), "drug": "(Fos)Aprepitant", "dose_text": f"{dose_val} ({aprep.get('route', 'PO')})"})

    if "olanzapine" in schedule and schedule["olanzapine"].get("status") == "RECOMMENDED":
        olanz = schedule["olanzapine"]
        meds.append({"time": time_labels.get("evening", "Evening"), "drug": "Olanzapine", "dose_text": f"{olanz.get('dose_mg')} mg ({olanz.get('route', 'PO')})"})

    # drugs a clinician added to the plan by hand (anything outside the four standard anti-emetics)
    for ex in schedule.get("_extra", []):
        for t in _slots(_freq_n(ex.get("frequency")), time_labels):
            meds.append({"time": t, "drug": ex.get("drug"), "dose_text": ex.get("dose_text")})

    return meds
