export type NauseaLevel = 0 | 1 | 2 | 3;
export type SymptomReport =
  | { kind: 'nausea'; severity: NauseaLevel }
  | { kind: 'vomiting'; severity: null };
export type CompanionLogRequest = SymptomReport & { client_id: string; occurred_at: string };
export type NauseaLogEntry = SymptomReport & { id: string; occurred_at: string; note: string | null };
export interface PatientDiary {
  patient_alias: string;
  language: 'NL' | 'FR' | 'EN';
  recent_logs: NauseaLogEntry[];
}
