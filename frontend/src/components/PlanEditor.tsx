import React, { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';

// The editable anti-emetic plan for one visit: change a dose, remove a drug, add a drug, or add one of the
// engine's suggestions. Edits are kept as a draft (this computer) until the plan is approved.

export interface PlanRow { name: string; last: string; now: string; why: string }
export interface Suggestion { name: string; text: string; note: string; tag?: string }
export interface OutItem { drug: string; dose_text: string; dose_mg: number | null; frequency: string }

interface Draft { edits: Record<string, string>; removed: string[]; added: Array<{ name: string; text: string }> }
const EMPTY: Draft = { edits: {}, removed: [], added: [] };
const NOT_GIVEN = ['not in plan', 'BLOCKED', ''];

const toItem = (name: string, text: string): OutItem => {
  const f = text.match(/×\s*(\d+)\s*\/\s*day/i)?.[1] || text.match(/(\d+)\s*x\s*\/\s*d/i)?.[1];
  const mg = text.match(/^\s*(\d+(?:\.\d+)?)\s*mg/i)?.[1];
  return { drug: name, dose_text: text, dose_mg: mg ? +mg : null, frequency: f ? `${f}x/d` : '1x/d' };
};

interface Props {
  cycleId: string;
  rows: PlanRow[];
  prevLabel?: string;
  suggestions: Suggestion[];
  approvedBy: string | null;
  canEdit: boolean;
  approving: boolean;
  onApprove: (items: OutItem[] | null) => Promise<boolean>;
  onUndo: () => void;
}

export const PlanEditor: React.FC<Props> = ({ cycleId, rows, prevLabel, suggestions, approvedBy, canEdit, approving, onApprove, onUndo }) => {
  const key = `aim_plan_draft_${cycleId}`;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');

  useEffect(() => {
    try { const raw = localStorage.getItem(key); setDraft(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY); } catch { setDraft(EMPTY); }
    setEditing(null); setAdding(false);
  }, [key, approvedBy]);

  const save = (d: Draft) => { setDraft(d); try { localStorage.setItem(key, JSON.stringify(d)); } catch { /* storage unavailable */ } };
  const dirty = Object.keys(draft.edits).length > 0 || draft.removed.length > 0 || draft.added.length > 0;

  const commitEdit = (r: PlanRow) => {
    const t = text.trim(); setEditing(null);
    if (!t || t === r.now) { const e = { ...draft.edits }; delete e[r.name]; save({ ...draft, edits: e }); return; }
    save({ ...draft, edits: { ...draft.edits, [r.name]: t } });
  };
  const revert = (name: string) => { const e = { ...draft.edits }; delete e[name]; save({ ...draft, edits: e }); };
  const remove = (name: string) => save({ ...draft, removed: [...draft.removed, name] });
  const restore = (name: string) => save({ ...draft, removed: draft.removed.filter((n) => n !== name) });
  const addDrug = (name: string, t: string) => { if (!name.trim() || !t.trim()) return; save({ ...draft, added: [...draft.added, { name: name.trim(), text: t.trim() }] }); };
  const dropAdded = (i: number) => save({ ...draft, added: draft.added.filter((_, j) => j !== i) });

  const nowOf = (r: PlanRow) => draft.edits[r.name] ?? r.now;
  const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');
  const known = [...rows.map((r) => norm(r.name)), ...draft.added.map((a) => norm(a.name))];
  const openSuggestions = suggestions.filter((s) => !known.some((k) => k === norm(s.name) || k.startsWith(norm(s.name)) || norm(s.name).startsWith(k)));

  const finalItems = (): OutItem[] => [
    ...rows.filter((r) => !draft.removed.includes(r.name) && !NOT_GIVEN.includes(nowOf(r))).map((r) => toItem(r.name, nowOf(r))),
    ...draft.added.map((a) => toItem(a.name, a.text)),
  ];
  const approve = async () => {
    const ok = await onApprove(dirty ? finalItems() : null);
    if (!ok) return;
    setDraft(EMPTY);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  };

  return (
    <div className="pe">
      <table className="ws-table vh-table">
        <thead><tr>
          <th>Drug</th>
          <th data-tip={prevLabel ? `What was given at ${prevLabel}, the last visit with the same chemo.` : 'There is no earlier visit to compare with.'}>Last time{prevLabel ? ` · ${prevLabel}` : ''}</th>
          <th data-tip="The plan for this visit. Click a dose to change it.">Now</th>
          <th>Why</th>
          <th />
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const removed = draft.removed.includes(r.name);
            const edited = r.name in draft.edits;
            const n = nowOf(r);
            const changed = r.last !== '–' && r.last !== n && !(r.last === 'not given' && n === 'not in plan');
            return (
              <tr key={r.name} className={removed ? 'pe-removed' : ''} data-tip={`${r.name}: ${removed ? 'removed from the plan.' : edited ? `edited by you (suggested: ${r.now}).` : changed ? `changed from ${r.last} to ${n}.` : 'unchanged.'} ${r.why}`}>
                <td><b>{r.name}</b></td>
                <td className="mono">{r.last}</td>
                <td className="mono">
                  {editing === r.name ? (
                    <input className="pe-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => commitEdit(r)} onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(r); if (e.key === 'Escape') setEditing(null); }} />
                  ) : removed ? <span className="ws-dim">removed</span>
                    : <button className="pe-val" disabled={!canEdit} onClick={() => { setEditing(r.name); setText(n); }} data-tip="Click to change the dose or frequency.">
                        {n === 'BLOCKED' ? <span className="chip chip-hazard">BLOCKED</span> : edited ? <span className="vh-up">{n}</span> : changed ? <span className="vh-up">{n}{n.includes('×') ? ' ↑' : ''}</span> : n}
                      </button>}
                  {edited && !removed && <span className="chip" data-tip="You changed this from the suggested value.">edited</span>}
                </td>
                <td>{r.why}</td>
                <td className="pe-acts">
                  {canEdit && !removed && edited && <button className="link-btn" onClick={() => revert(r.name)} data-tip={`Back to the suggested value: ${r.now}.`}>↺</button>}
                  {canEdit && !removed && <button className="link-btn" onClick={() => remove(r.name)} data-tip="Remove this drug from the plan.">✕</button>}
                  {canEdit && removed && <button className="link-btn" onClick={() => restore(r.name)} data-tip="Put this drug back into the plan.">restore</button>}
                </td>
              </tr>
            );
          })}
          {draft.added.map((a, i) => (
            <tr key={`add-${i}`} data-tip={`${a.name}: added by you.`}>
              <td><b>{a.name}</b></td><td className="mono">–</td>
              <td className="mono"><span className="vh-up">{a.text}</span> <span className="chip">added</span></td>
              <td className="ws-dim">Added by you</td>
              <td className="pe-acts"><button className="link-btn" onClick={() => dropAdded(i)} data-tip="Remove the drug you added.">✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit && (adding ? (
        <div className="pe-add">
          <input className="pe-input" placeholder="Drug" value={newName} onChange={(e) => setNewName(e.target.value)} data-tip="Name of the drug to add." />
          <input className="pe-input" placeholder="Dose and frequency, e.g. 2 mg ×2/day" value={newText} onChange={(e) => setNewText(e.target.value)} data-tip="Dose and how often, e.g. 2 mg ×2/day. The frequency is read from ×N/day." />
          <button className="ws-btn primary" onClick={() => { addDrug(newName, newText); setNewName(''); setNewText(''); setAdding(false); }} disabled={!newName.trim() || !newText.trim()}>Add</button>
          <button className="ws-btn ghost" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="link-btn pe-addbtn" onClick={() => setAdding(true)} data-tip="Add a drug that is not in the plan yet.">+ Add drug</button>
      ))}

      {canEdit && openSuggestions.length > 0 && (
        <div className="pe-sugg" data-tip="Drugs the rules engine suggests but that are not part of the plan. Add one with a click, then edit its dose if needed.">
          <div className="lbl">Suggested, not in the plan</div>
          {openSuggestions.map((s) => (
            <div key={s.name} className="pe-s" data-tip={s.note}>
              <span><b>{s.name}</b> <span className="mono">{s.text}</span>{s.tag && <span className="ws-dim"> · {s.tag}</span>}</span>
              <button className="link-btn" onClick={() => addDrug(s.name, s.text)} data-tip="Add this drug to the plan.">+ add</button>
            </div>
          ))}
        </div>
      )}

      <div className="vh-actions">
        {canEdit && (!approvedBy || dirty) && (
          <button className="ws-btn primary" onClick={approve} disabled={approving} data-tip={approvedBy ? 'Save your changes to the approved plan. The family sees the new schedule in the patient app.' : dirty ? 'Approve the plan with your changes. The family then sees the medication times in the patient app.' : 'Approve the suggested plan. The family then sees the medication times in the patient app.'}>
            <CheckCircle size={15} /> {approvedBy ? 'Save plan changes' : dirty ? 'Approve edited plan' : 'Approve plan'}
          </button>
        )}
        {dirty && canEdit && <button className="ws-btn ghost" onClick={() => save(EMPTY)} data-tip="Throw away all your changes and go back to the suggested plan.">Reset to suggestion</button>}
        {approvedBy
          ? <>
              <span className="chip chip-ok" data-tip="A clinician approved this plan.">✓ approved by {approvedBy}</span>
              <button className="ws-btn ghost" onClick={onUndo} disabled={approving} data-tip="Take the approval back. The family stops seeing the medication times in the patient app, and the approved plan comes back here as an editable draft.">Undo approval</button>
            </>
          : <span className="ws-dim" data-tip="Parents only see the medication times after a clinician approves.">Parents see the medication times in the app after approval.</span>}
      </div>
    </div>
  );
};
