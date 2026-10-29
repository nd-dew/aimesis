"""Vertex AI / Google GenAI client for AImesis.
Adheres to G6 (negation parsing), G12 (hallucination checks & status), and H4 (vision parsing).
"""

import os
import json
import re
import logging
from typing import Dict, Any, Optional, Tuple
from app.config import GCP_PROJECT_ID, GCP_LOCATION, GEMINI_MODEL

USE_LLM = os.getenv("USE_LLM", "false").lower() in ("true", "1", "yes")
logger = logging.getLogger("aimesis")

_client = None

def get_genai_client():
    global _client
    if _client is None:
        try:
            from google import genai
            _client = genai.Client(
                vertexai=True,
                project=GCP_PROJECT_ID,
                location=GCP_LOCATION,
            )
        except Exception:
            _client = None
    return _client

def build_deterministic_rationale(patient_summary: dict, schedule: dict, warnings: list) -> str:
    """Builds a deterministic clinical rationale strictly from policy fields without mechanism claims."""
    tier = patient_summary.get("effective_tier") or patient_summary.get("overall_tier", "Unknown")
    base = patient_summary.get("base_tier")
    drugs = ", ".join(patient_summary.get("drugs", []))

    lines = [
        f"Patient: {patient_summary.get('patient_alias', 'Patient')} ({patient_summary.get('age_years')}y, {patient_summary.get('weight_kg')} kg, BSA {patient_summary.get('bsa_m2')} m²).",
        f"Chemotherapy ({drugs}) classified as {tier} emetogenic (base: {base or tier}; source: POGO classification).",
    ]

    combo = patient_summary.get("combination_escalation")
    if combo:
        lines.append(f"Combination: {combo.get('reason')} (source: {combo.get('source')}).")

    if patient_summary.get("dex_contraindicated"):
        lines.append(f"Dexamethasone contraindicated: {patient_summary.get('dex_contraindication_reason')} (source: CCLG 2025).")
    elif patient_summary.get("dex_soft_warning"):
        lines.append(f"Dexamethasone caution: {patient_summary.get('dex_soft_warning')} (source: CCLG 2025).")

    under_prop = patient_summary.get("under_prophylaxis_warning")
    if under_prop:
        lines.append(f"Note: {under_prop}.")

    palon = schedule.get("palonosetron_switch_suggestion")
    if palon:
        lines.append(f"Consider: {palon.get('condition')}. {palon.get('safety_restriction')}.")

    for w in warnings:
        lines.append(f"Interaction: {w}")

    return "\n".join(lines)

def generate_clinical_rationale(patient_summary: dict, schedule: dict, warnings: list) -> Tuple[str, str]:
    """Generates an evidence-based clinical rationale.
    Returns (rationale, llm_status) where status is 'disabled' | 'ok' | 'error' | 'rejected' (G12).
    """
    base_rationale = build_deterministic_rationale(patient_summary, schedule, warnings)

    if not USE_LLM:
        return base_rationale, "disabled"

    client = get_genai_client()
    if not client:
        return base_rationale, "error"

    prompt = f"""
You are AImesis, a clinical decision support assistant for pediatric oncologists.
Summarize the following clinical CDS result clearly and authoritatively.

STRICT CLINICAL RULES:
1. Do NOT invent physiological mechanisms or explanations (e.g. do NOT say "alters blood-brain barrier", "interferes with steroid backbone", "blunts ADCC", or "reduced by 50% due to CYP3A4").
2. Only restate the verified facts from the input data and quote the guideline rules provided (POGO, CCLG).
3. Keep the tone concise, clinical, and factual.

Input Data:
Patient Summary: {json.dumps(patient_summary)}
Schedule: {json.dumps(schedule)}
Warnings: {json.dumps(warnings)}
"""
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config={"thinking_config": {"thinking_budget": 0}},
        )
        text = response.text.strip()

        # G12: Check that LLM output does not introduce hallucinated numbers or unverified drugs
        # Look for numbers in LLM text and verify they exist in base_rationale
        llm_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', text))
        base_numbers = set(re.findall(r'\b\d+(?:\.\d+)?\b', base_rationale))
        # Exclude standard single digits 1-5
        novel_numbers = [n for n in llm_numbers if n not in base_numbers and float(n) > 5.0]
        if novel_numbers:
            return base_rationale, "rejected"

        forbidden = ["blood-brain barrier", "steroid backbone", "blunts adcc", "reduced by 50%", "reduced by 40%"]
        if any(f in text.lower() for f in forbidden):
            return base_rationale, "rejected"

        return text, "ok"
    except Exception:
        return base_rationale, "error"

