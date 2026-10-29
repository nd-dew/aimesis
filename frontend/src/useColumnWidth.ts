import React, { useRef, useState } from 'react';

// Draggable vertical gutter. `from` says which edge of the container the sized column hangs on.
const readW = (key: string, dflt: number) => {
  try { const v = parseInt(localStorage.getItem(key) || '', 10); return Number.isFinite(v) ? v : dflt; } catch { return dflt; }
};
export const useColumnWidth = (key: string, dflt: number, min: number, minOther: number, from: 'left' | 'right') => {
  const [w, setW] = useState(() => readW(key, dflt));
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add('ws-dragging');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const raw = from === 'left' ? e.clientX - r.left : r.right - e.clientX;
    setW(Math.round(Math.max(min, Math.min(r.width - minOther, raw))));
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    document.body.classList.remove('ws-dragging');
    try { localStorage.setItem(key, String(w)); } catch { /* storage unavailable */ }
  };
  const gutterProps = {
    className: `gutter ${dragging ? 'dragging' : ''}`,
    onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end,
    onDoubleClick: () => { setW(dflt); try { localStorage.removeItem(key); } catch { /* ignore */ } },
    title: 'Drag to resize · double-click to reset',
    role: 'separator' as const,
  };
  return { w, box, gutterProps };
};

