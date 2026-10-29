import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { NauseaLevel, NauseaLogEntry } from './types';
import { COMPANION_STRINGS, Lang } from './i18n';
import { usePatientDiary } from './usePatientDiary';
import './PatientMobileApp.css';

const levels = [0, 1, 2, 3] as const;
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });

function Intensity({ level }: { level: NauseaLevel }) {
  return <span className="companion-pips" aria-hidden="true">{[1, 2, 3].map(value => <i key={value} className={value <= level ? 'filled' : ''} />)}</span>;
}

export function PatientMobileApp({ token }: { token: string }) {
  const diary = usePatientDiary(token);
  const [language, setLanguage] = useState<Lang | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<NauseaLevel | null>(null);
  const [needsLevel, setNeedsLevel] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const firstLevel = useRef<HTMLInputElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const activeLanguage = language ?? diary.data?.language ?? 'NL';
  const L = COMPANION_STRINGS[activeLanguage];
  const name = diary.data?.patient_alias ?? '';
  const personalize = (text: string) => text.replace('{name}', name);
  const time = (timestamp: string) => new Intl.DateTimeFormat(L.locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }).format(new Date(timestamp));
  const describe = (entry: NauseaLogEntry) => entry.kind === 'vomiting' ? L.vomiting : L.levels[entry.severity];
  const today = dateKey.format(new Date());
  const todayLogs = diary.data?.recent_logs.filter(entry => dateKey.format(new Date(entry.occurred_at)) === today) ?? [];

  useEffect(() => {
    if (diary.undoSeconds === 0 && document.activeElement === undoButton.current) saveButton.current?.focus();
  }, [diary.undoSeconds]);

  const saveLevel = async () => {
    if (selectedLevel === null) {
      setNeedsLevel(true);
      firstLevel.current!.focus();
      return;
    }
    if (await diary.save({ kind: 'nausea', severity: selectedLevel })) setSelectedLevel(null);
  };

  return (
    <div className="companion-page" lang={activeLanguage.toLowerCase()}>
      <div className="companion-app">
        <header className="companion-header">
          <div className="companion-brand">AImesis<span>.</span></div>
          <label className="companion-language">{L.language}
            <select value={activeLanguage} onChange={event => setLanguage(event.target.value as Lang)}>
              <option value="NL">NL</option><option value="FR">FR</option><option value="EN">EN</option>
            </select>
          </label>
        </header>
        {diary.loading ? (
          <main className="companion-state" role="status"><Loader2 className="companion-spinner" aria-hidden="true" /><p>{L.loading}</p></main>
        ) : diary.loadError || !diary.data ? (
          <main className="companion-state">
            <AlertCircle aria-hidden="true" />
            <h1>{diary.loadError === 'invalid' ? L.invalidTitle : L.loadFailed}</h1>
            {diary.loadError === 'invalid' ? <p>{L.invalidBody}</p> : <button type="button" onClick={() => window.location.reload()}>{L.retry}</button>}
          </main>
        ) : (
          <main>
            <div className="companion-identity">
              <div className="companion-avatar" aria-hidden="true">{name.charAt(0)}</div>
              <div><strong>{name}</strong><p>{L.diary}</p></div>
            </div>
            <section className="companion-check-in">
              <h1>{L.heading}</h1>
              <p className="companion-invitation">{personalize(L.invitation)}</p>
              <fieldset disabled={diary.saving} className="companion-levels">
                <legend className="companion-sr-only">{L.levelsLabel}</legend>
                {levels.map(level => (
                  <label className="companion-level" key={level}>
                    <input ref={level === 0 ? firstLevel : undefined} type="radio" name="nausea-level" value={level}
                      checked={selectedLevel === level} onChange={() => { setSelectedLevel(level); setNeedsLevel(false); }} />
                    <span className="companion-option"><strong>{L.levels[level]}</strong><span>{L.hints[level]}</span></span>
                    <Intensity level={level} />
                  </label>
                ))}
              </fieldset>
              <p className="companion-error" role="alert">{needsLevel ? L.needLevel : ''}</p>
              <button ref={saveButton} type="button" className="companion-save" disabled={diary.saving} onClick={saveLevel}>
                {diary.saving ? <Loader2 className="companion-spinner" size={20} aria-hidden="true" /> : <Check size={20} aria-hidden="true" />}
                {diary.saving ? L.saving : selectedLevel === null ? L.save : `${L.save}: ${L.levels[selectedLevel]}`}
              </button>
            </section>
            <div className="companion-feedback">
              <span role="status" aria-live="polite">{diary.lastEntry
                ? L.saved.replace('{time}', time(diary.lastEntry.occurred_at)).replace('{symptom}', describe(diary.lastEntry))
                : diary.undone ? L.undone : ''}</span>
              {diary.lastEntry && <button ref={undoButton} type="button" disabled={diary.saving} onClick={async () => { if (await diary.undo()) saveButton.current!.focus(); }}>{L.undo} ({diary.undoSeconds}s)</button>}
            </div>
            <p className="companion-error" role="alert">{diary.mutationError === 'save' ? L.saveFailed : diary.mutationError === 'undo' ? L.undoFailed : ''}</p>
            {diary.offline && <p className="companion-offline" role="status">{L.offlineSaved}</p>}
            <button type="button" className="companion-vomiting" disabled={diary.saving} onClick={() => diary.save({ kind: 'vomiting', severity: null })}>{personalize(L.vomitingButton)}</button>
            <div className="companion-counts">
              <span>{L.nauseaToday} <b>{todayLogs.filter(entry => entry.kind === 'nausea' && entry.severity > 0).length}</b></span>
              <span>{L.vomitingToday} <b>{todayLogs.filter(entry => entry.kind === 'vomiting').length}</b></span>
            </div>
            <section className="companion-history">
              <h2>{L.todayDiary}</h2>
              {todayLogs.length === 0 ? <p>{L.empty}</p> : <ul>{todayLogs.map(entry => (
                <li key={entry.id}><time dateTime={entry.occurred_at}>{time(entry.occurred_at)}</time>
                  <span>{entry.kind === 'nausea' && <Intensity level={entry.severity} />}{describe(entry)}</span>
                </li>
              ))}</ul>}
            </section>
          </main>
        )}
      </div>
    </div>
  );
}
