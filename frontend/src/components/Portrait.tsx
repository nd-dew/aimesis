import React, { useId } from 'react';
import { Patient } from '../types';

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// DEMO portrait: a shaded grayscale drawing that stands in for a real photo (the record has no photo
// field). Hair, glasses and head size vary with the patient's id, sex and age.
export const Portrait: React.FC<{ patient: Patient; size?: number }> = ({ patient: p, size = 88 }) => {
  const u = useId().replace(/[^a-zA-Z0-9]/g, '');
  const h = hash(p.id);
  const child = p.age_years < 6;
  const longHair = p.sex === 'F' || (p.sex !== 'M' && h % 2 === 0);
  const glasses = h % 3 === 0;
  const rx = child ? 21 : 19, ry = child ? 24 : 23, dy = child ? 3 : 0;
  const hairDark = h % 2 === 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Placeholder portrait of ${p.alias}`} style={{ border: '1px solid #111', display: 'block', background: '#999', flexShrink: 0 }}>
      <defs>
        <linearGradient id={`bg${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d6d6d6" /><stop offset="1" stopColor="#7e7e7e" /></linearGradient>
        <radialGradient id={`sk${u}`} cx="45%" cy="40%" r="65%"><stop offset="0" stopColor="#f1f1f1" /><stop offset=".7" stopColor="#cfcfcf" /><stop offset="1" stopColor="#a8a8a8" /></radialGradient>
        <linearGradient id={`hr${u}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={hairDark ? '#2a2a2a' : '#505050'} /><stop offset="1" stopColor={hairDark ? '#5a5a5a' : '#8a8a8a'} /></linearGradient>
        <linearGradient id={`sh${u}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ececec" /><stop offset="1" stopColor="#a9a9a9" /></linearGradient>
        <radialGradient id={`ch${u}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#999" stopOpacity=".35" /><stop offset="1" stopColor="#999" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#bg${u})`} />
      {longHair && <path d="M26 40 C22 18 78 18 74 40 L80 92 L20 92 Z" fill={`url(#hr${u})`} />}
      <path d="M6 100 C8 82 26 76 50 76 C74 76 92 82 94 100 Z" fill={`url(#sh${u})`} />
      <path d="M41 62 L41 78 C46 83 54 83 59 78 L59 62 Z" fill="#bdbdbd" />
      <g transform={`translate(0 ${dy})`}>
        <ellipse cx="50" cy="46" rx={rx} ry={ry} fill={`url(#sk${u})`} />
        <ellipse cx="38" cy="54" rx="6" ry="5" fill={`url(#ch${u})`} /><ellipse cx="62" cy="54" rx="6" ry="5" fill={`url(#ch${u})`} />
        <path d="M30 42 C30 22 70 22 70 42 C64 33 58 31 50 31 C42 31 36 33 30 42 Z" fill={`url(#hr${u})`} />
        <path d="M37 42 Q42 39.5 46 41.5" stroke="#3a3a3a" strokeWidth="1.4" fill="none" strokeLinecap="round" /><path d="M54 41.5 Q58 39.5 63 42" stroke="#3a3a3a" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <ellipse cx="41.5" cy="46.5" rx="3.4" ry="2.2" fill="#fff" /><ellipse cx="58.5" cy="46.5" rx="3.4" ry="2.2" fill="#fff" />
        <circle cx="41.5" cy="46.5" r="1.7" fill="#222" /><circle cx="58.5" cy="46.5" r="1.7" fill="#222" /><circle cx="42.1" cy="46" r=".5" fill="#fff" /><circle cx="59.1" cy="46" r=".5" fill="#fff" />
        <path d="M50 49 C49 53 47.5 56 49 57.5 C50 58 51 58 52 57.5 C53.5 56 51 53 50 49 Z" fill="#9c9c9c" opacity=".55" />
        <path d="M43.5 63 Q50 67 56.5 63 Q50 65 43.5 63 Z" fill="#6b6b6b" /><path d="M44.5 63.2 Q50 61.6 55.5 63.2" stroke="#7a7a7a" strokeWidth="1" fill="none" />
        {glasses && <g fill="none" stroke="#222" strokeWidth="1.3"><circle cx="41.5" cy="46.5" r="6.5" /><circle cx="58.5" cy="46.5" r="6.5" /><path d="M48 46.5 H52" /></g>}
      </g>
    </svg>
  );
};