def parse_clinical_progress_note(toernota_text: str) -> Dict[str, Any]:
    """Extracts structured CINV data from clinical notes.
    G6: Handles clause-based negations in NL, EN, FR ('geen, niet, zonder, no, not, without, pas de, sans').
    """
    text = toernota_text.strip()
    # Split by clause boundaries (punctuation, commas, 'maar', 'ondanks', 'but')
    clauses = re.split(r'[,;.\n]|\bmaar\b|\bondanks\b|\bbut\b|\bmais\b', text, flags=re.IGNORECASE)

    negation_pattern = re.compile(r'\b(geen|niet|zonder|no|not|without|pas de|sans)\b', re.IGNORECASE)
    nausea_keywords = re.compile(r'\b(misselijk|misselijkheid|nausea|nauseaklachten|nausée|nausées)\b', re.IGNORECASE)
    vomiting_keywords = re.compile(r'\b(braken|gebraakt|overgeven|vomit|vomiting|vomissements|vomi)\b', re.IGNORECASE)

    had_nausea = False
    had_vomiting = False

    for clause in clauses:
        clause_str = clause.strip()
        if not clause_str:
            continue

        is_negated = bool(negation_pattern.search(clause_str))

        if nausea_keywords.search(clause_str):
            if not is_negated:
                had_nausea = True

        if vomiting_keywords.search(clause_str):
            if not is_negated:
                had_vomiting = True

    return {
        "had_prior_nausea": had_nausea,
        "had_prior_vomiting": had_vomiting,
        "notes": "Clause-based heuristic parser",
    }

def parse_clinical_progress_note_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> Dict[str, Any]:
    """H4: Real Gemini vision parser for handwritten or printed progress note images."""
    if not USE_LLM:
        return {"error": "USE_LLM is false"}

    client = get_genai_client()
    if not client:
        return {"error": "Gemini client unavailable"}

    from google.genai import types

    prompt = """
Analyze this handwritten or printed clinical progress note (toernota / EPD extract) for a pediatric oncology patient.
Extract structured CINV data. For each extracted field, provide confidence (0.0 to 1.0) and an evidence quote from the image.

Return ONLY valid JSON matching this schema:
{
  "suggestion": {
    "patient_name_or_alias": string or null,
    "current_protocol": string or null,
    "chemotherapy_drugs": [string],
    "had_prior_nausea": boolean,
    "had_prior_vomiting": boolean,
    "anticipatory_symptoms": boolean
  },
  "confidence": {
    "patient_name_or_alias": float,
    "current_protocol": float,
    "chemotherapy_drugs": float,
    "had_prior_nausea": float,
    "had_prior_vomiting": float
  },
  "evidence": {
    "patient_name_or_alias": string or null,
    "current_protocol": string or null,
    "chemotherapy_drugs": string or null,
    "had_prior_nausea": string or null,
    "had_prior_vomiting": string or null
  },
  "source": "ai_suggestion",
  "requires_confirmation": true
}
"""
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config={"response_mime_type": "application/json"}
        )
        data = json.loads(response.text)
        data["source"] = "ai_suggestion"
        data["requires_confirmation"] = True
        return data
    except Exception as e:
        return {
            "error": str(e),
            "source": "ai_suggestion",
            "requires_confirmation": True
        }

# ---- Watch-outs narrative ------------------------------------------------------------------------
# Gemini rewrites the verified watch-out facts into a short, connected handover. Every dose, number
# and drug name must already be in the facts; anything else rejects the whole answer so the UI falls
# back to the deterministic list.

KNOWN_ANTIEMETICS = [
    "ondansetron", "granisetron", "palonosetron", "aprepitant", "fosaprepitant", "dexamethasone",
    "methylprednisolone", "olanzapine", "lorazepam", "alizapride", "metoclopramide", "domperidone",
    "haloperidol", "levomepromazine", "promethazine", "chlorpromazine", "dronabinol", "nabilone",
    "diphenhydramine", "midazolam",
]
FORBIDDEN_CLAIMS = ["blood-brain barrier", "steroid backbone", "blunts adcc", "reduced by 50%", "reduced by 40%", "cyp3a4"]
WATCHOUT_KINDS = ("patient", "clinician", "chemo", "engine", "rescue", "pattern")
_watchout_cache: Dict[str, Tuple[list, str]] = {}

def _numbers(text: str) -> set:
    return {str(float(n)) for n in re.findall(r'\d+(?:\.\d+)?', text)}

