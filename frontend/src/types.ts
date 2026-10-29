export type EmetogenicityTier = 'High' | 'Moderate' | 'Low' | 'Minimal' | 'UNKNOWN' | 'UNDETERMINED';

export interface Patient {
  id: string;
  alias: string;
  sex?: 'F' | 'M';
  age_years: number;
  diagnosis_text: string;
  diagnosis_category: 'ALL' | 'AML' | 'BRAIN_TUMOR' | 'OTHER';
  protocol: string;
  weight_kg?: number;
  height_cm?: number;
  bsa_m2?: number;
  flags: {
    dinutuximab_beta?: boolean;
    car_t?: boolean;
  };
  language: 'NL' | 'FR' | 'EN';
  swallow: 'tablets' | 'liquid_only' | 'ng_tube' | 'iv_only';
  fictional_fields: string[];
}

export interface CycleRegimenItem {
  drug: string;
  dose_mg_m2?: number;
  days?: number[];
}

export interface CycleProphylaxisItem {
  drug: string;
  frequency?: string;
  note?: string;
}

export interface CycleOutcome {
  nausea: boolean;
  vomiting: boolean;
  first_day?: number;
  note?: string;
  source?: string;
}

export interface Cycle {
  id: string;
  patient_id: string;
  date?: string | null;
  label: string;
  course_type: string;
  status: 'planned' | 'given';
  regimen: CycleRegimenItem[];
  is_multiday: boolean;
  regimen_contains_corticoids: boolean;
  tier_assigned?: string;
  prophylaxis_given: CycleProphylaxisItem[];
  outcome?: CycleOutcome;
  plan_snapshot?: PlanSnapshot | null;
  fictional_fields?: string[];
}

export interface PlanSnapshotItem {
  drug: string;
  dose_mg?: number | null;
  dose_text?: string | null;
  route?: string | null;
  frequency?: string | null;
  timing?: string | null;
}

export interface PlanSnapshot {
  effective_tier: string;
  items: PlanSnapshotItem[];
  evaluated_at: string;
  approved: boolean;
  approved_by_alias?: string | null;
}

export interface NauseaLogEntry {
  id?: string;
  patient_id?: string;
  cycle_id?: string;
  client_id?: string;
  occurred_at?: string;
  received_at?: string;
  timestamp?: string;
  severity: number;
  type: 'acute' | 'delayed' | 'anticipatory';
  kind?: 'nausea' | 'no nausea' | 'vomiting'; // set for entries from the patient diary (/patient)
  note?: string;
}

export interface DDIAlert {
  id?: string;
  level?: string;
  message: string;
  source?: string;
  verified?: boolean;
}

export interface DrugScheduleItem {
  drug: string;
  single_dose_mg?: number;
  day1_mg?: number;
  day2_3_mg?: number;
  status?: string;
  dose_mg?: number;
  dose?: string;
  frequency?: string;
  route?: string;
  duration?: string;
  timing?: string;
  schedule?: string;
  raw_calc?: string;
  rounding_rule?: string;
  warning?: string;
  discharge_note?: string;
  multi_day_note?: string | null;
  multi_day_extension?: string | null;
  interactions_alert?: string;
  safety_note?: string;
  note?: string;
  formulation_note?: string | null;
  source?: string;
  condition?: string;
  safety_restriction?: string;
  soft_warning?: string | null;
}

export interface BreakthroughMedication {
  drug: string;
  dose: string;
  dose_calc?: string;
  capped?: boolean;
  route: string;
  frequency: string;
  indication?: string;
}

export interface BenchmarkCase {
  id: string;
  title: string;
  patient_alias: string;
  age_years: number;
  weight_kg: number;
  bsa_m2: number;
  diagnosis: string;
  protocol_name?: string;
  drugs: string[];
  doses_mg_m2?: Record<string, number>;
  is_multiday?: boolean;
  had_prior_nausea?: boolean;
  anticipatory_symptoms?: boolean;
  contains_corticosteroids?: boolean;
  target_language?: string;
  clinical_background: string;
}

export interface AnticipatoryMedication {
  drug: string;
  dose: string;
  dose_calc?: string;
  capped?: boolean;
  timing: string;
  non_pharmacological: string;
}

export interface CDSSchedule {
  ondansetron?: DrugScheduleItem;
  aprepitant?: DrugScheduleItem;
  dexamethasone?: DrugScheduleItem;
  olanzapine?: DrugScheduleItem;
  palonosetron_switch_suggestion?: DrugScheduleItem;
  breakthrough_options?: BreakthroughMedication[];
  anticipatory_option?: AnticipatoryMedication;
}

export interface PatientPassportData {
  patient_alias: string;
  emetogenicity_tier: EmetogenicityTier;
  dexamethasone_blocked: boolean;
  hospital: string;
  emergency_contact?: string;
  emergency_phone?: string;
  time_labels?: {
    morning: string;
    afternoon: string;
    evening: string;
  };
  red_flag_title?: string;
  red_flag_symptoms: string[];
  schedule_summary: {
    morning: string;
    afternoon: string;
    evening: string;
  };
  belgian_family_resources: Array<{
    title: string;
    url: string;
    format?: string;
    institute?: string;
  }>;
}

export interface CDSResult {
  overall_tier: EmetogenicityTier;
  base_tier?: string;
  effective_tier?: string;
  plan_status?: 'COMPLETE' | 'INCOMPLETE';
  dose_missing_for?: string[];
  individual_tiers: Record<string, { tier: EmetogenicityTier | 'N/A'; reason: string; source?: string; canonical_name?: string; dose_missing?: boolean }>;
  age_years?: number;
  weight_kg?: number;
  height_cm?: number;
  bsa_m2?: number;
  had_prior_nausea?: boolean;
  anticipatory_symptoms?: boolean;
  previous_prophylaxis?: Array<{ drug: string; frequency?: string; note?: string }>;
  tier_escalated?: boolean;
  can_swallow_tablets?: boolean;
  formulation_preference?: string;
  unrecognised_drugs?: string[];
  manual_review_required?: boolean;
  combination_escalation?: { tier: EmetogenicityTier; reason: string; source?: string } | null;
  dex_contraindicated: boolean;
  dex_contraindication_reason?: string;
  dex_soft_warning?: string;
  under_prophylaxis_warning?: string;
  alternative_drug?: any;
  notes?: string[];
  schedule: CDSSchedule;
  ddi_alerts: Array<DDIAlert | string>;
  clinical_rationale: string;
  llm_status?: string;
  patient_passport: PatientPassportData;
  derived_from?: Record<string, string>;
}

export interface CompanionTodayItem {
  time: string;
  drug: string;
  dose_text: string;
}

export interface CompanionPassportData {
  hospital: string;
  emergency_contact: string;
  time_labels: Record<string, string>;
  red_flag_title?: string;
  red_flag_symptoms: string[];
  belgian_family_resources: Array<{
    title: string;
    url: string;
    format?: string;
    institute?: string;
  }>;
}

export interface CompanionViewResponse {
  patient_alias: string;
  language: string;
  upcoming_cycle?: {
    id: string;
    label: string;
    course_type: string;
    date?: string | null;
    tier: string;
    is_multiday: boolean;
  } | null;
  passport: CompanionPassportData;
  today: CompanionTodayItem[];
  schedule_message?: string | null;
  recent_logs: NauseaLogEntry[];
  uploads_enabled: boolean;
}

export interface TrackerLog {
  patient_id?: string;
  patient_alias?: string;
  severity: number;
  type: string;
  notes?: string;
  timestamp?: string;
}
