import React from 'react';
import { Patient } from '../types';

// Small technical-drawing figure: height arrow, weight in the torso, BSA as the hatched halo.
// Everything else about the patient lives next to it in the panel.
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const BodyFigure: React.FC<{ patient: Patient }> = ({ patient: p }) => {
  const h = p.height_cm, w = p.weight_kg;
  const bmi = h && w ? w / Math.pow(h / 100, 2) : 19;
  const k = clamp(bmi / 19, 0.8, 1.35);                    // build: wider body for higher BMI
  const r = clamp(30 + (16 - p.age_years) * 1.6, 28, 52);  // children have relatively bigger heads

  // The body is designed at full size (444 units tall) and drawn at about half size.
  const S = 0.489, CX = 76, TOP = 11, FULL = 444, BOTTOM = TOP + FULL * S;
  const X = (x: number) => CX + (x - CX) * S;
  const Y = (y: number) => TOP + (y - TOP) * S;

  const bodyTop = TOP, bodyBottom = TOP + FULL;
  const headCy = bodyTop + r;
  const neckBottom = bodyTop + 2 * r + 10;
  const shY = neckBottom + 4;
  const rem = bodyBottom - shY;
  const torsoH = rem * 0.46;
  const hipY = shY + torsoH;
  const sh = 46 * k + 6, hh = 38 * k;
  const armW = 13 * k, legW = 22 * k;
  const elbowY = shY + torsoH * 0.55;
  const kneeY = hipY + (bodyBottom - hipY) * 0.5;
  const pad = 12;
  const torso = `M ${CX - sh} ${shY} Q ${CX} ${shY - 8} ${CX + sh} ${shY} L ${CX + hh} ${hipY} Q ${CX} ${hipY + 8} ${CX - hh} ${hipY} Z`;
  const limbs = [
    { pts: `${CX - sh + 2},${shY + 8} ${CX - sh - 16},${elbowY} ${CX - sh - 20},${hipY + 6}`, w: armW },
    { pts: `${CX + sh - 2},${shY + 8} ${CX + sh + 16},${elbowY} ${CX + sh + 20},${hipY + 6}`, w: armW },
    { pts: `${CX - hh * 0.5},${hipY - 4} ${CX - hh * 0.55},${kneeY} ${CX - hh * 0.55},${bodyBottom - 6}`, w: legW },
    { pts: `${CX + hh * 0.5},${hipY - 4} ${CX + hh * 0.55},${kneeY} ${CX + hh * 0.55},${bodyBottom - 6}`, w: legW },
  ];
  const DIM = 16;
  const wY = Y((shY + hipY) / 2);

  return (
    <svg className="body-figure" viewBox="0 0 130 236" role="img" aria-label={`${p.alias}: height, weight and body surface`}>
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#000" /></marker>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#777" strokeWidth="1.2" /></pattern>
      </defs>

      <g transform={`translate(${CX} ${TOP}) scale(${S}) translate(${-CX} ${-TOP})`}>
        <g fill="url(#hatch)" stroke="url(#hatch)" strokeLinecap="round" strokeLinejoin="round"
          data-tip={`Hatched halo: the skin surface, the body surface area (BSA) ${p.bsa_m2 ?? '?'} m² listed next to the drawing. Chemotherapy and ondansetron are dosed per m², so the dose is that number times BSA.`}>
          <circle cx={CX} cy={headCy} r={r + pad} stroke="none" />
          <path d={torso} strokeWidth={pad * 2} />
          {limbs.map((l, i) => <polyline key={i} points={l.pts} fill="none" strokeWidth={l.w + pad * 2} />)}
          <ellipse cx={CX - hh * 0.55} cy={bodyBottom - 5} rx={legW / 2 + pad + 4} ry={pad + 5} stroke="none" />
          <ellipse cx={CX + hh * 0.55} cy={bodyBottom - 5} rx={legW / 2 + pad + 4} ry={pad + 5} stroke="none" />
        </g>
        <g strokeLinecap="round" strokeLinejoin="round" fill="none"
          data-tip="Schematic body, not a scan. Head size follows age (children have bigger heads) and body width follows BMI (weight vs height).">
          {limbs.map((l, i) => <polyline key={`o${i}`} points={l.pts} stroke="#000" strokeWidth={l.w + 4} />)}
          {limbs.map((l, i) => <polyline key={`i${i}`} points={l.pts} stroke="#fff" strokeWidth={l.w} />)}
          <rect x={CX - 6} y={bodyTop + 2 * r - 4} width="12" height="16" fill="#fff" stroke="#000" strokeWidth="3" />
          <path d={torso} fill="#fff" stroke="#000" strokeWidth="3" />
          <circle cx={CX} cy={headCy} r={r} fill="#fff" stroke="#000" strokeWidth="3" />
          <path d={`M ${CX - r * 0.35} ${headCy + r * 0.45} Q ${CX} ${headCy + r * 0.62} ${CX + r * 0.35} ${headCy + r * 0.45}`} stroke="#000" strokeWidth="3" fill="none" />
          <circle cx={CX - r * 0.35} cy={headCy - r * 0.1} r="3.5" fill="#000" stroke="none" />
          <circle cx={CX + r * 0.35} cy={headCy - r * 0.1} r="3.5" fill="#000" stroke="none" />
        </g>
      </g>

      <g data-tip={`Height ${h ?? '?'} cm, drawn as a dimension line from head to foot.Together with weight it gives the body surface area.`}>
        <line x1={DIM - 8} y1={TOP} x2={X(CX) - 4} y2={TOP} stroke="#888" strokeDasharray="3 3" />
        <line x1={DIM - 8} y1={BOTTOM} x2={X(CX - hh * 0.55) - 14} y2={BOTTOM} stroke="#888" strokeDasharray="3 3" />
        <line x1={DIM} y1={TOP} x2={DIM} y2={BOTTOM} stroke="#000" strokeWidth="1.5" markerStart="url(#arr)" markerEnd="url(#arr)" />
        <g transform={`translate(${DIM} ${(TOP + BOTTOM) / 2}) rotate(-90)`}>
          <rect x="-34" y="-12" width="68" height="24" fill="#fff" />
          <text textAnchor="middle" y="6" fontSize="16" fontWeight="800">{h != null ? `${h} cm` : 'height ?'}</text>
        </g>
      </g>

      <g data-tip={`Weight ${w ?? '?'} kg.Olanzapine is dosed at 0.1 mg/kg (rounded down to 0.5 mg, max 5 mg), and weight is also used for BSA.`}>
        <rect x={CX - 21} y={wY - 13} width="42" height="26" fill="#fff" stroke="#000" strokeWidth="1.5"  />
        <text x={CX} y={wY + 5} textAnchor="middle" fontSize="14" fontWeight="800">{w != null ? `${w} kg` : 'weight ?'}</text>
      </g>
    </svg>
  );
};
