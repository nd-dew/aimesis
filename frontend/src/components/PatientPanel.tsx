import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Patient } from '../types';
import { BodyFigure } from './BodyFigure';
import { Portrait } from './Portrait';
import { Flag, PhoneIcon, PortIcon, SexIcon, SwallowIcon, WarningIcon } from './icons';
import { LABS, labFlag, readExtras, writeExtras, PatientExtras } from '../patientExtras';
import { SWALLOW } from '../patientText';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LANG_NAME: Record<string, string> = { NL: 'Dutch', FR: 'French', EN: 'English' };

interface Draft {
  alias: string; age: string; sex: 'F' | 'M' | ''; language: 'NL' | 'FR' | 'EN';
  diagnosis_text: string; diagnosis_category: Patient['diagnosis_category']; protocol: string;
  weight: string; height: string; swallow: Patient['swallow']; dinutuximab: boolean; carT: boolean;
  allergies: string; access: string; labs: Record<string, string>; who: string; phone: string; note: string;
}

const toDraft = (p: Patient, x: PatientExtras): Draft => ({
  alias: p.alias, age: String(p.age_years), sex: p.sex || '', language: p.language,
  diagnosis_text: p.diagnosis_text, diagnosis_category: p.diagnosis_category, protocol: p.protocol,
  weight: p.weight_kg != null ? String(p.weight_kg) : '', height: p.height_cm != null ? String(p.height_cm) : '',
  swallow: p.swallow, dinutuximab: !!p.flags?.dinutuximab_beta, carT: !!p.flags?.car_t,
  allergies: x.allergies, access: x.access, labs: Object.fromEntries(LABS.map((l) => [l.name, String(x.labs[l.name] ?? '')])),
  who: x.contact.who, phone: x.contact.phone, note: x.contact.note,
});

const mosteller = (h: number, w: number) => Math.round(Math.sqrt((h * w) / 3600) * 100) / 100;

interface Props { patient: Patient; visitDate?: string | null; onSaved: () => void }

