import React from 'react';

// Small hand-drawn icons, black and white to match the rest of the page.
// Each is a self-contained <svg>, so it works in HTML and nested inside another <svg>.
export type LangCode = 'EN' | 'NL' | 'FR';

export const Flag: React.FC<{ lang: LangCode; width?: number }> = ({ lang, width = 30 }) => (
  <svg width={width} height={(width * 2) / 3} viewBox="0 0 60 40" aria-hidden="true" style={{ border: '1px solid #999', flexShrink: 0 }}>
    {lang === 'EN' && (
      <>
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0 L60 40 M60 0 L0 40" stroke="#fff" strokeWidth="8" />
        <path d="M0 0 L60 40 M60 0 L0 40" stroke="#C8102E" strokeWidth="3" />
        <path d="M30 0 V40 M0 20 H60" stroke="#fff" strokeWidth="13" />
        <path d="M30 0 V40 M0 20 H60" stroke="#C8102E" strokeWidth="7" />
      </>
    )}
    {lang === 'NL' && (
      <>
        <rect width="60" height="14" fill="#AE1C28" />
        <rect y="13" width="60" height="14" fill="#fff" />
        <rect y="26" width="60" height="14" fill="#21468B" />
      </>
    )}
    {lang === 'FR' && (
      <>
        <rect width="20" height="40" fill="#0055A4" />
        <rect x="20" width="20" height="40" fill="#fff" />
        <rect x="40" width="20" height="40" fill="#EF4135" />
      </>
    )}
  </svg>
);

// Venus / Mars symbols, drawn as strokes.
export const SexIcon: React.FC<{ sex?: 'F' | 'M'; size?: number }> = ({ sex, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    {sex === 'F' && (<><circle cx="12" cy="9" r="5.5" /><path d="M12 14.5 V22 M8.5 18.5 H15.5" /></>)}
    {sex === 'M' && (<><circle cx="10" cy="14" r="5.5" /><path d="M14 10 L20.5 3.5 M14.5 3.5 H20.5 V9.5" /></>)}
    {!sex && (<><circle cx="12" cy="12" r="9" strokeDasharray="3 3" /><path d="M9.5 9.5 Q12 6.5 14.5 9.5 Q14.5 11.5 12 12.5 V14 M12 17 V17.2" /></>)}
  </svg>
);

const Capsule: React.FC = () => (
  <g transform="rotate(-40 11 11)">
    <rect x="2" y="6.5" width="18" height="9" rx="4.5" fill="#fff" stroke="#000" strokeWidth="1.8" />
    <path d="M11 6.5 H15.5 A4.5 4.5 0 0 1 15.5 15.5 H11 Z" fill="#000" />
  </g>
);

const Tick: React.FC = () => (
  <g>
    <circle cx="19" cy="19" r="5" fill="#000" />
    <path d="M16.6 19 L18.4 20.8 L21.6 17.2" stroke="#fff" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </g>
);

const Cross: React.FC = () => (
  <g>
    <circle cx="19" cy="19" r="5" fill="#000" />
    <path d="M16.8 16.8 L21.2 21.2 M21.2 16.8 L16.8 21.2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
  </g>
);

// Swallow ability: tablet + tick (can swallow), tablet + cross (liquids only),
// feeding tube, or an IV drip bag.
export const SwallowIcon: React.FC<{ kind: string; size?: number }> = ({ kind, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" style={{ flexShrink: 0 }}>
    {kind === 'tablets' && (<><Capsule /><Tick /></>)}
    {kind === 'liquid_only' && (<><Capsule /><Cross /></>)}
    {kind === 'ng_tube' && (
      <g fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4 C 10 4 6 12 13 12 C 19 12 17 20 22 22" />
        <circle cx="3" cy="4" r="1.6" fill="#000" />
        <path d="M20 19.5 L24 21 L22.5 24.5" />
      </g>
    )}
    {kind === 'iv_only' && (
      <g fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="2" width="12" height="11" rx="2.5" fill="#fff" />
        <path d="M12 6 C 10.5 8 10.5 10 12 10.5 C 13.5 10 13.5 8 12 6 Z" fill="#000" />
        <path d="M12 13 V19 M9.5 19 H14.5 M12 19 V24" />
      </g>
    )}
  </svg>
);

// Head-and-shoulders person; the doctor gets a small cross on the chest.
export const PersonIcon: React.FC<{ doctor?: boolean; size?: number }> = ({ doctor, size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 26 26" fill="none" stroke="#000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="13" cy="8" r="4.5" />
    <path d="M4 24 C4 17 8 15 13 15 C18 15 22 17 22 24 Z" />
    {doctor && <path d="M13 17.5 V22 M10.8 19.8 H15.2" strokeWidth="1.6" />}
  </svg>
);

const stroke = { fill: 'none', stroke: '#000', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const WarningIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 3 L22 20 H2 Z" /><path d="M12 10 V14.5 M12 17 V17.2" /></svg>
);
export const PortIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true" style={{ flexShrink: 0 }}><circle cx="8" cy="8" r="4.5" /><path d="M11.5 11.5 C14 14 16 15 18 20" /></svg>
);
export const PhoneIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 3 H9 L11 8 L8.5 9.8 C9.8 12.5 11.5 14.2 14.2 15.5 L16 13 L21 15 V19 C21 20 20 21 19 21 C10.5 20.5 3.5 13.5 3 5 C3 4 4 3 5 3 Z" /></svg>
);
