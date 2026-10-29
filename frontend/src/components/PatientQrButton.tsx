import { useId, useRef, useState } from 'react';
import { QrCode, X } from 'lucide-react';
import { apiFetch } from '../api';
import { PersonIcon } from './icons';

interface PatientLink { url: string; qr_svg: string }
interface PatientQrButtonProps { patientId: string; name: string }

export function PatientQrButton({ patientId, name }: PatientQrButtonProps) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<PatientLink | null>(null);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const title = 'Open the patient app';

  const load = async () => {
    setLink(null);
    setFailed(false);
    try {
      const response = await apiFetch(`/api/patients/${patientId}/patient-mobile-link`);
      if (!response.ok) throw new Error('Could not prepare app link');
      setLink(await response.json());
    } catch {
      setFailed(true);
    }
  };

  const prepare = () => {
    if (open) return;
    const rect = button.current!.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 16);
    setPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) });
    void load();
  };

  return (
    <div className="qr-wrap">
      <button ref={button} type="button" className={`qr-btn ${open ? 'open' : ''}`}
        popoverTarget={id} onClick={prepare} aria-expanded={open}
        title="Open this patient’s nausea diary on a phone">
        <PersonIcon size={20} />
        <span className="qr-btn-text"><small>Patient</small><strong>{name}</strong></span>
        <QrCode size={22} aria-hidden="true" />
      </button>
      <div id={id} popover="auto" className="qr-pop" style={position}
        onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}>
        <button type="button" className="qr-close" popoverTarget={id} popoverTargetAction="hide" autoFocus aria-label="Close patient QR code">
          <X size={16} aria-hidden="true" />
        </button>
        <p className="qr-pop-title">{title}</p>
        <p role="status">{!link && !failed ? 'Preparing QR code…' : ''}</p>
        {failed && <div role="alert">Could not prepare the link. <button type="button" className="ws-btn" onClick={load}>Retry</button></div>}
        {link && <>
          <div className="qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: link.qr_svg }} />
          <a className="qr-open" href={link.url} target="_blank" rel="noreferrer">{title}</a>
          <p className="ws-dim">Scan with a phone camera.</p>
          <a className="qr-url" href={link.url} target="_blank" rel="noreferrer">{link.url}</a>
        </>}
      </div>
    </div>
  );
}
