import { Cycle, NauseaLogEntry, Patient } from './types';

// Builds the lanes of one cycle's chart. REAL: regimen, doses (mg/m²), dates, outcome, recorded anti-emetics,
// approvals and logs the parents sent. DEMO (marked demo: true): missing chemo doses, anti-emetic doses that were
// never recorded, and the patient's self-reports. Nothing here is sent to the backend or the engine.

export type MarkKind = 'chemo' | 'drug' | 'rescue' | 'report' | 'note' | 'decision';
export interface Mark { day: number; kind: MarkKind; label: string; tip: string; demo: boolean; severity?: number; hour?: number; note?: string; phase?: string }
export interface Lane { key: string; label: string; kind: MarkKind; marks: Mark[]; tip: string }
export interface DrugSummary { name: string; summary: string; recorded: boolean }
export interface Chart { days: number[]; chemoDays: number[]; lanes: Lane[]; dayDates: string[]; drugs: DrugSummary[] }

export interface NoteLike { createdAt: string; author: string; text: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEMO_DOSE: Record<string, number> = { carboplatin: 500, etoposide: 100, cyclophosphamide: 1000, vincristine: 1.5, doxorubicin: 25, dactinomycin: 1, daunorubicin: 25, cytarabine: 200, cisplatin: 80, ifosfamide: 1800 };
const MAX_MG: Record<string, number> = { vincristine: 2 };
const r1 = (x: number) => Math.round(x * 10) / 10;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const parseDate = (d?: string | null) => { const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayOf = (cycleStart: Date, t: Date) => Math.round((startOfDay(t) - startOfDay(cycleStart)) / 86400000) + 1; // chemo day 1 = cycle date; day 0 = the day before

// Rough emetogenicity from the drugs, only used to generate DEMO anti-emetic plans for cycles where none was recorded.
const demoTier = (drugs: string[]): 'High' | 'Moderate' | 'Low' | 'Minimal' => {
  if (drugs.some((d) => ['cisplatin', 'carboplatin'].includes(d)) || drugs.includes('ifosfamide')) return 'High';
  if (drugs.some((d) => ['cyclophosphamide', 'doxorubicin', 'daunorubicin', 'cytarabine'].includes(d))) return 'Moderate';
  if (drugs.some((d) => ['etoposide', 'dactinomycin'].includes(d))) return 'Low';
  return 'Minimal';
};

const parseFreq = (f?: string) => { const m = f?.match(/(\d+)\s*x/i); return m ? +m[1] : 1; };

export const buildChart = (patient: Patient, cycle: Cycle, realLogs: NauseaLogEntry[], notes: NoteLike[]): Chart => {
  const start = parseDate(cycle.date);
  const bsa = patient.bsa_m2 ?? 1;
  const w = patient.weight_kg ?? 20;
  const drugs = cycle.regimen.map((r) => r.drug.toLowerCase());
  const chemoDays = Array.from(new Set(cycle.regimen.flatMap((r) => (r.days && r.days.length ? r.days : [1])))).sort((a, b) => a - b);
  const first = chemoDays[0] ?? 1, last = chemoDays[chemoDays.length - 1] ?? 1;
  const maxDay = Math.max(8, last + 5);
  const days = Array.from({ length: maxDay + 1 }, (_, i) => i); // 0 .. maxDay
  const dayDates = days.map((d) => { if (!start) return ''; const x = new Date(start); x.setDate(x.getDate() + d - 1); return `${String(x.getDate()).padStart(2, '0')} ${MONTHS[x.getMonth()]}`; });
  const lanes: Lane[] = [];
  const drugsOut: DrugSummary[] = [];
  const given = cycle.status === 'given';

  // ---- chemo: one lane per drug
  for (const r of cycle.regimen) {
    const d = r.drug.toLowerCase();
    const realDose = r.dose_mg_m2 != null;
    const mgm2 = r.dose_mg_m2 ?? DEMO_DOSE[d] ?? 100;
    const mg = Math.min(MAX_MG[d] ?? Infinity, Math.round(mgm2 * bsa * 10) / 10);
    const days_ = r.days && r.days.length ? r.days : [1];
    lanes.push({
      key: `chemo-${d}`, label: r.drug, kind: 'chemo', tip: `${r.drug}: chemotherapy given in this cycle. Each block is a day it was given.`,
      marks: days_.map((day) => ({
        day, kind: 'chemo', demo: !realDose, label: `${mg} mg`,
        tip: `${r.drug} ${mgm2} mg/m² × BSA ${bsa} m² = ${mg} mg${MAX_MG[d] ? ` (max ${MAX_MG[d]} mg)` : ''}, day ${day}.${cycle.status === 'planned' ? ' Planned, not given yet.' : ''}`,
      })),
    });
  }

  // ---- anti-emetics: recorded ones if there are any, otherwise a DEMO plan derived from the chemo drugs
  if (given || cycle.prophylaxis_given.length) {
    const recorded = cycle.prophylaxis_given.length > 0;
    const tier = demoTier(drugs);
    const hasApr = recorded ? cycle.prophylaxis_given.some((p) => /aprepitant/i.test(p.drug)) : tier === 'High';
    const plan: Array<{ name: string; freq: number; daysOn: number[]; dose: (day: number) => string; doseNote: string; summary: string }> = [];
    const tail = tier === 'High' ? 2 : 1;
    const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const rec = (name: string) => cycle.prophylaxis_given.find((p) => p.drug.toLowerCase().includes(name));
    const want = (name: string, demoOn: boolean) => (recorded ? !!rec(name) : demoOn);

    if (want('ondansetron', true)) {
      const per = Math.min(8, r1(5 * bsa));
      const freq = recorded ? parseFreq(rec('ondansetron')?.frequency) : tier === 'High' ? 3 : 2;
      plan.push({ name: 'Ondansetron', freq, daysOn: span(first, last + tail), dose: () => `${per} mg ×${freq}`, doseNote: `5 mg/m² × BSA ${bsa} = ${per} mg per dose (max 8 mg), ${freq}× a day.`, summary: `${per} mg ×${freq}/day` });
    }
    if (want('aprepitant', hasApr)) {
      const [d1, d2] = patient.age_years >= 12 ? [125, 80] : [Math.min(125, Math.round(3 * w)), Math.min(80, Math.round(2 * w))];
      const on = Array.from(new Set([...span(first, first + 2), ...(chemoDays.length > 1 ? span(first, last) : [])])).sort((a, b) => a - b);
      plan.push({ name: '(Fos)aprepitant', freq: 1, daysOn: on, dose: (day) => `${day === first ? d1 : d2} mg`, doseNote: `Day 1 ${d1} mg, then ${d2} mg once a day.`, summary: `${d1} → ${d2} → ${d2} mg` });
    }
    if (want('dexamethasone', tier === 'High' || tier === 'Moderate')) {
      const per = hasApr ? Math.floor(1.3 * bsa * 2) / 2 : Math.floor(2.6 * bsa * 2) / 2;
      const freq = recorded ? parseFreq(rec('dexamethasone')?.frequency) : 2;
      plan.push({ name: 'Dexamethasone', freq, daysOn: span(first, last + (tier === 'High' ? 2 : 1)), dose: () => `${per} mg ×${freq}`, doseNote: `${per} mg per dose, ${freq}× a day${hasApr ? ' (halved because aprepitant raises its level)' : ''}.`, summary: `${per} mg ×${freq}/day` });
    }
    if (want('olanzapine', tier === 'High' && patient.age_years >= 2)) {
      const per = Math.min(5, Math.floor(0.1 * w * 2) / 2);
      plan.push({ name: 'Olanzapine', freq: 1, daysOn: span(first, last + 3), dose: () => `${per} mg`, doseNote: `0.1 mg/kg × ${w} kg, rounded down to 0.5 mg (max 5 mg), once in the evening.`, summary: `${per} mg ×1/day` });
    }
    for (const a of plan) {
      drugsOut.push({ name: a.name, summary: a.summary, recorded });
      lanes.push({
        key: `ae-${a.name}`, label: a.name, kind: 'drug', tip: `${a.name}: anti-emetic. `,
        marks: a.daysOn.map((day) => ({
          day, kind: 'drug', demo: !recorded, label: recorded ? (rec(a.name.replace('(Fos)', '').toLowerCase())?.frequency || '✓') : a.dose(day),
          tip: `${a.name}, day ${day}. ${recorded ? `Recorded frequency: ${rec(a.name.replace('(Fos)', '').toLowerCase())?.frequency || 'not recorded'}; the dose was not recorded. Typical: ${a.doseNote}` : a.doseNote}`,
        })),
      });
    }
  }

  // ---- patient self-reports from the app
  const out = cycle.outcome;
  const bad = !!(out && (out.nausea || out.vomiting));
  const reports: Mark[] = [];
  const phase = (day: number) => (day < first ? 'before chemo' : day <= last ? 'during chemo' : day <= last + 1 ? 'after chemo (acute)' : 'after chemo (delayed)');
  const addReport = (day: number, hour: number, sev: number, note: string, demo: boolean) => reports.push({
    day, kind: 'report', demo, severity: sev, hour, label: String(sev), note, phase: phase(day),
    tip: `Patient report from the app: nausea ${sev} of 5${note ? `, "${note}"` : ''}. Day ${day}, about ${String(hour).padStart(2, '0')}:00, ${phase(day)}.`,
  });

  const mine = realLogs.filter((l) => {
    if (l.cycle_id) return l.cycle_id === cycle.id;
    const t = new Date(l.occurred_at || l.timestamp || '');
    if (!start || isNaN(t.getTime())) return false;
    const d = dayOf(start, t);
    return d >= 0 && d <= maxDay;
  });
  if (mine.length && start) {
    mine.forEach((l) => { const t = new Date(l.occurred_at || l.timestamp || ''); addReport(Math.min(maxDay, Math.max(0, dayOf(start, t))), t.getHours(), l.severity, l.note || '', false); });
  } else if (given) {
    const rnd = (n: number) => (hash(`${cycle.id}-${n}`) % 1000) / 1000;
    if (bad) {
      const f = out?.first_day ?? 2;
      addReport(f, 9, 3, 'felt sick after breakfast', true);
      addReport(f, 15, out?.vomiting ? 5 : 4, out?.vomiting ? 'vomited' : 'very nauseous', true);
      addReport(f, 21, 3, '', true);
      addReport(f + 1, 10, 3, '', true);
      addReport(f + 1, 19, 2, '', true);
      addReport(f + 2, 12, 2, 'a bit better', true);
    } else {
      addReport(first, 12, 1, 'fine during the infusion', true);
      addReport(first + 1, 9, rnd(1) > 0.7 ? 2 : 1, '', true);
      addReport(first + 2, 18, 1, '', true);
      addReport(first + 4, 10, 1, 'doing fine', true);
      if (hash(cycle.id) % 3 === 0) addReport(Math.max(0, first - 1), 20, 2, 'nervous before treatment', true);
    }
  }
  if (!given && reports.length === 0 && patient.age_years >= 10) addReport(Math.max(0, first - 1), 20, 2, 'nervous before treatment', true);
  if (reports.length) lanes.push({ key: 'reports', label: 'Patient reports', kind: 'report', marks: reports, tip: 'How the patient said they felt, sent through the patient app: 1 (no nausea) to 5 (vomiting). Placed on the day it was sent.' });

  // ---- clinician: approved plan and notes
  const clin: Mark[] = [];
  if (cycle.plan_snapshot?.approved && start) {
    const at = new Date(cycle.plan_snapshot.evaluated_at);
    clin.push({ day: Math.min(maxDay, Math.max(0, dayOf(start, at))), kind: 'decision', demo: false, label: '✓ plan', tip: `Plan approved by ${cycle.plan_snapshot.approved_by_alias || 'a clinician'} on ${cycle.plan_snapshot.evaluated_at.slice(0, 16).replace('T', ' ')}: tier ${cycle.plan_snapshot.effective_tier}.` });
  }
  if (start) notes.forEach((n) => {
    const t = new Date(n.createdAt); const d = dayOf(start, t);
    if (d >= 0 && d <= maxDay) clin.push({ day: d, kind: 'note', demo: false, label: 'note', tip: `Note by ${n.author}: "${n.text}"` });
  });
  if (clin.length) lanes.push({ key: 'clinician', label: 'Clinician', kind: 'decision', marks: clin, tip: 'Decisions and notes by the care team during this cycle.' });

  return { days, chemoDays, lanes, dayDates, drugs: drugsOut };
};