def validate_watchouts(items: Any, facts: list, context_text: str) -> Optional[str]:
    """G12-style checks. Returns a rejection reason, or None when the items are safe to show."""
    if not isinstance(items, list) or not 1 <= len(items) <= 6:
        return "item count"
    fact_ids = {f["id"] for f in facts}
    grounding = " ".join(f["text"] for f in facts) + " " + context_text
    allowed_numbers = _numbers(grounding)
    grounding_lower = grounding.lower()
    cited = set()
    for it in items:
        if not isinstance(it, dict) or it.get("kind") not in WATCHOUT_KINDS:
            return "item shape"
        text = f"{it.get('headline', '')} {it.get('text', '')}"
        if not it.get("text") or len(text) > 400:
            return "item text"
        sources = it.get("sources")
        if not isinstance(sources, list) or not sources or not set(sources) <= fact_ids:
            return "unknown source"
        cited |= set(sources)
        # a pattern is an observation across the history, so it has to rest on more than one fact
        if it["kind"] == "pattern" and len(set(sources)) < 2:
            return "pattern needs two sources"
        if _numbers(text) - allowed_numbers:
            return "novel number"
        lower = text.lower()
        if any(d in lower and d not in grounding_lower for d in KNOWN_ANTIEMETICS):
            return "novel drug"
        # a mechanism term is fine only when an engine fact (e.g. an interaction alert) already states it
        if any(f in lower and f not in grounding_lower for f in FORBIDDEN_CLAIMS):
            return "mechanism claim"
    if sum(it["kind"] == "pattern" for it in items) > 2:
        return "too many patterns"
    if {f["id"] for f in facts if f.get("required")} - cited:
        return "required fact dropped"
    # a capped dose must keep saying so wherever it is used
    for f in facts:
        if "maximum" in f["text"].lower():
            users = [it for it in items if f["id"] in it["sources"]]
            if not any("maximum" in f"{it.get('headline', '')} {it['text']}".lower() for it in users):
                return "cap annotation dropped"
    return None

def generate_watchouts(context: dict, facts: list) -> Tuple[list, str]:
    """Returns (items, llm_status). items is empty unless status is 'ok'."""
    if not USE_LLM:
        return [], "disabled"
    client = get_genai_client()
    if not client:
        return [], "error"

    key = json.dumps([context, facts], sort_keys=True)
    if key in _watchout_cache:
        return _watchout_cache[key]

    prompt = f"""
You are AImesis, writing the "Rescue and watch-outs" box for a pediatric oncologist about to approve
an anti-emetic plan. Turn the verified facts below into a short handover a senior colleague would give:
connect facts that belong together (e.g. a patient report with the matching rescue option, a clinician
note with the drugs in today's plan, a previous cycle's outcome with what to watch this time) and lead
with what the clinician should act on first.

The facts include the patient's history: one line per earlier visit (chemo type, outcome, anti-emetics),
the patient's app reports and clinician notes of the last weeks. Read it as a whole.

STRICT RULES:
1. Use ONLY the facts below. Do not add numbers, doses, days, drugs, mechanisms or advice that are not in them.
2. Copy every dose exactly as written in its fact, including "(guideline maximum)" or "(capped at the
   guideline maximum)" right after it. Every fact marked required MUST be cited.
3. Refer to the patient as {context.get("pronoun_hint")}. Do not use the patient's name.
4. The engine only suggests: write "consider", never "give" or "start". The clinician decides.
5. Plain clinical English, sentence case, drug names in lower case (languages stay capitalised). 2 to 5 items.
   headline: at most 6 words. text: at most 40 words.
6. If there is a breakthrough rescue fact, it is the last item, on its own, starting with "If breakthrough nausea".
7. If a note says how the family wants to be informed, tie it to what they need to know (e.g. the timing
   of a dose given at home), instead of repeating it on its own.
8. kind = the kind of the main fact the item is about (patient, clinician, chemo, engine or rescue).
9. If the history shows a pattern across visits (e.g. the same chemo type always followed by nausea from
   the same day, reports rising before treatment, a problem that came back after a change), add at most
   2 items of kind "pattern": name the pattern with the visits it rests on, then what to discuss.
   A pattern cites at least 2 facts. It may only point to options already in the facts (an "Engine
   option" or a clinician note's plan), keeping that option's own conditions (e.g. only with the supervisor
   or pharmacy, never together with another drug); if there is none, say what to watch or review.
   No pattern without evidence: skip it rather than guess.
10. sources = ids of every fact the item uses.

Return ONLY JSON: {{"items": [{{"kind": string, "headline": string, "text": string, "sources": [string]}}]}}

Patient context: {json.dumps(context)}
Facts: {json.dumps(facts)}
"""
    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            # rewording verified facts needs no reasoning; thinking took ~10 s per call
            config={"response_mime_type": "application/json", "temperature": 0.4, "thinking_config": {"thinking_budget": 0}},
        )
        items = json.loads(response.text).get("items")
        reason = validate_watchouts(items, facts, json.dumps(context))
        if reason:
            logger.warning("watchouts rejected (%s): %s", reason, json.dumps(items, ensure_ascii=False))
            return [], "rejected"
    except Exception as e:
        logger.warning("watchouts error: %s", e)
        return [], "error"

    # only accepted answers are cached, so a refresh retries after a rejection
    result = (items, "ok")
    if len(_watchout_cache) > 200:
        _watchout_cache.clear()
    _watchout_cache[key] = result
    return result
