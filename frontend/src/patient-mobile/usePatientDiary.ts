import { useCallback, useEffect, useState } from 'react';
import { CompanionLogRequest, PatientDiary, NauseaLogEntry, SymptomReport } from './types';

type LoadError = 'invalid' | 'load';
type MutationError = 'save' | 'undo';

export function usePatientDiary(token: string) {
  const [data, setData] = useState<PatientDiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const [saving, setSaving] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastEntry, setLastEntry] = useState<NauseaLogEntry | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(0);
  const [undone, setUndone] = useState(false);
  const url = `/api/patient-mobile/${token}`;
  const queueKey = `patient_mobile_queue:${token}`;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(url);
      if (response.status === 404) {
        setLoadError('invalid');
        return;
      }
      if (!response.ok) throw new Error('Could not load diary');
      const profile: PatientDiary = await response.json();
      setData(profile);
      setLoadError(null);
    } catch {
      setLoadError('load');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const flushQueue = useCallback(async () => {
    try {
      const queued: CompanionLogRequest[] = JSON.parse(localStorage.getItem(queueKey) ?? '[]');
      setOffline(queued.length > 0);
      for (const item of queued) {
        const response = await fetch(`${url}/log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
        });
        if (!response.ok) return;
        const current: CompanionLogRequest[] = JSON.parse(localStorage.getItem(queueKey) ?? '[]');
        localStorage.setItem(queueKey, JSON.stringify(current.filter(entry => entry.client_id !== item.client_id)));
      }
      const remaining: CompanionLogRequest[] = JSON.parse(localStorage.getItem(queueKey) ?? '[]');
      setOffline(remaining.length > 0);
    } catch {
      // Keep unsent entries on this phone for the next connection or page load.
    }
  }, [queueKey, url]);

  useEffect(() => {
    const sync = async () => {
      await flushQueue();
      await refresh();
    };
    void sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [flushQueue, refresh]);

  useEffect(() => {
    if (undoSeconds === 0) {
      setLastEntry(null);
      return;
    }
    const timer = window.setTimeout(() => setUndoSeconds(seconds => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [undoSeconds]);

  const save = async (report: SymptomReport): Promise<boolean> => {
    setSaving(true);
    setMutationError(null);
    setUndone(false);
    setUndoSeconds(0);
    const payload: CompanionLogRequest = {
      ...report,
      client_id: crypto.randomUUID ? crypto.randomUUID() : `tap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      occurred_at: new Date().toISOString(),
    };
    try {
      let response: Response;
      try {
        response = await fetch(`${url}/log`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
      } catch {
        try {
          const queued: CompanionLogRequest[] = JSON.parse(localStorage.getItem(queueKey) ?? '[]');
          localStorage.setItem(queueKey, JSON.stringify([...queued, payload]));
          setOffline(true);
          return true;
        } catch {
          setMutationError('save');
          return false;
        }
      }
      if (!response.ok) {
        setMutationError('save');
        return false;
      }
      const result: { entry: NauseaLogEntry; deduplicated: boolean } = await response.json();
      setData(current => ({
        ...current!,
        recent_logs: [result.entry, ...current!.recent_logs.filter(entry => entry.id !== result.entry.id)],
      }));
      setLastEntry(result.entry);
      setUndoSeconds(10);
      return true;
    } finally {
      setSaving(false);
    }
  };

  const undo = async (): Promise<boolean> => {
    setSaving(true);
    setMutationError(null);
    try {
      const response = await fetch(`${url}/log/${lastEntry!.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setMutationError('undo');
        return false;
      }
      setData(current => ({ ...current!, recent_logs: current!.recent_logs.filter(entry => entry.id !== lastEntry!.id) }));
      setUndoSeconds(0);
      setUndone(true);
      return true;
    } catch {
      setMutationError('undo');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { data, loading, loadError, mutationError, saving, offline, lastEntry, undoSeconds, undone, save, undo };
}
