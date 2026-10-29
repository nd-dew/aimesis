// Patient details the backend has no fields for yet: allergies, IV access, latest lab values and the parents'
// contact. They are editable and kept in this browser, per patient (the defaults below fill the first view).

export interface LabDef { name: string; unit: string; lo?: number; hi?: number; tip: string }
export interface PatientExtras { allergies: string; access: string; labs: Record<string, number>; contact: { who: string; phone: string; note: string } }

export const LABS: LabDef[] = [
  { name: 'ANC', unit: '×10⁹/L', lo: 1.5, hi: 8.0, tip: 'Absolute neutrophil count: infection-fighting white cells. Low after chemo and checked before each cycle. Normal about 1.5 to 8.0.' },
  { name: 'Creatinine', unit: 'mg/dL', lo: 0.3, hi: 0.7, tip: 'Kidney function. Matters for cisplatin and for how drugs are cleared. Normal about 0.3 to 0.7 mg/dL.' },
  { name: 'ALT', unit: 'U/L', hi: 40, tip: 'A liver enzyme. Matters for how fast the liver clears the anti-emetics. Normal below about 40 U/L.' },
  { name: 'QTc', unit: 'ms', hi: 450, tip: 'The heart-rhythm timing measured on an ECG, corrected for heart rate. Ondansetron and olanzapine can lengthen it, so a high value is a reason to be careful. Normal below about 450 ms.' },
];

const L = (anc: number, creat: number, alt: number, qtc: number) => ({ ANC: anc, Creatinine: creat, ALT: alt, QTc: qtc });

const DEFAULTS: Record<string, PatientExtras> = {
  'pt-emma': { allergies: 'penicillin (skin rash)', access: 'port-a-cath, right chest', labs: L(0.8, 0.5, 32, 412), contact: { who: 'Mother', phone: '+32 470 00 00 00', note: 'reachable after 17:00' } },
  'pt-noah': { allergies: 'none known', access: 'Broviac line, left chest', labs: L(1.1, 0.3, 28, 398), contact: { who: 'Father', phone: '+32 471 00 00 01', note: 'any time' } },
  'pt-lucas': { allergies: 'latex (contact rash)', access: 'port-a-cath, left chest', labs: L(1.9, 0.6, 44, 436), contact: { who: 'Mother', phone: '+32 472 00 00 02', note: 'worried about school absence' } },
  'pt-sarah': { allergies: 'none known', access: 'Hickman line', labs: L(0.6, 0.4, 36, 405), contact: { who: 'Mother', phone: '+32 473 00 00 03', note: 'speaks Dutch and English' } },
  'pt-milan': { allergies: 'none known', access: 'peripheral IV', labs: L(2.4, 0.4, 25, 401), contact: { who: 'Father', phone: '+32 474 00 00 04', note: 'after 18:00' } },
  'pt-elena': { allergies: 'none known', access: 'port-a-cath, right chest', labs: L(1.6, 0.3, 30, 409), contact: { who: 'Mother', phone: '+32 475 00 00 05', note: 'any time' } },
};
const FALLBACK: PatientExtras = { allergies: 'none known', access: 'not recorded', labs: L(2.0, 0.5, 30, 410), contact: { who: 'Parent', phone: '', note: '' } };

const key = (id: string) => `aim_extras_v1_${id}`;

export const readExtras = (patientId: string): PatientExtras => {
  const base = DEFAULTS[patientId] || FALLBACK;
  try {
    const raw = localStorage.getItem(key(patientId));
    if (raw) { const s = JSON.parse(raw); return { ...base, ...s, labs: { ...base.labs, ...(s.labs || {}) }, contact: { ...base.contact, ...(s.contact || {}) } }; }
  } catch { /* storage unavailable: use the defaults */ }
  return base;
};

export const writeExtras = (patientId: string, x: PatientExtras) => {
  try { localStorage.setItem(key(patientId), JSON.stringify(x)); } catch { /* storage unavailable */ }
};

export const labFlag = (def: LabDef, value: number): 'LOW' | 'HIGH' | null =>
  def.lo != null && value < def.lo ? 'LOW' : def.hi != null && value > def.hi ? 'HIGH' : null;
