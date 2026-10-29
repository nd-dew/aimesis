// Clinician notes of a patient. The backend has no notes field yet, so they live in this browser, per patient.
// Notes are never deleted; editing a note keeps every earlier version in `revisions`.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Notes with history -------------------------------------------------------------------------
// The backend has no notes field yet, so notes live in this browser (per patient). Notes are never
// deleted; editing a note keeps every earlier version in `revisions`, so the history is complete.
export interface Revision { text: string; at: string; author: string }
export interface Note { id: string; createdAt: string; author: string; text: string; updatedAt?: string; revisions: Revision[]; demo?: boolean }

export const AUTHOR = 'Dr. A. Peeters';

const SEED_NOTES: Record<string, Array<[string, string]>> = {
  'pt-emma': [
    ['2026-09-06T10:15:00', 'B3: nausea from day 2 despite ondansetron, aprepitant, dexamethasone and olanzapine. Discuss stronger prophylaxis before B4.'],
    ['2026-09-20T14:40:00', 'Mother prefers information in Dutch and is reachable on her mobile after 17:00.'],
    ['2026-09-24T09:05:00', 'Check QTc before B4: olanzapine plus ondansetron can prolong it.'],
  ],
  'pt-noah': [
    ['2026-09-13T11:00:00', 'Induction B D1 tolerated well, no nausea or vomiting.'],
    ['2026-09-16T15:20:00', 'ALL protocol already contains dexamethasone: no extra steroid. Parents asked for liquid forms only.'],
  ],
  'pt-lucas': [
    ['2026-08-14T09:30:00', 'IE1 and IE2: nausea and vomiting from day 4 both times. Plan: extend aprepitant to days 4-5 for IE3.'],
    ['2026-08-30T16:10:00', 'No swallowing problems, tablets are fine. Mother worried about school absence.'],
  ],
  'pt-sarah': [['2026-09-18T10:00:00', 'AML: dexamethasone not preferred, agree an alternative with the pharmacy before cycle 1.']],
  'pt-milan': [['2026-09-18T13:45:00', 'First cycle, pre-operative. Parents are anxious: information leaflet handed out.']],
  'pt-elena': [['2026-09-18T11:30:00', 'Fed through a nasogastric tube: all oral drugs must be given as liquids through the tube.']],
};

const seedNotes = (patientId: string): Note[] =>
  (SEED_NOTES[patientId] || [['2026-09-18T10:00:00', 'Intake note: no special remarks.']]).map(([createdAt, text], i) => ({
    id: `seed-${patientId}-${i}`, createdAt, author: AUTHOR, text, revisions: [], demo: true,
  }));

export const fmtFull = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Notes of a patient (from this browser, or the demo seeds): the history chart places them on the timeline.
export const readNotes = (patientId: string): Note[] => {
  try {
    const raw = localStorage.getItem(`aim_notes_v2_${patientId}`);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through to the seeds */ }
  return seedNotes(patientId);
};


export const writeNotes = (patientId: string, notes: Note[]) => {
  try { localStorage.setItem(`aim_notes_v2_${patientId}`, JSON.stringify(notes)); } catch { /* storage unavailable */ }
};

export const newNote = (text: string): Note => ({ id: `n-${Date.now()}`, createdAt: new Date().toISOString(), author: AUTHOR, text, revisions: [] });

export const editedNote = (n: Note, text: string): Note => ({
  ...n, text, updatedAt: new Date().toISOString(),
  revisions: [...n.revisions, { text: n.text, at: n.updatedAt || n.createdAt, author: n.author }],
});
