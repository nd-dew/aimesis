import React, { useState, useEffect } from 'react';
import { AlertCircle, RotateCcw, Camera, Check, Phone, Loader2 } from 'lucide-react';
import { CompanionViewResponse, NauseaLogEntry, CompanionTodayItem } from '../types';
import { COMPANION_STRINGS, Lang, isLang } from '../i18n';

interface MobileCompanionPageProps {
  token: string;
}

export const MobileCompanionPage: React.FC<MobileCompanionPageProps> = ({ token }) => {
  const [data, setData] = useState<CompanionViewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<boolean>(false);
  const [lastLoggedEntry, setLastLoggedEntry] = useState<NauseaLogEntry | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number>(0);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang | null>(null);
  const [lastKind, setLastKind] = useState<'nausea' | 'vomiting' | 'anxious'>('nausea');

  const activeLang: Lang = lang ?? (isLang(data?.language) ? (data!.language as Lang) : 'NL');
  const L = COMPANION_STRINGS[activeLang];

  // Load companion profile
  const fetchCompanionData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await fetch(`/api/companion/${token}`);
      if (!res.ok) {
        throw new Error('Link is expired or invalid');
      }
      const json: CompanionViewResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  };

  // Offline queue sync
  const flushOfflineQueue = async () => {
    try {
      const queued = localStorage.getItem('aim_offline_queue');
      if (!queued) return;
      const items = JSON.parse(queued);
      if (!Array.isArray(items) || items.length === 0) return;

      const remaining = [];
      for (const item of items) {
        try {
          const res = await fetch(`/api/companion/${token}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (!res.ok) remaining.push(item);
        } catch {
          remaining.push(item);
        }
      }
      if (remaining.length === 0) {
        localStorage.removeItem('aim_offline_queue');
        setOfflineNotice(null);
        await fetchCompanionData(true);
      } else {
        localStorage.setItem('aim_offline_queue', JSON.stringify(remaining));
      }
    } catch (e) {
      console.error('Queue flush error', e);
    }
  };

  useEffect(() => {
    fetchCompanionData();
    window.addEventListener('online', flushOfflineQueue);
    return () => window.removeEventListener('online', flushOfflineQueue);
  }, [token]);

  // Undo countdown timer
  useEffect(() => {
    if (undoCountdown <= 0) {
      setLastLoggedEntry(null);
      return;
    }
    const timer = setInterval(() => {
      setUndoCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [undoCountdown]);

  const handleLogTap = async (severity: number, type: 'acute' | 'delayed' | 'anticipatory', kind: 'nausea' | 'vomiting' | 'anxious') => {
    setLogging(true);
    const clientId = crypto.randomUUID ? crypto.randomUUID() : `tap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const payload = {
      severity,
      type,
      client_id: clientId,
      occurred_at: new Date().toISOString(),
    };

    try {
      const res = await fetch(`/api/companion/${token}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Network error');
      }

      const resJson = await res.json();
      setLastLoggedEntry(resJson.entry);
      setLastKind(kind);
      setUndoCountdown(10);
      await fetchCompanionData(true);
    } catch {
      // Save to offline queue
      try {
        const queued = JSON.parse(localStorage.getItem('aim_offline_queue') || '[]');
        queued.push(payload);
        localStorage.setItem('aim_offline_queue', JSON.stringify(queued));
        setOfflineNotice(L.offlineSaved);
      } catch (err) {
        console.error(err);
      }
    } finally {
      setLogging(false);
    }
  };

  const handleUndo = async () => {
    if (!lastLoggedEntry?.id) return;
    try {
      const res = await fetch(`/api/companion/${token}/log/${lastLoggedEntry.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setLastLoggedEntry(null);
        setUndoCountdown(0);
        await fetchCompanionData(true);
      }
    } catch (err) {
      console.error('Undo failed', err);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);

    try {
      await fetch(`/api/companion/${token}/photo`, {
        method: 'POST',
        body: form,
      });
      alert(L.photoOk);
    } catch {
      alert(L.photoFail);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#090d16', color: '#ffffff' }}>
        <Loader2 size={36} className="animate-spin" color="#0ea5e9" />
        <p style={{ marginTop: '1rem', fontSize: '1rem', fontWeight: 600 }}>{L.loading}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', background: '#090d16', color: '#ffffff', minHeight: '100vh' }}>
        <AlertCircle size={48} color="#ef4444" style={{ margin: '0 auto 1rem' }} />
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{L.linkInvalidTitle}</h2>
        <p style={{ color: '#94a3b8', marginTop: '0.5rem', fontSize: '0.9rem' }}>
          {L.linkInvalidBody}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', padding: '1rem', background: '#090d16', color: '#ffffff', minHeight: '100vh' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.75rem' }}>
        <div>
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#94a3b8', fontWeight: 700, letterSpacing: '0.05em' }}>
            {L.companionLabel}
          </span>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc' }}>
            {data.patient_alias}
          </h1>
        </div>
        <select
          aria-label={L.language}
          value={activeLang}
          onChange={(e) => setLang(e.target.value as Lang)}
          style={{ fontSize: '0.95rem', fontWeight: 700, background: '#1e293b', padding: '0.45rem 0.6rem', borderRadius: '6px', color: '#38bdf8', border: '1px solid #334155' }}
        >
          <option value="NL">NL</option>
          <option value="FR">FR</option>
          <option value="EN">EN</option>
        </select>
      </header>

      {/* Offline Toast */}
      {offlineNotice && (
        <div style={{ background: '#78350f', border: '1px solid #d97706', padding: '0.75rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem' }}>
          {offlineNotice}
        </div>
      )}

      {/* 10s Undo Toast */}
      {lastLoggedEntry && (
        <div style={{ background: '#064e3b', border: '1px solid #10b981', padding: '0.85rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
            <Check size={18} color="#34d399" />
            <span>{lastKind === 'vomiting' ? L.loggedVomiting : lastKind === 'anxious' ? L.loggedAnxious : L.loggedNausea}</span>
          </div>
          <button
            type="button"
            onClick={handleUndo}
            style={{
              background: '#047857',
              border: 'none',
              color: '#ffffff',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            <RotateCcw size={14} />
            {L.undo} ({undoCountdown}s)
          </button>
        </div>
      )}

      {/* PRIMARY ONE-TAP ACTION: Big Nausea Button (>= 64px tall, text >= 18px) */}
      <section style={{ marginBottom: '1.25rem' }}>
        <button
          type="button"
          onClick={() => handleLogTap(3, 'acute', 'nausea')}
          disabled={logging}
          style={{
            width: '100%',
            minHeight: '68px',
            background: 'linear-gradient(135deg, #e11d48, #be123c)',
            border: 'none',
            borderRadius: '16px',
            color: '#ffffff',
            fontSize: '1.25rem',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 8px 24px -4px rgba(225, 29, 72, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            transition: 'transform 0.1s ease',
          }}
        >
          {L.btnNausea}
        </button>

        {/* Secondary Log Options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
          <button
            type="button"
            onClick={() => handleLogTap(4, 'acute', 'vomiting')}
            disabled={logging}
            style={{
              padding: '0.85rem',
              minHeight: '52px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '10px',
              color: '#f8fafc',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {L.btnVomiting}
          </button>

          <button
            type="button"
            onClick={() => handleLogTap(2, 'anticipatory', 'anxious')}
            disabled={logging}
            style={{
              padding: '0.85rem',
              minHeight: '52px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '10px',
              color: '#f8fafc',
              fontSize: '0.9rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {L.btnAnxious}
          </button>
        </div>
      </section>

      {/* Optional Photo Attachment */}
      {data.uploads_enabled && (
        <section style={{ marginBottom: '1.25rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              padding: '0.75rem',
              background: '#162032',
              border: '1px dashed #38bdf8',
              borderRadius: '10px',
              color: '#38bdf8',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Camera size={16} />
            {L.takePhoto}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handlePhotoUpload}
            />
          </label>
        </section>
      )}

      {/* Today's Schedule */}
      {data.today && data.today.length > 0 && (
        <section style={{ background: '#162032', border: '1px solid #223049', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', color: '#38bdf8', letterSpacing: '0.04em', marginBottom: '0.65rem' }}>
            {L.todayTitle}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {data.today.map((t: CompanionTodayItem, idx: number) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f1624', padding: '0.6rem 0.85rem', borderRadius: '6px' }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{t.time}</span>
                <span style={{ fontSize: '0.85rem', color: '#93c5fd' }}>{t.drug} ({t.dose_text})</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(!data.today || data.today.length === 0) && data.schedule_message && (
        <section style={{ background: '#162032', border: '1px solid #223049', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem', fontSize: '0.9rem', color: '#cbd5e1' }}>
          {data.schedule_message}
        </section>
      )}

      {/* Red Flags Card */}
      <section style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #dc2626', borderRadius: '12px', padding: '1rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fca5a5', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertCircle size={16} />
          {data.passport.red_flag_title || L.redFlagFallback}
        </h3>
        <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#fecdd3', lineHeight: 1.5 }}>
          {data.passport.red_flag_symptoms.map((s: string, idx: number) => (
            <li key={idx}>{s}</li>
          ))}
        </ul>
        <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(239, 68, 68, 0.3)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 700, color: '#fca5a5' }}>
          <Phone size={14} />
          {data.passport.emergency_contact}
        </div>
      </section>

      {/* 7-Day Recent Logs */}
      <section style={{ background: '#162032', border: '1px solid #223049', borderRadius: '12px', padding: '1rem' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.04em', marginBottom: '0.65rem' }}>
          {L.recentTitle}
        </h3>
        {data.recent_logs.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: '#64748b' }}>{L.noLogs}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {data.recent_logs.map((log: NauseaLogEntry) => (
              <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f1624', padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem' }}>
                <div>
                  <span style={{ fontWeight: 700, color: log.severity >= 4 ? '#ef4444' : '#f59e0b' }}>
                    {log.type === 'anticipatory' ? L.anxious : log.severity >= 4 ? L.vomiting : L.nausea}
                  </span>
                  {log.note && <span style={{ marginLeft: '0.5rem', color: '#94a3b8' }}>- {log.note}</span>}
                </div>
                <span style={{ color: '#64748b', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                  {log.occurred_at ? new Date(log.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
