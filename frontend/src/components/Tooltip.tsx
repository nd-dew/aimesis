import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// One global hover box. Any element (HTML or SVG) with a data-tip attribute shows it.
// It is position:fixed with the maximum z-index, so scroll containers can never clip or cover it.
interface Tip { text: string; x: number; y: number }

export const Tooltip: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const find = (t: EventTarget | null) => (t as Element | null)?.closest?.('[data-tip]') as Element | null;
    const move = (e: MouseEvent) => {
      const el = find(e.target);
      const text = el?.getAttribute('data-tip');
      setTip(text ? { text, x: e.clientX, y: e.clientY } : null);
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      const text = el?.getAttribute('data-tip');
      if (el && text) { const r = el.getBoundingClientRect(); setTip({ text, x: r.left, y: r.bottom }); }
    };
    const clear = () => setTip(null);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseleave', clear);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', clear);
    document.addEventListener('scroll', clear, true);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', clear);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', clear);
      document.removeEventListener('scroll', clear, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(8, Math.min(tip.x + 14, vw - width - 8));
    const top = tip.y + 20 + height > vh ? Math.max(8, tip.y - height - 12) : tip.y + 20;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} className="tip-box" role="tooltip" style={{ left: pos.left, top: pos.top }}>
      {tip.text}
    </div>
  );
};
