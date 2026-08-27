import {
  CalendarBlank,
  Check,
  Eraser,
  X,
} from "@/components/nyascans/heroicons";
import { useEffect, useRef, useState } from "react";
import {
  CalendarWeekHeader,
  daysBetween,
  formatPickerDate,
  formatPickerTime,
  MonthYearNavigator,
  parsePickerDate,
  PickerCalendarGrid,
} from "./PremiumPickerPrimitives";

export function PremiumDateRangePicker({
  start,
  end,
  onChange,
  label = "Date Range",
  disabled = false,
  className = "",
  valueFormat = "iso",
  includeTime = false,
}: {
  start?: string | null;
  end?: string | null;
  onChange: (range: { start: string | null; end: string | null }) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  valueFormat?: "iso" | "date";
  includeTime?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(() => start ? parsePickerDate(start) : null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(() => end ? parsePickerDate(end) : null);
  const [viewMonth, setViewMonth] = useState(() => {
    const date = start ? parsePickerDate(start) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [menu, setMenu] = useState<"month" | "year" | null>(null);

  useEffect(() => {
    if (!open) {
      setDraftStart(start ? parsePickerDate(start) : null);
      setDraftEnd(end ? parsePickerDate(end) : null);
    }
  }, [open, start, end]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setMenu(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectDate(date: Date) {
    const selected = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (!draftStart || (draftStart && draftEnd)) {
      setDraftStart(selected);
      setDraftEnd(null);
    } else if (selected.getTime() < draftStart.getTime()) {
      setDraftEnd(draftStart);
      setDraftStart(selected);
    } else {
      setDraftEnd(selected);
    }
    setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }

  function updateRangeTime(which: "start" | "end", value: string) {
    const current = which === "start" ? draftStart : draftEnd;
    if (!current || !value) return;
    const [hours, minutes] = value.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const next = new Date(current);
    next.setHours(hours, minutes, 0, 0);
    if (which === "start") setDraftStart(next);
    else setDraftEnd(next);
  }

  function timeInputValue(value: Date | null) {
    return value ? `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` : "";
  }

  function apply() {
    onChange({
      start: draftStart ? (valueFormat === "date" ? `${draftStart.getFullYear()}-${String(draftStart.getMonth() + 1).padStart(2, "0")}-${String(draftStart.getDate()).padStart(2, "0")}` : draftStart.toISOString()) : null,
      end: draftEnd ? (valueFormat === "date" ? `${draftEnd.getFullYear()}-${String(draftEnd.getMonth() + 1).padStart(2, "0")}-${String(draftEnd.getDate()).padStart(2, "0")}` : draftEnd.toISOString()) : null,
    });
    setOpen(false);
    setMenu(null);
  }

  function clear() {
    setDraftStart(null);
    setDraftEnd(null);
    onChange({ start: null, end: null });
  }

  function setQuickRange(kind: "today" | "last7" | "month") {
    const today = new Date();
    const rangeStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (kind === "last7") rangeStart.setDate(rangeStart.getDate() - 6);
    if (kind === "month") rangeStart.setDate(1);
    const rangeEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    setDraftStart(rangeStart);
    setDraftEnd(rangeEnd);
    setViewMonth(new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1));
  }

  const duration = daysBetween(draftStart, draftEnd);
  const shownStart = start ? formatPickerDate(start) : "Select start date";
  const shownEnd = end ? formatPickerDate(end) : "Select end date";
  const displayRangeValue = (value: string | null | undefined, placeholder: string) => value ? `${formatPickerDate(value)}${includeTime ? ` · ${formatPickerTime(value)}` : ""}` : placeholder;
  const displayDraftValue = (value: Date | null) => value ? `${formatPickerDate(value)}${includeTime ? ` · ${formatPickerTime(value)}` : ""}` : "—";

  return (
    <div ref={rootRef} className={`premium-picker premium-date-range-picker ${className}`.trim()}>
      <div className="premium-range-actions" role="toolbar" aria-label="Date range shortcuts">
        <button type="button" onClick={() => setQuickRange("today")} disabled={disabled}>Today</button>
        <button type="button" onClick={() => setQuickRange("last7")} disabled={disabled}>Last 7 Days</button>
        <button type="button" onClick={() => setQuickRange("month")} disabled={disabled}>This Month</button>
        <button type="button" onClick={clear} disabled={disabled}><Eraser size={16} />Clear</button>
        <button type="button" className="button button-primary" onClick={apply} disabled={disabled || (!draftStart && !draftEnd)}><Check size={17} />Apply Range</button>
      </div>
      <button type="button" className="premium-picker-trigger premium-range-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
        <span className="premium-picker-trigger-label">{label}</span>
        <span className="premium-range-trigger-value"><CalendarBlank size={18} />{displayRangeValue(start, shownStart)}<span aria-hidden="true">→</span>{displayRangeValue(end, shownEnd)}</span>
        <span className="premium-range-duration">{daysBetween(start ? parsePickerDate(start) : null, end ? parsePickerDate(end) : null)} Days</span>
      </button>
      {open ? (
        <div className="premium-picker-popover premium-date-range-popover" role="dialog" aria-label={label}>
          <div className="premium-picker-popover-head">
            <strong>Select a date range</strong>
            <button type="button" className="premium-picker-close" aria-label="Close picker" onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
          <div className="premium-date-range-layout">
            <aside className="premium-range-summary">
              <span className="premium-range-summary-icon"><CalendarBlank size={24} /></span>
              <strong>SELECTED RANGE</strong>
              <p>{displayDraftValue(draftStart)}</p>
              <span className="premium-range-arrow" aria-hidden="true">↓</span>
              <p>{displayDraftValue(draftEnd)}</p>
              <span className="premium-range-duration">{duration} Days</span>
            </aside>
            <section className="premium-picker-calendar-pane" aria-label="Calendar range selector">
              <MonthYearNavigator viewMonth={viewMonth} setViewMonth={setViewMonth} menu={menu} setMenu={setMenu} />
              <CalendarWeekHeader />
              <PickerCalendarGrid viewMonth={viewMonth} selected={null} rangeStart={draftStart} rangeEnd={draftEnd} onSelect={selectDate} />
            </section>
          </div>
          {includeTime ? (
            <div className="premium-range-time-fields" aria-label="Range times">
              <label><span>Start time</span><input type="time" value={timeInputValue(draftStart)} disabled={!draftStart} onChange={(event) => updateRangeTime("start", event.target.value)} /></label>
              <span className="premium-range-time-arrow" aria-hidden="true">→</span>
              <label><span>End time</span><input type="time" value={timeInputValue(draftEnd)} disabled={!draftEnd} onChange={(event) => updateRangeTime("end", event.target.value)} /></label>
            </div>
          ) : null}
          <div className="premium-picker-popover-footer">
            <span>{draftStart ? displayDraftValue(draftStart) : "Select start date"} → {draftEnd ? displayDraftValue(draftEnd) : "Select end date"}</span>
            <button type="button" className="button button-primary premium-picker-done" onClick={apply} disabled={!draftStart}><Check size={17} />Apply Range</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
