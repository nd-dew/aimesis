import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Cycle, Patient } from '../types';
import { PatientPanel } from './PatientPanel';
import { useColumnWidth } from '../useColumnWidth';
import { Flag, PersonIcon } from './icons';
import { PatientQrButton } from './PatientQrButton';
import { Portrait } from './Portrait';
import { History } from './History';
import { PatientSearchSelect } from './PatientSearchSelect';
import { DoctorCalendar } from './DoctorCalendar';
import '../workspace.css';
import './PatientView.css';

type UiLang = 'EN' | 'NL';


export const PatientView: React.FC = () => {
  const wanted = new URLSearchParams(window.location.search).get('patient') || 'pt-emma';
  const [patient, setPatient] = useState<Patient | null>(null);
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>('EN'); // no-op: only the flag changes, nothing is translated
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (window.matchMedia('(max-width: 1100px)').matches) return true;
    try { return localStorage.getItem('pv_left_collapsed') === '1'; } catch { return false; }
  });
  const toggleLeft = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('pv_left_collapsed', next ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  const split = useColumnWidth('pv_fig_w3', 470, 340, 420, 'left');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/patients');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) setAllPatients(data);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const initialVisit = new URLSearchParams(window.location.search).get('visit') || undefined;
    load(initialVisit);
  }, [wanted]);

  // keepVisit: stay on that visit (used after approving a plan) instead of jumping to the planned one
  const load = async (keepVisit?: string) => {
    try {
      const res = await apiFetch(`/api/patients/${wanted}`);
      if (!res.ok) { setError(`Patient "${wanted}" not found.`); return; }
      const data = await res.json();
      setPatient(data.patient);
      const list: Cycle[] = data.cycles || [];
      setCycles(list);
      const keep = keepVisit && list.find((c) => c.id === keepVisit);
      setVisitId((keep || list.find((c) => c.status === 'planned') || list[list.length - 1])?.id || null);
    } catch {
      setError('Cannot reach the backend.');
    }
  };

  const p = patient;
  const visit = cycles.find((c) => c.id === visitId) || null;


  return (
    <div className="ws-root patient-workspace">
      <a className="pv-skip" href="#recommendations">Skip to recommendations</a>
      <header className="ws-top">
        <div className="ws-brand" data-tip="AImesis: decision support for preventing chemotherapy-induced nausea and vomiting (CINV) in children, based on the published POGO and CCLG pediatric guidelines.">
          🛡️ <strong>AImesis</strong><span>patient view</span>
        </div>
        {p && (
          <div className="pv-head" data-tip="The patient on screen (de-identified alias) and the visit this view belongs to.">
            {allPatients.length > 0 ? (
              <PatientSearchSelect
                patients={allPatients}
                selectedId={wanted}
                onSelect={(patientId) => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('patient', patientId);
                  window.location.href = url.toString();
                }}
              />
            ) : (
              <strong>{p.alias}</strong>
            )}
            <span className="ws-dim">{visit ? `Visit ${visit.label} · ${visit.date || 'no date'} · ${visit.status}` : 'no visit'}</span>
          </div>
        )}
        <span style={{ flex: 1 }} />
        {p && <DoctorCalendar currentPatientId={p.id} onSelectVisit={(cid) => setVisitId(cid)} />}
        <div className="pv-clinician"><PersonIcon doctor size={20} /><span><small>Doctor</small><strong>Dr. A. Peeters</strong></span></div>
        {p && <PatientQrButton patientId={p.id} name={p.alias} />}
        <button
          className="lang-flag"
          onClick={() => setUiLang(uiLang === 'EN' ? 'NL' : 'EN')}
          data-tip={`Current language: ${uiLang === 'EN' ? 'English' : 'Dutch'}. Click to switch to ${uiLang === 'EN' ? 'Dutch' : 'English'}. Not wired yet: the flag changes but nothing is translated.`}
          aria-label="Switch language"
        >
          <Flag lang={uiLang} width={24} />
        </button>
      </header>


      {error && <div className="ws-error" data-tip="The page could not load the patient from the backend.">{error}</div>}

      {p && (
        <main className={`ws-body ${collapsed ? 'left-collapsed' : ''}`} ref={split.box} style={{ ['--left-w' as any]: `${split.w}px` }}>
          {collapsed ? (
            <div className="ws-col pv-rail">
              <button type="button" className="rail-btn" onClick={toggleLeft} aria-expanded="false" aria-label="Show patient details"><span className="pv-mobile-label">Show patient details</span><span className="pv-desktop-label" aria-hidden="true">»</span></button>
              <div data-tip={`${p.alias}: patient panel is collapsed. Click » to expand it.`}><Portrait patient={p} size={26} /></div>
              <span className="pv-rail-label">PATIENT</span>
            </div>
          ) : (
            <>
          <div className="ws-col pv-figure-col">
            <button type="button" className="rail-btn rail-collapse" onClick={toggleLeft} aria-expanded="true">Hide patient details</button>
            <PatientPanel patient={p} visitDate={visit?.date} onSaved={() => load(visitId || undefined)} />
          </div>

          <div {...split.gutterProps} data-tip="Drag to resize the columns. Double-click to reset." title="" />
            </>
          )}

          <div className="ws-col pv-info-col">


            <History patient={p} cycles={cycles} selectedId={visitId} onSelect={setVisitId} onApproved={(id) => load(id)} />
          </div>
        </main>
      )}
    </div>
  );
};