// Left panel: who the patient is, what they are treated for, what is safe to give, and the latest values.
// Everything here is editable (✎ Edit): the patient record is saved to the backend, the rest on this computer.
export const PatientPanel: React.FC<Props> = ({ patient: p, visitDate, onSaved }) => {
  const [x, setX] = useState<PatientExtras>(() => readExtras(p.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(p, readExtras(p.id)));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { const e = readExtras(p.id); setX(e); setDraft(toDraft(p, e)); setEditing(false); setErr(null); }, [p.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const startEdit = () => { setDraft(toDraft(p, x)); setErr(null); setEditing(true); };

  const save = async () => {
    const age = parseFloat(draft.age), w = parseFloat(draft.weight), h = parseFloat(draft.height);
    if (!draft.alias.trim()) return setErr('The name cannot be empty.');
    if (!(age >= 0 && age <= 30)) return setErr('Age must be between 0 and 30.');
    if (draft.weight && !(w >= 1 && w <= 200)) return setErr('Weight must be between 1 and 200 kg.');
    if (draft.height && !(h >= 30 && h <= 250)) return setErr('Height must be between 30 and 250 cm.');
    setSaving(true); setErr(null);
    const body: Record<string, unknown> = {
      alias: draft.alias.trim(), age_years: age, language: draft.language, diagnosis_text: draft.diagnosis_text, diagnosis_category: draft.diagnosis_category,
      protocol: draft.protocol, swallow: draft.swallow, flags: { dinutuximab_beta: draft.dinutuximab, car_t: draft.carT },
      fictional_fields: (p.fictional_fields || []).filter((f) => !['age_years', 'weight_kg', 'height_cm'].includes(f)),
    };
    if (draft.sex) body.sex = draft.sex;
    if (draft.weight) body.weight_kg = w;
    if (draft.height) body.height_cm = h;
    if (draft.weight && draft.height) body.bsa_m2 = mosteller(h, w);
    try {
      const res = await apiFetch(`/api/patients/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(typeof d?.detail === 'string' ? d.detail : 'The record could not be saved.'); setSaving(false); return; }
    } catch { setErr('Cannot reach the backend.'); setSaving(false); return; }
    const nx: PatientExtras = {
      allergies: draft.allergies.trim() || 'none known', access: draft.access.trim() || 'not recorded',
      labs: Object.fromEntries(LABS.map((l) => [l.name, parseFloat(draft.labs[l.name]) || 0])),
      contact: { who: draft.who.trim(), phone: draft.phone.trim(), note: draft.note.trim() },
    };
    writeExtras(p.id, nx); setX(nx); setSaving(false); setEditing(false); onSaved();
  };

  const d = visitDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const measured = d ? (() => { const t = new Date(+d[1], +d[2] - 1, +d[3] - 3); return `${t.getDate()} ${MONTHS[t.getMonth()]}`; })() : 'recent';
  const bsaCheck = p.height_cm && p.weight_kg ? Math.sqrt((p.height_cm * p.weight_kg) / 3600) : null;
  const bsaDiff = bsaCheck != null && p.bsa_m2 != null ? Math.abs(bsaCheck - p.bsa_m2) : null;
  const sexTxt = p.sex === 'F' ? 'female' : p.sex === 'M' ? 'male' : 'sex ?';

  const dh = parseFloat(draft.height), dw = parseFloat(draft.weight);
  const draftBsa = dh > 0 && dw > 0 ? mosteller(dh, dw) : null;
  const F: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({ label, wide, children }) => <label className={`pp-f ${wide ? 'wide' : ''}`}><span className="lbl">{label}</span>{children}</label>;

  return (
    <div className="pp">
      <div className="pp-toolbar">
        {!editing ? (
          <button className="rail-btn" onClick={startEdit} data-tip="Edit this patient: name, age, diagnosis, weight and height, flags, allergies, IV access, latest values and contact. The patient record is saved to the backend; allergies, access, values and contact are kept on this computer.">✎ Edit</button>
        ) : (
          <>
            <button className="ws-btn primary" onClick={save} disabled={saving} data-tip="Save the changes. BSA is recalculated from weight and height.">{saving ? 'Saving…' : 'Save'}</button>
            <button className="ws-btn ghost" onClick={() => { setEditing(false); setErr(null); }} data-tip="Discard the changes.">Cancel</button>
          </>
        )}
      </div>

      <div className="pp-who">
        <div className="pp-photo" data-tip="Portrait of the patient.">
          <Portrait patient={p} size={80} />
        </div>
        <div className="pp-who-text">
          <strong className="pp-name" data-tip="Name or alias of the patient (Patient.alias).">{p.alias}</strong>
          <div className="pp-chips">
            <span data-tip={`Sex: ${sexTxt}. Used for the portrait and the passport wording.`} className="pp-inline"><SexIcon sex={p.sex} size={17} />{sexTxt}</span>
            <span data-tip={`Age ${p.age_years} years. Olanzapine is only given from age 2.`}>{p.age_years} years</span>
            <span data-tip={`Language to speak with the patient and the family, and the language of their passport: ${LANG_NAME[p.language]}.`} className="pp-inline"><Flag lang={p.language} width={26} />{LANG_NAME[p.language]}</span>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="pp-form">
          <F label="Name"><input className="ws-select" value={draft.alias} onChange={(e) => set('alias', e.target.value)} /></F>
          <F label="Age (years)"><input className="ws-select" type="number" step="0.5" value={draft.age} onChange={(e) => set('age', e.target.value)} /></F>
          <F label="Sex"><select className="ws-select" value={draft.sex} onChange={(e) => set('sex', e.target.value as Draft['sex'])}><option value="">not recorded</option><option value="F">female</option><option value="M">male</option></select></F>
          <F label="Language"><select className="ws-select" value={draft.language} onChange={(e) => set('language', e.target.value as Draft['language'])}><option value="NL">Dutch</option><option value="FR">French</option><option value="EN">English</option></select></F>
          <F label="Diagnosis" wide><input className="ws-select" value={draft.diagnosis_text} onChange={(e) => set('diagnosis_text', e.target.value)} /></F>
          <F label="Category"><select className="ws-select" value={draft.diagnosis_category} onChange={(e) => set('diagnosis_category', e.target.value as Draft['diagnosis_category'])}><option value="ALL">ALL</option><option value="AML">AML</option><option value="BRAIN_TUMOR">Brain tumor</option><option value="OTHER">Other</option></select></F>
          <F label="Protocol"><input className="ws-select" value={draft.protocol} onChange={(e) => set('protocol', e.target.value)} /></F>
          <F label="Weight (kg)"><input className="ws-select" type="number" step="0.1" value={draft.weight} onChange={(e) => set('weight', e.target.value)} /></F>
          <F label="Height (cm)"><input className="ws-select" type="number" step="1" value={draft.height} onChange={(e) => set('height', e.target.value)} /></F>
          <F label="Swallow ability"><select className="ws-select" value={draft.swallow} onChange={(e) => set('swallow', e.target.value as Draft['swallow'])}><option value="tablets">tablets</option><option value="liquid_only">liquid only</option><option value="ng_tube">NG tube</option><option value="iv_only">IV only</option></select></F>
          <div className="pp-f" data-tip="Body surface area, calculated from weight and height (Mosteller). Saved together with them."><span className="lbl">BSA (calculated)</span><div className="pp-bsa">{draftBsa != null ? `${draftBsa} m²` : '–'}</div></div>
          <label className="pp-check" data-tip="The patient gets dinutuximab beta. Dexamethasone is then hard-blocked."><input type="checkbox" checked={draft.dinutuximab} onChange={(e) => set('dinutuximab', e.target.checked)} /> Dinutuximab β</label>
          <label className="pp-check" data-tip="The patient gets CAR-T therapy. Dexamethasone is then not preferred."><input type="checkbox" checked={draft.carT} onChange={(e) => set('carT', e.target.checked)} /> CAR-T therapy</label>
          <F label="Allergies" wide><input className="ws-select" value={draft.allergies} onChange={(e) => set('allergies', e.target.value)} /></F>
          <F label="IV access" wide><input className="ws-select" value={draft.access} onChange={(e) => set('access', e.target.value)} /></F>
          <div className="pp-f wide"><span className="lbl">Latest values</span>
            <div className="pp-labs">{LABS.map((l) => <label key={l.name} data-tip={l.tip}><span className="pp-s">{l.name} ({l.unit})</span><input className="ws-select" type="number" step="0.1" value={draft.labs[l.name]} onChange={(e) => setDraft((dd) => ({ ...dd, labs: { ...dd.labs, [l.name]: e.target.value } }))} /></label>)}</div>
          </div>
          <F label="Parent"><input className="ws-select" value={draft.who} onChange={(e) => set('who', e.target.value)} /></F>
          <F label="Phone"><input className="ws-select" value={draft.phone} onChange={(e) => set('phone', e.target.value)} /></F>
          <F label="Contact note" wide><input className="ws-select" value={draft.note} onChange={(e) => set('note', e.target.value)} /></F>
          {err && <div className="alert-row hazard wide"><div>{err}</div></div>}
        </div>
      ) : (
        <>
          <div className="pp-sec pp-col">
            <div className="pp-il" data-tip="What the patient is treated for, in the clinician's own words (Patient.diagnosis_text)."><span className="lbl">Diagnosis</span><span className="pp-strong">{p.diagnosis_text}</span></div>
            <div className="pp-il" data-tip="Treatment protocol (Patient.protocol). The engine uses it to find the previous cycle of the same type."><span className="lbl">Protocol</span><span className="pp-strong">{p.protocol}</span></div>
            {p.flags?.car_t && <div className="alert-row warn" data-tip="The patient gets CAR-T cell therapy. Dexamethasone is not preferred (soft warning, not a block)."><div><b>CAR-T therapy:</b> dexamethasone not preferred.</div></div>}
          </div>

          <div className="pp-safety" data-tip="Things that must never be missed before prescribing: allergies and how drugs can reach the bloodstream.">
            <div className="pp-line" data-tip="Known allergies. Fixed on the patient and safety-critical, so it is always visible, even when it says none."><WarningIcon /><span><b>Allergy:</b> {x.allergies}</span></div>
            <div className="pp-line" data-tip="How drugs reach the bloodstream. A port decides whether IV options such as fosaprepitant or IV ondansetron are possible. It changes only when a line is placed or removed."><PortIcon /><span><b>IV access:</b> {x.access}</span></div>
          </div>

          <div className="pp-sec pp-basis">
            <div className="pp-fig"><BodyFigure patient={p} /></div>
            <div className="pp-facts">
              <div className="pp-fact" data-tip={`Body surface area ${p.bsa_m2 ?? '?'} m², Mosteller: square root of (height × weight ÷ 3600)${bsaCheck != null ? ` = ${bsaCheck.toFixed(2)}` : ''}. Chemotherapy and ondansetron are dosed per m², so the dose is that number times BSA.${bsaDiff != null && bsaDiff > 0.03 ? ' WARNING: the stored value differs from the computed one.' : ''}`}>
                <div className="pp-ic"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><defs><pattern id="ppbsa" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#777" strokeWidth="1.2" /></pattern></defs><rect x="1" y="1" width="22" height="22" fill="url(#ppbsa)" stroke="#000" strokeWidth="1.5" /></svg></div>
                <div><div className="pp-v">{p.bsa_m2 ?? '–'} m²{bsaDiff != null && bsaDiff > 0.03 && <span className="chip chip-warn" style={{ marginLeft: 6 }}>check</span>}</div><div className="pp-s mono">BSA{bsaCheck != null ? ` · √(${p.height_cm}×${p.weight_kg}÷3600)` : ''}</div></div>
              </div>
              <div className="pp-fact" data-tip={`Swallow ability: ${p.swallow.replace('_', ' ')}. ${SWALLOW[p.swallow]} This decides tablet, liquid, tube or IV forms.`}>
                <div className="pp-ic"><SwallowIcon kind={p.swallow} size={30} /></div>
                <div><div className="pp-v">{p.swallow.replace('_', ' ')}</div><div className="pp-s">swallow ability</div></div>
              </div>
              <div className="pp-vals">
                <div className="pp-row-head">
                  <span className="lbl" data-tip="The most recent lab and ECG values, each with the day it was measured. They change every visit, so the full series belongs in the history.">Latest values</span>
                  <span style={{ flex: 1 }} /><span className="pp-s" data-tip="The day these values were measured, 3 days before the visit.">measured {measured}</span>
                </div>
                <table className="pp-table">
                  <tbody>
                    {LABS.map((l) => { const v = x.labs[l.name]; const f = labFlag(l, v); return (
                      <tr key={l.name} data-tip={l.tip}><td>{l.name}</td><td className="mono"><b>{v}</b> {l.unit}{f && <span className="pp-flag">{f}</span>}</td></tr>
                    ); })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="pp-sec pp-line" data-tip="Who to call. Fixed on the patient.">
            <PhoneIcon />
            <span><b>{x.contact.who}</b>{x.contact.phone && ` · ${x.contact.phone}`}{x.contact.note && <span className="pp-s"> · {x.contact.note}</span>}</span>
          </div>
        </>
      )}
    </div>
  );
};
