// Clinician API client: adds the X-API-Key header when a key is known.
// Companion (parent) pages use plain fetch and never send a key.
import { NauseaLogEntry } from './types';

const KEY_STORAGE = 'aim_api_key';

const readKey = (): string | null => {
  try {
    return sessionStorage.getItem(KEY_STORAGE) || (import.meta as any).env?.VITE_API_KEY || null;
  } catch {
    return (import.meta as any).env?.VITE_API_KEY || null;
  }
};

const saveKey = (key: string) => {
  try {
    sessionStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* storage unavailable: the key only lives for this request */
  }
};

const withKey = (init: RequestInit | undefined, key: string | null): RequestInit => {
  const headers = new Headers(init?.headers || {});
  if (key) headers.set('X-API-Key', key);
  return { ...init, headers };
};

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  let res = await fetch(input, withKey(init, readKey()));
  if (res.status === 401) {
    const entered = window.prompt('This server requires a clinician API key. Enter the key:');
    if (entered) {
      saveKey(entered.trim());
      res = await fetch(input, withKey(init, entered.trim()));
    }
  }
  return res;
}

// Parent logs from both apps: the old companion page (/m, severity 1-5) and the patient diary
// (/patient, nausea 0-3 or vomiting). Diary entries are mapped onto 1-5: no nausea 1, levels 2-4, vomiting 5.
// If one source fails, the other still shows.
export async function loadParentLogs(patientId: string): Promise<NauseaLogEntry[]> {
  const id = encodeURIComponent(patientId);
  const [tracker, diary] = await Promise.all([
    apiFetch(`/api/tracker/logs?patient_id=${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    apiFetch(`/api/patients/${id}/patient-mobile-logs`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const old: NauseaLogEntry[] = Array.isArray(tracker?.logs) ? tracker.logs : [];
  const fromDiary: NauseaLogEntry[] = (Array.isArray(diary) ? diary : []).map((d: DiaryEntry) => ({
    id: d.id,
    occurred_at: d.occurred_at,
    severity: d.kind === 'vomiting' ? 5 : (d.severity ?? 0) + 1,
    type: 'delayed',
    kind: d.kind === 'vomiting' ? 'vomiting' : d.severity === 0 ? 'no nausea' : 'nausea',
    note: d.note || undefined,
  }));
  return [...old, ...fromDiary];
}

interface DiaryEntry { id: string; kind: 'nausea' | 'vomiting'; severity: number | null; occurred_at: string; note: string | null }
