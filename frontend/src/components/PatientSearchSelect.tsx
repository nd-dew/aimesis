import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';
import { Patient } from '../types';

interface PatientSearchSelectProps {
  patients: Patient[];
  selectedId: string;
  onSelect: (patientId: string) => void;
}

export const PatientSearchSelect: React.FC<PatientSearchSelectProps> = ({
  patients,
  selectedId,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedPatient = patients.find((p) => p.id === selectedId) || null;

  // Filter patients based on query
  const filtered = patients.filter((p) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      p.alias.toLowerCase().includes(q) ||
      (p.protocol && p.protocol.toLowerCase().includes(q)) ||
      (p.diagnosis_text && p.diagnosis_text.toLowerCase().includes(q))
    );
  });

  // Handle outside click to close
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1 < filtered.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev - 1 >= 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlightIdx]) {
        onSelect(filtered[highlightIdx].id);
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  const handleSelect = (patientId: string) => {
    onSelect(patientId);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div className="patient-search-wrap" ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        className="patient-search-box"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: '#fff',
          border: '1px solid #111',
          borderRadius: '2px',
          padding: '0.12rem 0.45rem',
          cursor: 'text',
        }}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search size={13} color="#666" style={{ flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          className="patient-search-input"
          placeholder={selectedPatient ? `${selectedPatient.alias}` : 'Search patient...'}
          value={open ? query : (selectedPatient ? `${selectedPatient.alias} (${selectedPatient.protocol})` : '')}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightIdx(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onKeyDown={handleKeyDown}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: 'inherit',
            fontSize: '0.84rem',
            fontWeight: 700,
            color: '#111',
            width: '250px',
          }}
        />
        <ChevronDown
          size={13}
          color="#666"
          style={{ flexShrink: 0, cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
            if (!open) inputRef.current?.focus();
          }}
        />
      </div>

      {open && (
        <div
          className="patient-search-dropdown"
          style={{
            position: 'absolute',
            zIndex: 200,
            top: 'calc(100% + 4px)',
            left: 0,
            width: '340px',
            maxHeight: '320px',
            overflowY: 'auto',
            background: '#fff',
            border: '2px solid #000',
            boxShadow: '4px 4px 0 rgba(0,0,0,0.25)',
            fontSize: '0.82rem',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem', color: '#666', textAlign: 'center' }}>
              No matching patients found.
            </div>
          ) : (
            filtered.map((pt, idx) => {
              const isSelected = pt.id === selectedId;
              const isHighlighted = idx === highlightIdx;
              return (
                <div
                  key={pt.id}
                  onClick={() => handleSelect(pt.id)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                  style={{
                    padding: '0.45rem 0.65rem',
                    cursor: 'pointer',
                    background: isHighlighted ? '#eee' : isSelected ? '#fafafa' : '#fff',
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <strong style={{ fontSize: '0.85rem', color: '#111' }}>{pt.alias}</strong>
                      {isSelected && <span className="chip chip-ok" style={{ fontSize: '0.62rem', padding: '0 0.3rem' }}>ACTIVE</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#444', marginTop: '0.15rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {pt.protocol}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#777', marginTop: '0.1rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {pt.diagnosis_text}
                    </div>
                  </div>
                  {isSelected && <Check size={14} color="#000" style={{ marginLeft: '0.5rem', flexShrink: 0 }} />}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
