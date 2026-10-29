import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, loadParentLogs } from '../api';
import { CDSResult, Cycle, NauseaLogEntry, Patient } from '../types';
import { buildChart, Chart } from '../demoHistory';
import { editedNote, fmtFull, newNote, Note, readNotes, writeNotes } from '../notesStore';
import { Hint } from './Hint';
import { OutItem, PlanEditor, PlanRow, Suggestion } from './PlanEditor';

const NOT_GIVEN = ['not in plan', 'BLOCKED', ''];

// Vertical history: the recommendations for the selected visit on top, then everything that happened,
// newest first: previous visits, patient reports from the app and clinician notes, interleaved by date.
// Markers: black square = chemo (hard data), blue diamond = clinician, orange circle = patient.

interface Props {
  patient: Patient;
  cycles: Cycle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onApproved: (cycleId: string) => void;
}

const ABBR: Record<string, string> = {
  vincristine: 'VCR', cisplatin: 'cisplatin', carboplatin: 'carboplatin', etoposide: 'etoposide', cyclophosphamide: 'cyclophosphamide',
  ifosfamide: 'ifosfamide', daunorubicin: 'daunorubicin', doxorubicin: 'doxorubicin', cytarabine: 'cytarabine', dactinomycin: 'dactinomycin',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const dmy = (d: Date) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
const dmyFull = (d: Date) => `${dmy(d)} ${d.getFullYear()}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s?: string | null) => { const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3], 8, 0) : null; };
const fmtFreq = (f?: string) => { const m = f?.match(/(\d+)\s*x\s*\/\s*d/i); return m ? `×${m[1]}/day` : f || ''; };
const num = (v?: number | null) => (v == null ? '' : String(+v));
// engine texts: drop ".0", collapse "2.0 - 2.0 mg" to "2 mg", and translate the one Dutch timing phrase
const clean = (t?: string) => (t || '').replace(/(\d+(?:\.\d+)?)\s*-\s*\1\b/g, '$1').replace(/(\d+)\.0\b/g, '$1');
const timingEn = (t?: string) => (t && /avond voor/i.test(t) ? 'the evening before and the morning of the first chemo' : '');

const Sv: React.FC<{ n: number }> = ({ n }) => (
  <span className="vh-sv" aria-hidden="true">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</span>
);

const chemoSummary = (chart: Chart) =>
  chart.lanes.filter((l) => l.kind === 'chemo').map((l) => `${ABBR[l.label.toLowerCase()] || l.label} ${l.marks[0]?.label || ''}`);

type Ev =
  | { key: string; at: number; kind: 'visit'; cycle: Cycle }
  | { key: string; at: number; kind: 'report'; sev: number; text: string; when: string; day: number; demo: boolean }
  | { key: string; at: number; kind: 'group'; n: number; from: string; to: string; text: string; demo: boolean }
  | { key: string; at: number; kind: 'note'; note: Note };

// The past events (previous visits, patient reports, notes) are switched off for now: only the
// recommendations for the selected visit and the note box show. Set to true to bring the timeline back.
const SHOW_PAST_EVENTS = true;

// Facts sent to /api/watchouts. Gemini may only rephrase and connect them; the backend rejects any
// answer with a dose, number or drug that is not in these texts, and the box then shows the source lines.
type FactKind = 'patient' | 'clinician' | 'chemo' | 'engine' | 'rescue';
interface WatchFact { id: string; kind: FactKind; text: string; required?: boolean }
// 'pattern': the AI's own observation across the history, offered for discussion, never a recommendation
interface WatchItem { kind: FactKind | 'pattern'; headline: string; text: string; sources: string[] }
const MARK: Record<WatchItem['kind'], string> = { patient: 'vh-mk-pat sm', clinician: 'vh-mk-clin sm', chemo: 'vh-mk-chem sm', engine: 'vh-mk-chem sm', rescue: 'vh-mk-chem sm', pattern: 'vh-mk-idea' };
const HISTORY_DAYS = 20; // patient reports and notes this far before the selected visit go to the AI in full

export const History: React.FC<Props> = ({ patient, cycles, selectedId, onSelect, onApproved }) => {
  const [logs, setLogs] = useState<NauseaLogEntry[]>([]);
  const [res, setRes] = useState<CDSResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const rowsRef = useRef<PlanRow[]>([]);
  const engineRowsRef = useRef<PlanRow[]>([]);
  const [notes, setNotes] = useState<Note[]>(() => readNotes(patient.id));
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [openRev, setOpenRev] = useState<Record<string, boolean>>({});

  useEffect(() => { setNotes(readNotes(patient.id)); setDraft(''); setEditing(null); setOpenRev({}); }, [patient.id]);
  const saveNotes = (next: Note[]) => { setNotes(next); writeNotes(patient.id, next); };
  const addNote = () => { const t = draft.trim(); if (!t) return; saveNotes([newNote(t), ...notes]); setDraft(''); };
  const saveEdit = (n: Note) => {
    const t = editText.trim(); setEditing(null);
    if (!t || t === n.text) return;
    saveNotes(notes.map((x) => (x.id === n.id ? editedNote(x, t) : x)));
  };
  const [ai, setAi] = useState<{ items: WatchItem[]; model: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAi, setShowAi] = useState(true);

  const cur = cycles.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    (async () => {
      try {
        setLogs(await loadParentLogs(patient.id));
      } catch { setLogs([]); }
    })();
  }, [patient.id]);

  useEffect(() => {
    if (!cur) { setRes(null); return; }
    let cancelled = false;
    setLoading(true); setErr(null); setRes(null);
    (async () => {
      try {
        const r = await apiFetch('/api/evaluate?llm_rationale=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_id: patient.id, cycle_id: cur.id }) });
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) setErr(typeof d?.detail === 'string' ? d.detail : 'The engine could not evaluate this visit.'); else setRes(d);
      } catch { if (!cancelled) setErr('Cannot reach the engine.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [patient.id, cur?.id]);

  const charts = useMemo(() => {
    const m: Record<string, Chart> = {};
    cycles.forEach((c) => { m[c.id] = buildChart(patient, c, logs, notes); });
    return m;
  }, [patient, cycles, logs, notes]);

  const approve = async (items: OutItem[] | null): Promise<boolean> => {
    if (!cur) return false;
    setApproving(true);
    try {
      const r = items
        ? await apiFetch(`/api/cycles/${cur.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tier_assigned: res?.effective_tier || res?.overall_tier || 'High',
              plan_snapshot: { effective_tier: res?.effective_tier || res?.overall_tier || 'High', items, evaluated_at: new Date().toISOString(), approved: true, approved_by_alias: 'Dr. A. Peeters' },
            }),
          })
        : await apiFetch(`/api/cycles/${cur.id}/approve-plan?approved_by_alias=${encodeURIComponent('Dr. A. Peeters')}`, { method: 'POST' });
      if (r.ok) { onApproved(cur.id); return true; }
      setErr('Approval failed. Reload and try again.');
    } catch { setErr('Approval failed (network).'); }
    finally { setApproving(false); }
    return false;
  };

  // Undo an approval: keep what was approved as an editable draft, then clear the approval on the cycle.
  const undoApproval = async () => {
    if (!cur || !res) return;
    if (!window.confirm('Undo the approval? The family will no longer see the medication times until the plan is approved again. The approved plan comes back here as an editable draft.')) return;
    const approvedRows = rowsRef.current;
    const edits: Record<string, string> = {};
    const removed: string[] = [];
    const added: Array<{ name: string; text: string }> = [];
    engineRowsRef.current.forEach((e) => {
      const m = approvedRows.find((r) => r.name === e.name);
      if (!m) { if (!NOT_GIVEN.includes(e.now)) removed.push(e.name); }
      else if (m.now !== e.now) edits[e.name] = m.now;
    });
    approvedRows.forEach((r) => { if (!engineRowsRef.current.some((e) => e.name === r.name)) added.push({ name: r.name, text: r.now }); });
    try { localStorage.setItem(`aim_plan_draft_${cur.id}`, JSON.stringify({ edits, removed, added })); } catch { /* storage unavailable */ }
    setApproving(true);
    try {
      const r = await apiFetch(`/api/cycles/${cur.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_snapshot: null, tier_assigned: null }) });
      if (r.ok) onApproved(cur.id); else setErr('Could not undo the approval. Reload and try again.');
    } catch { setErr('Could not undo the approval (network).'); }
    finally { setApproving(false); }
  };

  // ---- previous visit with the same chemo type (else the one just before)
  const curIdx = cycles.findIndex((c) => c.id === selectedId);
  const earlier = curIdx > 0 ? cycles.slice(0, curIdx) : [];
  const prev = [...earlier].reverse().find((c) => c.course_type === cur?.course_type && c.status === 'given') || [...earlier].reverse().find((c) => c.status === 'given') || null;
  const prevChart = prev ? charts[prev.id] : null;

  // ---- recommendation table: last time vs now
  const s = res?.schedule;
  const snap = cur?.plan_snapshot;
  const antic = s?.anticipatory_option;
  const blocked = !!res && (res.dex_contraindicated || s?.dexamethasone?.status === 'HARD_CONTRAINDICATION');
  const now: Record<string, string> = {};
  if (s?.ondansetron) now['Ondansetron'] = `${num(s.ondansetron.dose_mg)} mg ${fmtFreq(s.ondansetron.frequency)}`;
  if (s?.aprepitant) now['(Fos)aprepitant'] = s.aprepitant.status === 'RECOMMENDED' ? (s.aprepitant.day1_mg != null ? `${num(s.aprepitant.day1_mg)} → ${num(s.aprepitant.day2_3_mg)} → ${num(s.aprepitant.day2_3_mg)} mg` : s.aprepitant.schedule || 'in plan') : 'not in plan';
  if (s?.dexamethasone) {
    const m = s.dexamethasone.dose?.match(/(\d+(?:\.\d+)?)\s*mg\s*(\d+)\s*x\s*\/\s*d/i);
    now['Dexamethasone'] = blocked ? 'BLOCKED' : m ? `${m[1]} mg ×${m[2]}/day` : s.dexamethasone.dose || 'in plan';
  }
  if (s?.olanzapine) now['Olanzapine'] = s.olanzapine.status === 'RECOMMENDED' ? `${num(s.olanzapine.dose_mg)} mg ${fmtFreq(s.olanzapine.frequency) || '×1/day'}` : 'not in plan';
  const drugNames = ['Ondansetron', '(Fos)aprepitant', 'Dexamethasone', 'Olanzapine'];
  const last = (name: string) => prevChart?.drugs.find((d) => d.name === name)?.summary || (prev ? 'not given' : '–');
  const freqOf = (t?: string) => t?.match(/×(\d+)\/day/)?.[1];
  const engineRows: PlanRow[] = drugNames.filter((n) => now[n] !== undefined).map((name) => {
    const l = last(name), n = now[name];
    const changed = !!prev && l !== n && !(l === 'not given' && n === 'not in plan');
    let why = '';
    if (name === 'Ondansetron') why = changed && res?.under_prophylaxis_warning ? `Nausea last time on ${fmtFreq(`${freqOf(l)}x/d`)}. The guideline asks ${fmtFreq(`${freqOf(n)}x/d`)} at this tier.` : `5 mg/m² × BSA ${patient.bsa_m2 ?? '?'}, maximum 8 mg.`;
    else if (name === '(Fos)aprepitant') why = n === 'not in plan' ? 'Not part of this plan.' : 'Days 1, 2 and 3.';
    else if (name === 'Dexamethasone') why = n === 'BLOCKED' ? (res?.dex_contraindication_reason || 'Hard-blocked by the guideline.') : /aprepitant/i.test(s?.dexamethasone?.dose || '') ? 'Half dose because aprepitant raises its level.' : '';
    else if (name === 'Olanzapine') why = s?.olanzapine?.raw_calc || '';
    return { name, last: l, now: n, why };
  });
  const snapText = (it: { drug: string; dose_mg?: number | null; dose_text?: string | null; frequency?: string | null }) => {
    const f = it.frequency?.match(/(\d+)\s*x\s*\/\s*d/i)?.[1];
    if (/aprepitant/i.test(it.drug)) {
      const nums = [...(it.dose_text || '').matchAll(/(\d+(?:\.\d+)?)\s*mg/g)].map((m) => +m[1]);
      if (nums.length >= 2) return `${nums[0]} → ${nums[1]} → ${nums[1]} mg`;
      return clean(it.dose_text || '') || 'in plan';
    }
    const m = it.dose_text?.match(/(\d+(?:\.\d+)?)\s*mg\s*(\d+)\s*x\s*\/\s*d/i);
    if (m) return `${m[1]} mg ×${m[2]}/day`;
    if (it.dose_mg != null) return `${num(it.dose_mg)} mg${f ? ` ×${f}/day` : ''}`;
    return clean(it.dose_text || '') || 'in plan';
  };
  const displayName = (d: string) => (/ondansetron/i.test(d) ? 'Ondansetron' : /aprepitant/i.test(d) ? '(Fos)aprepitant' : /dexamethasone/i.test(d) ? 'Dexamethasone' : /olanzapine/i.test(d) ? 'Olanzapine' : d);
  const rows: PlanRow[] = snap?.approved
    ? snap.items.map((it) => { const name = displayName(it.drug); return { name, last: last(name), now: snapText(it), why: engineRows.find((r) => r.name === name)?.why || '' }; })
    : engineRows;
  rowsRef.current = rows;
  engineRowsRef.current = engineRows;
  const suggestions: Suggestion[] = [];
  const ps = s?.palonosetron_switch_suggestion;
  if (ps) suggestions.push({ name: 'Palonosetron', text: clean(ps.dose || ''), note: `${ps.condition || ''} ${ps.safety_restriction || ''}`.trim() || 'Suggested by the engine.', tag: 'switch from ondansetron' });
  const alt = res?.alternative_drug;
  if (alt) suggestions.push({ name: displayName(String(alt.drug)), text: clean(String(alt.schedule || '')), note: 'If dexamethasone cannot be given: ondansetron + aprepitant (POGO).', tag: 'alternative' });
  if (antic) suggestions.push({ name: antic.drug.charAt(0).toUpperCase() + antic.drug.slice(1).toLowerCase(), text: clean(antic.dose), note: `For anticipatory nausea${timingEn(antic.timing) ? `: ${timingEn(antic.timing)}` : ''}.`, tag: 'anticipatory' });
  (s?.breakthrough_options || []).forEach((b) => suggestions.push({ name: b.drug.charAt(0).toUpperCase() + b.drug.slice(1).toLowerCase(), text: `${clean(b.dose)}${b.frequency ? ` · ${b.frequency}` : ''}`, note: 'Rescue drug if the patient is sick despite the plan.', tag: 'rescue' }));
  const nChanges = rows.filter((r) => r.last !== '–' && r.last !== r.now && !(r.last === 'not given' && r.now === 'not in plan')).length;

  // ---- watch-outs
  const curChart = cur ? charts[cur.id] : null;
  const curDate = parseDate(cur?.date);
  const preReport = curChart?.lanes.find((l) => l.kind === 'report')?.marks.find((m) => m.day < (curChart.chemoDays[0] ?? 1));
  const curNotes = curDate ? notes.filter((n) => { const t = new Date(n.createdAt).getTime(); return t <= curDate.getTime() + 86400000 && t >= curDate.getTime() - 14 * 86400000; }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2) : [];
  const bt = s?.breakthrough_options?.[0];
  const curChemo = cur && curChart ? chemoSummary(curChart) : [];
  const subject = patient.sex === 'F' ? 'She' : patient.sex === 'M' ? 'He' : 'The patient';

  const facts: WatchFact[] = [];
  if (res) {
    if ((preReport || res.anticipatory_symptoms) && antic) facts.push({ id: 'antic', kind: 'rescue', required: true, text: `Anticipatory option: ${antic.drug} ${clean(antic.dose)}${antic.capped ? ' (guideline maximum)' : ''}${timingEn(antic.timing) ? `, ${timingEn(antic.timing)}` : ''}.` });
    if (preReport) facts.push({ id: 'report', kind: 'patient', text: `Patient app report before this treatment: nausea ${preReport.severity}/5${preReport.note ? `, "${preReport.note}"` : ''}.` });
    else if (res.anticipatory_symptoms) facts.push({ id: 'antic-flag', kind: 'engine', text: 'The engine flags anticipatory nausea for this visit.' });
    // history: every earlier visit as one line, so patterns across cycles stay visible; patient reports
    // and clinician notes in full detail for the last HISTORY_DAYS
    const winStart = curDate ? curDate.getTime() - HISTORY_DAYS * 86400000 : 0;
    earlier.forEach((c) => {
      const d = parseDate(c.date); const o = c.outcome; const ch = charts[c.id];
      const effect = c.status !== 'given' ? 'not given' : o && (o.nausea || o.vomiting) ? `${o.nausea && o.vomiting ? 'nausea and vomiting' : o.vomiting ? 'vomiting' : 'nausea'}${o.first_day ? ` from day ${o.first_day}` : ''}` : 'no nausea';
      facts.push({ id: `visit-${c.label}`, kind: 'chemo', text: `Visit ${c.label}, ${c.course_type} chemo${c.course_type === cur?.course_type ? ' (same as now)' : ''}${d ? `, ${dmy(d)}` : ''}: ${effect}. Anti-emetics: ${ch?.drugs.map((x) => `${x.name} ${x.summary}`).join(', ') || 'none recorded'}.` });
      const reps = (ch?.lanes.find((l) => l.kind === 'report')?.marks || []).filter((m) => d && d.getTime() + (m.day - 1) * 86400000 >= winStart);
      if (reps.length) facts.push({ id: `reports-${c.label}`, kind: 'patient', text: `Patient app reports after ${c.label}: ${reps.map((m) => `day ${m.day} ${m.severity}/5${m.note ? ` "${m.note}"` : ''}`).join('; ')}.` });
    });
    notes.filter((n) => curDate && new Date(n.createdAt).getTime() <= curDate.getTime() + 86400000 && new Date(n.createdAt).getTime() >= winStart)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-8)
      .forEach((n, i) => facts.push({ id: `note${i}`, kind: 'clinician', text: `Clinician note, ${dmy(new Date(n.createdAt))}: ${n.text}` }));
    if (rows.length) facts.push({ id: 'plan', kind: 'engine', text: `Plan now: ${rows.map((r) => `${r.name} ${r.now}${r.now !== r.last ? ' (changed)' : ''}`).join('; ')}.` });
    // options the engine itself offers: the only changes a "to discuss" item may bring up
    const ext = s?.aprepitant?.multi_day_extension;
    if (ext) facts.push({ id: 'ext', kind: 'engine', text: `Engine option: ${ext}` });
    const palo = s?.palonosetron_switch_suggestion;
    if (palo?.condition) facts.push({ id: 'palo', kind: 'engine', text: `Engine option: ${palo.condition}${palo.safety_restriction ? `. ${palo.safety_restriction}` : ''}.` });
    if (res.under_prophylaxis_warning) facts.push({ id: 'under', kind: 'engine', text: res.under_prophylaxis_warning });
    if (res.dex_contraindicated && res.dex_contraindication_reason) facts.push({ id: 'dex', kind: 'engine', text: `Dexamethasone blocked: ${res.dex_contraindication_reason}` });
    else if (res.dex_soft_warning) facts.push({ id: 'dex', kind: 'engine', text: res.dex_soft_warning });
    (res.ddi_alerts || []).slice(0, 3).forEach((a, i) => facts.push({ id: `ddi${i}`, kind: 'engine', text: `Interaction alert: ${typeof a === 'string' ? a : a.message}` }));
    if (bt) facts.push({ id: 'bt', kind: 'rescue', required: true, text: `Breakthrough rescue: ${bt.drug} ${clean(bt.dose)}${bt.capped ? ' (capped at the guideline maximum)' : ''}.` });
  }
  const factsKey = JSON.stringify(facts);
  const factText = (id: string) => facts.find((f) => f.id === id)?.text || id;
  const planned = cur?.status === 'planned';

  useEffect(() => {
    setAi(null);
    if (!res || !facts.length) return;
    let cancelled = false;
    setAiLoading(true);
    (async () => {
      try {
        const r = await apiFetch('/api/watchouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patient_id: patient.id, cycle_id: cur?.id, facts }) });
        const d = await r.json();
        if (!cancelled && r.ok && d.llm_status === 'ok' && d.items?.length) setAi({ items: d.items, model: d.model });
      } catch { /* no AI text: the source lines stay */ }
      finally { if (!cancelled) setAiLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [patient.id, factsKey]);

  // ---- events below, newest first
  const events: Ev[] = [];
  cycles.forEach((c) => {
    const d = parseDate(c.date);
    if (!d || c.id === selectedId) return;
    events.push({ key: `v-${c.id}`, at: d.getTime(), kind: 'visit', cycle: c });
    const rep = charts[c.id]?.lanes.find((l) => l.kind === 'report')?.marks || [];
    const noNV = !(c.outcome && (c.outcome.nausea || c.outcome.vomiting));
    const at = (m: { day: number; hour?: number }) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + m.day - 1, m.hour ?? 12).getTime();
    if (noNV && c.status === 'given' && rep.length > 1) {
      const sorted = [...rep].sort((a, b) => at(a) - at(b));
      events.push({ key: `g-${c.id}`, at: at(sorted[sorted.length - 1]), kind: 'group', n: rep.length, from: dmy(new Date(at(sorted[0]))), to: dmy(new Date(at(sorted[sorted.length - 1]))), text: `${rep.length} reports around ${c.label}: ${sorted[0].note ? `“${sorted[0].note}”, then ` : ''}no nausea`, demo: sorted.every((m) => m.demo) });
    } else {
      rep.forEach((m, i) => events.push({ key: `r-${c.id}-${i}`, at: at(m), kind: 'report', sev: m.severity || 1, text: `${m.phase || ''}${m.note ? ` · “${m.note}”` : ''}`, when: `${dmy(new Date(at(m)))} · ${pad(m.hour ?? 12)}:00`, day: m.day, demo: m.demo }));
    }
  });
  notes.forEach((n) => events.push({ key: `n-${n.id}`, at: new Date(n.createdAt).getTime(), kind: 'note', note: n }));
  events.sort((a, b) => b.at - a.at);

  // full cards for the two most recent given visits, compact rows for the rest
  const givenIds = cycles.filter((c) => c.status === 'given' && c.id !== selectedId).map((c) => c.id).reverse();
  const fullIds = new Set(givenIds.slice(0, 2));

  const visitCard = (c: Cycle) => {
    const ch = charts[c.id]; const d = parseDate(c.date)!; const full = fullIds.has(c.id);
    const o = c.outcome; const bad = !!(o && (o.nausea || o.vomiting));
    const what = o ? (o.nausea && o.vomiting ? 'Nausea + vomiting' : o.vomiting ? 'Vomiting' : 'Nausea') : '';
    const chip = c.status === 'planned' ? <span className="chip chip-warn" data-tip="Planned, not given yet.">PLANNED</span>
      : bad ? <span className="chip chip-hazard" data-tip={`${what}${o?.first_day ? ` from day ${o.first_day}` : ''}${o?.note ? `: “${o.note}”` : ''}${o?.source ? ` (source: ${o.source})` : ''}.`}>{what.toUpperCase()}{o?.first_day ? ` FROM DAY ${o.first_day}` : ''}</span>
      : <span className="chip" data-tip="No nausea or vomiting was recorded for this cycle.">✓ no nausea</span>;
    const reps = ch.lanes.find((l) => l.kind === 'report')?.marks || [];
    const antiem = ch.drugs.map((x) => `${x.name.replace('(Fos)', '').toLowerCase()} ${x.summary}`);
    const sameChemo = cur && c.course_type === cur.course_type;
    if (!full) {
      return (
        <button type="button" className="vh-card vh-compact" onClick={() => onSelect(c.id)} data-tip={`Cycle ${c.label}, ${dmyFull(d)}. Click to see the recommendations for this visit at the top.`}>
          <b>{c.label}</b>
          <span className="mono" data-tip={`Chemo given: ${chemoSummary(ch).join(', ')}.`}>{chemoSummary(ch).join(' · ')}</span>
          <span className="mono" data-tip="Anti-emetics given in this cycle.">{antiem.join(', ') || '–'}</span>
          {chip}
        </button>
      );
    }
    return (
      <div className="vh-card vh-visit" data-tip={`Cycle ${c.label} (${c.course_type}), ${dmyFull(d)}.`}>
        <div className="vh-visit-head">
          <button className="link-btn vh-title" onClick={() => onSelect(c.id)} data-tip="Select this visit: the recommendations at the top then show how it would be evaluated.">{c.label}</button>
          {chip}
          {sameChemo && <span className="chip" data-tip="Same chemo type as the visit selected at the top.">same chemo as {cur?.label}</span>}
          <span style={{ flex: 1 }} />
          <span className="lbl">Previous visit</span>
        </div>
        <div className="vh-3">
          <div><div className="lbl vh-chem">■ Chemo given</div><div className="mono">{chemoSummary(ch).map((x, i) => <div key={i}>{x}</div>)}</div></div>
          <div><div className="lbl">Recommended then</div><div className="mono">{antiem.length ? antiem.map((x, i) => <div key={i}>{x}</div>) : '–'}</div></div>
          <div><div className="lbl">Effect</div><div>{bad ? `${what}${o?.first_day ? ` from day ${o.first_day}` : ''}${o?.vomiting ? '' : ', no vomiting'}.` : 'No nausea.'} {reps.length ? `${reps.length} self-report${reps.length > 1 ? 's' : ''}: ${reps.map((m) => m.severity).join(', ')}.` : ''}</div></div>
        </div>
      </div>
    );
  };

  const when = (c: Cycle | null) => { const d = parseDate(c?.date); return d ? dmyFull(d) : 'no date'; };

  return (
    <section id="recommendations" tabIndex={-1} className="ws-section vh" data-tip="Recommendations for the selected visit on top, then the whole history newest first: previous visits, patient reports from the app and clinician notes, interleaved by date. Black square = chemo (hard data), blue diamond = clinician, orange circle = patient.">
      <header className="ws-section-head">
        <h3>{SHOW_PAST_EVENTS ? 'History & recommendations' : 'Recommendations'}</h3>
        <Hint text="Top: what we recommend for the selected visit, compared with the last visit that had the same chemo. Below: everything that happened, newest first. Black square = chemo and visits (hard data), blue diamond = clinician notes, orange circle = patient reports from the app. Click a previous visit to select it." />
        <span style={{ flex: 1 }} />
      </header>
      {err && <div className="alert-row hazard"><div>{err}</div></div>}

      <div className="vh-tl">
        {/* ============ NOW ============ */}
        {cur && (
          <div className="vh-ev vh-now-row">
            <div className="vh-d"><b>{planned ? 'TODAY' : cur.label}</b><br />{when(cur)}</div>
            <div className="vh-m"><div className="vh-mk-now" data-tip="The selected visit. Above this line: recommendations. Below: what already happened." /></div>
            <div className="vh-now">
              <div className="vh-now-head">
                <b className="vh-now-title">Visit {cur.label}</b>
                {planned ? <span className="chip chip-hazard" data-tip="This cycle is planned, not given yet.">PLANNED</span> : <span className="chip" data-tip="This cycle was already given. The recommendations are what the engine would suggest now.">GIVEN</span>}
                <span className="mono" data-tip="Chemo planned for this visit: dose in mg/m² × the patient's BSA.">
                  <span className="vh-chem">■ chemo</span> {curChemo.join(' + ') || '–'}
                </span>
                <span style={{ flex: 1 }} />
                <span className="lbl">Recommendations</span>
                {loading && <span className="ws-dim">calculating…</span>}
              </div>

              {res && res.plan_status === 'INCOMPLETE' && <div className="alert-row hazard" data-tip="A drug of this regimen is not in the POGO classification, so the plan is partial."><div><b>PLAN INCOMPLETE</b> check manually.</div></div>}

              {res && (
                <div className="vh-recs">
                  <div>
                    <div className="vh-rec-title">
                      <span className="lbl vh-ink">1 · Anti-emetic plan</span>
                      {prev && <span className={`chip ${nChanges ? 'chip-hazard' : ''}`} data-tip={nChanges ? `Compared with ${prev.label}, the last visit with the same chemo, ${nChanges} drug${nChanges > 1 ? 's differ' : ' differs'}.` : `Identical to ${prev.label}, the last visit with the same chemo.`}>{nChanges ? `${nChanges} change${nChanges > 1 ? 's' : ''}` : 'no change'}</span>}
                    </div>
                    <PlanEditor cycleId={cur.id} rows={rows} prevLabel={prev?.label} suggestions={suggestions} approvedBy={snap?.approved ? (snap.approved_by_alias || 'a clinician') : null} canEdit={!!res && res.plan_status !== 'INCOMPLETE'} approving={approving} onApprove={approve} onUndo={undoApproval} />
                  </div>

                  <div>
                    <div className="vh-rec-title">
                      <span className="lbl vh-ink">2 · Rescue and watch-outs</span>
                      {aiLoading && <span className="ws-dim">AI summary…</span>}
                      {ai && <button className={`chip chip-ai${showAi ? ' on' : ''}`} onClick={() => setShowAi(!showAi)} data-tip={showAi ? `Written by ${ai.model} from the verified lines below. Every dose, number and drug was checked against the engine output. Click to see the source lines.` : 'Click to show the AI summary again.'}>{showAi ? '✦ AI summary' : '✦ show AI summary'}</button>}
                    </div>
                    {ai && showAi ? (
                    <div className="vh-watch">
                      {ai.items.map((it, i) => (
                        <div key={i} className="vh-w" data-tip={`${it.kind === 'pattern' ? 'AI observation across the history, for discussion: not an engine recommendation. Based on' : 'AI summary of'}: ${it.sources.map(factText).join(' | ')}`}><span className={MARK[it.kind] || MARK.engine} /><div>{it.kind === 'pattern' && <span className="lbl vh-idea-lbl">To discuss </span>}<b>{it.headline.replace(/[.:]+$/, '')}.</b> {it.text}</div></div>
                      ))}
                    </div>
                    ) : (
                    <div className="vh-watch">
                      {(preReport || res.anticipatory_symptoms) && antic && (
                        <div className="vh-w" data-tip={preReport ? `From the patient's own report in the app: ${preReport.tip}` : 'The engine flags anticipatory nausea.'}><span className="vh-mk-pat sm" /><div><b>Anticipatory nausea.</b> {preReport ? `${subject} reported ${preReport.severity}/5 before treatment${preReport.note ? ` (“${preReport.note}”)` : ''}. ` : ''}Consider {antic.drug.toLowerCase()}{timingEn(antic.timing) ? `, ${timingEn(antic.timing)}` : ''}: {clean(antic.dose)}{antic.capped ? ' (guideline maximum)' : ''}.</div></div>
                      )}
                      {curNotes.map((n) => (
                        <div key={n.createdAt} className="vh-w" data-tip={`Clinician note by ${n.author}, ${dmy(new Date(n.createdAt))}.`}><span className="vh-mk-clin sm" /><div><b>Note, {dmy(new Date(n.createdAt))}:</b> {n.text}</div></div>
                      ))}
                      {bt && (
                        <div className="vh-w" data-tip="Rescue drug if the patient is sick despite the plan. The dose is capped at the guideline maximum."><span className="vh-mk-chem sm" /><div><b>If breakthrough nausea:</b> {bt.drug.toLowerCase()}, {clean(bt.dose)}{bt.capped ? ' (capped at the guideline maximum)' : ''}.</div></div>
                      )}
                    </div>
                    )}
                  </div>

                  {/* 3 · Risk per chemo drug, with the POGO classification source */}
                  {Object.keys(res.individual_tiers || {}).length > 0 && (
                    <div style={{ gridColumn: '1 / -1', marginTop: '0.75rem', borderTop: '1px solid #e4e4e4', paddingTop: '0.75rem' }}>
                      <div className="vh-rec-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span className="lbl vh-ink">3 · Risk per chemo drug</span>
                        <span className="src">POGO classification of acute emetogenicity</span>
                      </div>
                      <table className="ws-table vh-table" role="table" aria-label="Risk per chemo drug" style={{ width: '100%' }}>
                        <thead role="rowgroup">
                          <tr role="row">
                            <th role="columnheader" scope="col">Chemo drug</th>
                            <th role="columnheader" scope="col">Emetic risk</th>
                            <th role="columnheader" scope="col">Source</th>
                          </tr>
                        </thead>
                        <tbody role="rowgroup">
                          {Object.entries(res.individual_tiers).map(([drug, t]) => (
                            <tr key={drug} role="row" data-tip={t.reason}>
                              <td role="cell" className="vh-drug"><b>{drug.charAt(0).toUpperCase() + drug.slice(1)}</b></td>
                              <td role="cell" data-label="Emetic risk"><span className={`chip ${t.tier === 'High' ? 'chip-hazard' : ''}`}>{t.tier}</span></td>
                              <td role="cell" className="vh-why" data-label="Source">{t.source}</td>
                            </tr>
                          ))}
                          {res.combination_escalation && (
                            <tr role="row" data-tip={res.combination_escalation.reason}>
                              <td role="cell" className="vh-drug"><b>Combination</b></td>
                              <td role="cell" data-label="Emetic risk"><span className="chip chip-hazard">{res.combination_escalation.tier}</span></td>
                              <td role="cell" className="vh-why" data-label="Source">{res.combination_escalation.source}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}

        {/* ============ ADD A NOTE ============ */}
        <div className="vh-ev">
          <div className="vh-d">Add a note</div>
          <div className="vh-m"><div className="vh-mk-clin out" data-tip="A new clinician note goes onto the timeline with the current time." /></div>
          <div className="vh-card vh-clin vh-compose" data-tip="Write a clinician note. It appears on the timeline, is stamped with the time and your name, and is never deleted: editing keeps every earlier version. For now notes are saved only in this browser.">
            <textarea className="ws-textarea" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note about this patient…" data-tip="Type the note here." />
            <button className="ws-btn primary" onClick={addNote} disabled={!draft.trim()} data-tip="Add the note to the timeline.">Add note</button>
          </div>
        </div>

        {/* ============ EVENTS ============ */}
        {SHOW_PAST_EVENTS && events.map((e) => {
          if (e.kind === 'visit') {
            const d = new Date(e.at);
            return (
              <div key={e.key} className="vh-ev">
                <div className="vh-d"><b>{dmy(d)}</b></div>
                <div className="vh-m"><div className="vh-mk-chem" data-tip={`Visit ${e.cycle.label}: chemo given.`} /></div>
                {visitCard(e.cycle)}
              </div>
            );
          }
          if (e.kind === 'note') {
            const n = e.note; const t = new Date(n.createdAt);
            return (
              <div key={e.key} className="vh-ev">
                <div className="vh-d">{dmy(t)} · {hm(t)}</div>
                <div className="vh-m"><div className="vh-mk-clin" data-tip="Clinician note" /></div>
                <div className="vh-card vh-clin" data-tip={`Note by ${n.author}, ${fmtFull(n.createdAt)}.${n.updatedAt ? ` Last edited ${fmtFull(n.updatedAt)}.` : ''}`}>
                  <div className="vh-note-head">
                    <span className="vh-tg vh-tg-clin">Clinician note · {n.author}</span>
                    {n.updatedAt && <span className="chip" data-tip={`Edited ${n.revisions.length} time${n.revisions.length > 1 ? 's' : ''}. Earlier versions are kept under History.`}>edited</span>}
                  </div>
                  {editing === n.id ? (
                    <>
                      <textarea className="ws-textarea" rows={3} value={editText} onChange={(ev) => setEditText(ev.target.value)} data-tip="Edit the note. The old text is kept in History when you save." />
                      <div className="vh-note-actions">
                        <button className="ws-btn primary" onClick={() => saveEdit(n)} data-tip="Save the new text. The previous version goes into History.">Save</button>
                        <button className="ws-btn ghost" onClick={() => setEditing(null)} data-tip="Discard the changes.">Cancel</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="vh-note-text">{n.text}</div>
                      <div className="vh-note-actions">
                        <button className="link-btn" onClick={() => { setEditing(n.id); setEditText(n.text); }} data-tip="Edit this note. The old text stays in History.">Edit</button>
                        {n.revisions.length > 0 && <button className="link-btn" onClick={() => setOpenRev({ ...openRev, [n.id]: !openRev[n.id] })} data-tip="Show or hide the earlier versions of this note.">History ({n.revisions.length}) {openRev[n.id] ? '▲' : '▼'}</button>}
                      </div>
                    </>
                  )}
                  {openRev[n.id] && n.revisions.slice().reverse().map((r, i) => (
                    <div key={i} className="vh-rev" data-tip={`Earlier version, saved ${fmtFull(r.at)} by ${r.author}. Replaced by a newer text.`}>
                      <span className="ws-dim">{fmtFull(r.at)} · {r.author}</span><div>{r.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (e.kind === 'group') {
            return (
              <div key={e.key} className="vh-ev">
                <div className="vh-d">{e.from} – {e.to}</div>
                <div className="vh-m"><div className="vh-mk-pat lt" data-tip={`${e.n} patient reports, all 1 of 5`} /></div>
                <div className={`vh-card vh-pat`} data-tip="Several reports without nausea, grouped into one row.">
                  <span className="vh-tg vh-tg-pat">Patient · app</span><Sv n={1} /><b>1 / 5</b><span className="vh-txt">{e.text}</span>
                </div>
              </div>
            );
          }
          return (
            <div key={e.key} className="vh-ev">
              <div className="vh-d">{e.when}</div>
              <div className="vh-m"><div className={`vh-mk-pat ${e.sev <= 1 ? 'lt' : ''}`} data-tip={`Patient report from the app: nausea ${e.sev} of 5.`} /></div>
              <div className={`vh-card vh-pat ${e.sev >= 4 ? 'strong' : ''}`} data-tip={`Self-report from the patient app: nausea ${e.sev} of 5, ${e.text}.`}>
                <span className="vh-tg vh-tg-pat">Patient · app</span><Sv n={e.sev} /><b>{e.sev} / 5</b><span className="vh-txt">{e.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
