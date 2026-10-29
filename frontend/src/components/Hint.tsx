import React from 'react';
import { HelpCircle } from 'lucide-react';

// "?" icon with a hover explanation. The text is shown by the global <Tooltip/> (see Tooltip.tsx),
// so it is never clipped by a scrolling panel. `align` is kept for old callers and ignored.
export const Hint: React.FC<{ text: string; align?: 'left' | 'right' }> = ({ text }) => (
  <span className="hint" tabIndex={0} data-tip={text}>
    <HelpCircle size={14} />
  </span>
);

// Marks a block whose data is fake / not wired to a backend yet.
export const Mock: React.FC<{ why?: string }> = ({ why }) => (
  <span className="mock-tag" data-tip={why || 'Sample data, not connected to the backend yet'}>MOCK</span>
);

interface SectionProps {
  title: string;
  hint: string;
  mock?: boolean;
  align?: 'left' | 'right';
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ title, hint, mock, align, actions, children }) => (
  <section className="ws-section" data-tip={hint}>
    <header className="ws-section-head">
      <h3>{title}</h3>
      <Hint text={hint} align={align} />
      {mock && <Mock />}
      <span style={{ flex: 1 }} />
      {actions}
    </header>
    {children}
  </section>
);
