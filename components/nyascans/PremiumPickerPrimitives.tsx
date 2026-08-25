import {
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
} from "@phosphor-icons/react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type PickerDate = Date;

export function parsePickerDate(value?: string | null) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function toPickerIso(date: Date) {
  return new Date(date.getTime()).toISOString();
}

export function formatPickerDate(value?: string | Date | null, placeholder = "Select date") {
  if (!value) return placeholder;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return placeholder;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatPickerTime(value?: string | Date | null, placeholder = "Select time") {
  if (!value) return placeholder;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return placeholder;
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function sameDay(left: Date | null | undefined, right: Date | null | undefined) {
  return Boolean(left && right && dateKey(left) === dateKey(right));
}

export function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function daysBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000) + 1);
}

export function monthGrid(viewMonth: Date) {
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const lastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const previousMonthLastDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - startOffset + 1;
    const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), dayOffset);
    return {
      date,
      day: date.getDate(),
      key: dateKey(date),
      outside: dayOffset < 1 || dayOffset > lastDay,
      previousDay: dayOffset < 1 ? previousMonthLastDay + dayOffset : null,
    };
  });
}

export function shiftMonth(value: Date, offset: number) {
  return new Date(value.getFullYear(), value.getMonth() + offset, 1);
}

export function MonthYearNavigator({
  viewMonth,
  setViewMonth,
  menu,
  setMenu,
  className = "",
}: {
  viewMonth: Date;
  setViewMonth: Dispatch<SetStateAction<Date>>;
  menu: "month" | "year" | null;
  setMenu: Dispatch<SetStateAction<"month" | "year" | null>>;
  className?: string;
}) {
  const year = viewMonth.getFullYear();
  const years = useMemo(() => Array.from({ length: 101 }, (_, index) => year - 50 + index), [year]);
  const [monthFilter, setMonthFilter] = useState("");

  return (
    <div className={`premium-picker-month-nav ${className}`.trim()}>
      <button type="button" className="premium-picker-icon-button" aria-label="Previous month" onClick={() => setViewMonth((current) => shiftMonth(current, -1))}>
        <CaretLeft size={17} aria-hidden="true" />
      </button>
      <div className="premium-picker-month-selects">
        <div className="premium-picker-menu-anchor">
          <button type="button" className="premium-picker-select-button" aria-haspopup="listbox" aria-expanded={menu === "month"} onClick={() => setMenu((current) => current === "month" ? null : "month")}>
            <span>{MONTH_NAMES[viewMonth.getMonth()]}</span><CaretDown size={14} aria-hidden="true" />
          </button>
          {menu === "month" ? (
            <div className="premium-picker-menu" role="listbox" aria-label="Select month">
              <input aria-label="Filter months" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} placeholder="Find month" />
              {MONTH_NAMES.filter((month) => month.toLowerCase().includes(monthFilter.toLowerCase())).map((month, index) => (
                <button key={month} type="button" role="option" aria-selected={index === viewMonth.getMonth()} onClick={() => { setViewMonth(new Date(year, index, 1)); setMenu(null); setMonthFilter(""); }}>
                  <span>{month}</span>{index === viewMonth.getMonth() ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="premium-picker-menu-anchor">
          <button type="button" className="premium-picker-select-button premium-picker-year-button" aria-haspopup="listbox" aria-expanded={menu === "year"} onClick={() => setMenu((current) => current === "year" ? null : "year")}>
            <span>{year}</span><CaretDown size={14} aria-hidden="true" />
          </button>
          {menu === "year" ? (
            <div className="premium-picker-menu premium-picker-year-menu" role="listbox" aria-label="Select year">
              {years.map((optionYear) => (
                <button key={optionYear} type="button" role="option" aria-selected={optionYear === year} onClick={() => { setViewMonth(new Date(optionYear, viewMonth.getMonth(), 1)); setMenu(null); }}>
                  <span>{optionYear}</span>{optionYear === year ? <Check size={15} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <button type="button" className="premium-picker-icon-button" aria-label="Next month" onClick={() => setViewMonth((current) => shiftMonth(current, 1))}>
        <CaretRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

export function CalendarWeekHeader() {
  return <div className="premium-picker-week-header" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>;
}

export function PickerCalendarGrid({
  viewMonth,
  selected,
  onSelect,
  rangeStart,
  rangeEnd,
}: {
  viewMonth: Date;
  selected?: Date | null;
  onSelect: (date: Date) => void;
  rangeStart?: Date | null;
  rangeEnd?: Date | null;
}) {
  const cells = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  return (
    <div className="premium-picker-calendar-grid" role="grid" aria-label={`${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`}>
      {cells.map((cell) => {
        const inRange = Boolean(rangeStart && rangeEnd && cell.date >= startOfDay(rangeStart) && cell.date <= endOfDay(rangeEnd));
        const isStart = sameDay(cell.date, rangeStart);
        const isEnd = sameDay(cell.date, rangeEnd);
        return (
          <button
            key={cell.key}
            type="button"
            role="gridcell"
            className={[
              "premium-picker-day",
              cell.outside ? "is-outside" : "",
              sameDay(cell.date, selected) ? "is-selected" : "",
              inRange ? "is-in-range" : "",
              isStart ? "is-range-start" : "",
              isEnd ? "is-range-end" : "",
            ].filter(Boolean).join(" ")}
            aria-label={cell.date.toLocaleDateString("en-US", { dateStyle: "full" })}
            aria-pressed={sameDay(cell.date, selected) || isStart || isEnd}
            onClick={() => onSelect(cell.date)}
          >
            <span>{cell.day}</span>
          </button>
        );
      })}
    </div>
  );
}
