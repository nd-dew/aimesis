import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, X, Clock, ArrowRight } from 'lucide-react';
import { apiFetch } from '../api';

export interface CalendarEvent {
  date: string;
  cycle_id: string;
  cycle_label: string;
  course_type: string;
  status: 'planned' | 'given';
  patient_id: string;
  patient_alias: string;
  protocol: string;
  diagnosis: string;
  regimen_summary: string;
  is_multiday: boolean;
  tier: string;
}

interface DoctorCalendarProps {
  currentPatientId?: string;
  onSelectVisit?: (cycleId: string) => void;
}

export const DoctorCalendar: React.FC<DoctorCalendarProps> = ({
  currentPatientId,
  onSelectVisit,
}) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState('2026-09-25');
  const [viewYear, setViewYear] = useState(2026);
  const [viewMonth, setViewMonth] = useState(8); // 8 is September (0-indexed)

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ignore = false;
    const fetchEvents = async () => {
      try {
        const res = await apiFetch('/api/calendar/events');
        if (res.ok) {
          const data = await res.json();
          if (!ignore) {
            setEvents(data.events || []);
            if (data.default_date) {
              setSelectedDate(data.default_date);
              const [y, m] = data.default_date.split('-').map(Number);
              setViewYear(y);
              setViewMonth(m - 1);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load calendar events', err);
      }
    };
    fetchEvents();
    return () => {
      ignore = true;
    };
  }, []);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setSelectedDate('2026-09-25');
    setViewYear(2026);
    setViewMonth(8);
  };

  // Group events by date string "YYYY-MM-DD"
  const eventsByDate = React.useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of events) {
      if (!ev.date) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [events]);

  const selectedDayEvents = eventsByDate[selectedDate] || [];

  // Generate calendar grid days for viewYear, viewMonth
  const calendarDays = React.useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const numDays = lastDay.getDate();

    // Monday as start of week (0: Mon, ..., 6: Sun)
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: Array<{
      dateStr: string;
      dayNum: number;
      isCurrentMonth: boolean;
      eventCount: number;
      hasPlanned: boolean;
    }> = [];

    // Prev month padding
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const m = viewMonth === 0 ? 12 : viewMonth;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: false,
        eventCount: eventsByDate[dateStr]?.length || 0,
        hasPlanned: (eventsByDate[dateStr] || []).some((e) => e.status === 'planned'),
      });
    }

    // Current month days
    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: true,
        eventCount: eventsByDate[dateStr]?.length || 0,
        hasPlanned: (eventsByDate[dateStr] || []).some((e) => e.status === 'planned'),
      });
    }

    // Next month padding to fill grid
    const remaining = 35 - days.length >= 0 ? 35 - days.length : 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 1 : viewMonth + 2;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: d,
        isCurrentMonth: false,
        eventCount: eventsByDate[dateStr]?.length || 0,
        hasPlanned: (eventsByDate[dateStr] || []).some((e) => e.status === 'planned'),
      });
    }

    return days;
  }, [viewYear, viewMonth, eventsByDate]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const handleOpenEvent = (ev: CalendarEvent) => {
    setIsOpen(false);
    if (ev.patient_id === currentPatientId) {
      if (onSelectVisit) {
        onSelectVisit(ev.cycle_id);
      }
    } else {
      const url = new URL(window.location.href);
      url.searchParams.set('patient', ev.patient_id);
      url.searchParams.set('visit', ev.cycle_id);
      window.location.href = url.toString();
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }
    } catch {
      // fallback
    }
    return dateStr;
  };

  const plannedCount = React.useMemo(() => {
    return events.filter((e) => e.status === 'planned').length;
  }, [events]);

  return (
    <div className="doc-calendar-wrap" ref={containerRef}>
      <button
        type="button"
        className={`qr-btn doc-calendar-btn ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Open Doctor's Chemo Calendar and Daily Agenda"
        aria-expanded={isOpen}
      >
        <Calendar size={18} aria-hidden="true" />
        <span className="qr-btn-text">
          <small>Doctor's Agenda</small>
          <strong>
            {formatDateDisplay(selectedDate)}
            <span className="doc-cal-badge" title={`${selectedDayEvents.length} visits on this day`}>
              {selectedDayEvents.length}
            </span>
          </strong>
        </span>
      </button>

      {isOpen && (
        <div className="doc-calendar-popover" role="dialog" aria-label="Chemotherapy Schedule Calendar">
          <div className="doc-cal-header">
            <div className="doc-cal-title-row">
              <div className="doc-cal-heading">
                <strong>Pediatric Oncology Chemo Calendar</strong>
                <span className="doc-cal-subhead">
                  {plannedCount} upcoming planned cycles across active cohort
                </span>
              </div>
              <button
                type="button"
                className="doc-cal-close-btn"
                onClick={() => setIsOpen(false)}
                aria-label="Close calendar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="doc-cal-nav-row">
              <div className="doc-cal-month-nav">
                <button
                  type="button"
                  className="ws-btn doc-cal-nav-btn"
                  onClick={handlePrevMonth}
                  title="Previous Month"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="doc-cal-month-label">
                  {monthNames[viewMonth]} {viewYear}
                </span>
                <button
                  type="button"
                  className="ws-btn doc-cal-nav-btn"
                  onClick={handleNextMonth}
                  title="Next Month"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              <button
                type="button"
                className="ws-btn doc-cal-today-btn"
                onClick={handleToday}
                title="Go to Today's Clinical Date (25 Sep 2026)"
              >
                Today (25 Sep)
              </button>
            </div>
          </div>

          <div className="doc-cal-grid-container">
            <div className="doc-cal-weekdays">
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
              <span>Su</span>
            </div>
            <div className="doc-cal-days">
              {calendarDays.map((cd) => {
                const isSelected = cd.dateStr === selectedDate;
                const isToday = cd.dateStr === '2026-09-25';
                return (
                  <button
                    key={cd.dateStr}
                    type="button"
                    className={`doc-cal-day-cell ${
                      !cd.isCurrentMonth ? 'other-month' : ''
                    } ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${
                      cd.eventCount > 0 ? 'has-events' : ''
                    }`}
                    onClick={() => {
                      setSelectedDate(cd.dateStr);
                    }}
                    title={`${cd.dateStr}: ${cd.eventCount} visit(s)`}
                  >
                    <span className="doc-cal-day-num">{cd.dayNum}</span>
                    {cd.eventCount > 0 && (
                      <span
                        className={`doc-cal-event-dot ${
                          cd.hasPlanned ? 'planned' : 'given'
                        }`}
                      >
                        {cd.eventCount > 1 ? cd.eventCount : ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="doc-cal-agenda">
            <div className="doc-cal-agenda-header">
              <span className="doc-cal-agenda-date">
                <Clock size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                <strong>Agenda: {formatDateDisplay(selectedDate)}</strong>
              </span>
              <span className="ws-dim" style={{ fontSize: '0.75rem' }}>
                {selectedDayEvents.length}{' '}
                {selectedDayEvents.length === 1 ? 'Patient Visit' : 'Patient Visits'}
              </span>
            </div>

            <div className="doc-cal-agenda-list">
              {selectedDayEvents.length === 0 ? (
                <div className="doc-cal-empty">
                  No chemotherapy visits scheduled on this date.
                </div>
              ) : (
                selectedDayEvents.map((ev) => {
                  const isCurrent = ev.patient_id === currentPatientId;
                  return (
                    <div
                      key={ev.cycle_id}
                      className={`doc-cal-card ${isCurrent ? 'current-patient' : ''}`}
                      onClick={() => handleOpenEvent(ev)}
                    >
                      <div className="doc-cal-card-top">
                        <span className="doc-cal-patient-alias">
                          <strong>{ev.patient_alias}</strong>
                          {isCurrent && (
                            <span className="doc-cal-curr-pill">ON SCREEN</span>
                          )}
                        </span>
                        <div className="doc-cal-card-badges">
                          <span
                            className={`chip ${
                              ev.status === 'planned' ? 'chip-hazard' : 'chip-ok'
                            }`}
                            style={{ fontSize: '0.68rem', padding: '1px 5px' }}
                          >
                            {ev.status === 'planned' ? 'PLANNED' : 'GIVEN'}
                          </span>
                          <span
                            className="chip"
                            style={{
                              fontSize: '0.68rem',
                              padding: '1px 5px',
                              background: '#f0f0f0',
                              border: '1px solid #ccc',
                            }}
                          >
                            {ev.tier} RISK
                          </span>
                        </div>
                      </div>

                      <div className="doc-cal-card-details">
                        <div className="doc-cal-card-line">
                          <span className="doc-cal-card-lbl">Protocol / Cycle:</span>
                          <span className="doc-cal-card-val">
                            {ev.protocol} · Visit {ev.cycle_label}
                          </span>
                        </div>
                        <div className="doc-cal-card-line">
                          <span className="doc-cal-card-lbl">Regimen:</span>
                          <span className="doc-cal-card-val">{ev.regimen_summary}</span>
                        </div>
                      </div>

                      <div className="doc-cal-card-action">
                        <span>
                          {isCurrent ? 'Jump to visit details' : 'Open patient workspace'}
                        </span>
                        <ArrowRight size={13} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
