import {
  CalendarBlank,
  CalendarPlus,
  Check,
  Clock,
  X,
} from "@/components/nyascans/heroicons";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  CalendarWeekHeader,
  formatPickerDate,
  formatPickerTime,
  MonthYearNavigator,
  parsePickerDate,
  PickerCalendarGrid,
  toPickerIso,
} from "./PremiumPickerPrimitives";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function setHours12(date: Date, hour: number, period: "AM" | "PM") {
  const next = new Date(date);
  const normalized = clamp(Math.round(hour) || 12, 1, 12);
  next.setHours((normalized % 12) + (period === "PM" ? 12 : 0));
  return next;
}

export function PremiumDateTimePicker({
  value,
  onChange,
  label = "Date & Time",
  placeholder = "Choose date and time",
  disabled = false,
  className = "",
  mode = "datetime",
}: {
  value?: string | null;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mode?: "date" | "datetime";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parsePickerDate(value));
  const [viewMonth, setViewMonth] = useState(() => {
    const date = parsePickerDate(value);
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [menu, setMenu] = useState<"month" | "year" | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(parsePickerDate(value));
      const date = parsePickerDate(value);
      setViewMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }, [open, value]);

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

  const selected = value ? parsePickerDate(value) : null;
  const hour = ((draft.getHours() + 11) % 12) + 1;
  const minute = draft.getMinutes();
  const period: "AM" | "PM" = draft.getHours() >= 12 ? "PM" : "AM";

  function updateDraft(next: Date) {
    setDraft(next);
    setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  function updateTime(nextHour: number, nextMinute: number, nextPeriod: "AM" | "PM") {
    let next = setHours12(draft, nextHour, nextPeriod);
    next.setMinutes(clamp(nextMinute, 0, 59), 0, 0);
    setDraft(next);
  }

  function changeHour(delta: number) {
    updateTime(((hour - 1 + delta + 12) % 12) + 1, minute, period);
  }

  function changeMinute(delta: number) {
    const nextMinute = (minute + delta + 60) % 60;
    updateTime(hour, nextMinute, period);
  }

  function editNumber(field: "hour" | "minute", event: ChangeEvent<HTMLInputElement>) {
    const digits = event.target.value.replace(/\D/gu, "");
    const number = Number(digits);
    if (!digits) return;
    if (field === "hour") updateTime(clamp(number, 1, 12), minute, period);
    else updateTime(hour, clamp(number, 0, 59), period);
  }

  function apply() {
    onChange(toPickerIso(draft));
    setOpen(false);
    setMenu(null);
  }

  return (
    <div ref={rootRef} className={`premium-picker premium-date-time-picker ${className}`.trim()}>
      <button
        type="button"
        className="premium-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="premium-picker-trigger-label">{label}</span>
        <span className="premium-picker-trigger-content">
          <span><CalendarBlank size={18} aria-hidden="true" />{value ? formatPickerDate(value) : placeholder}</span>
          {mode === "datetime" ? <><span className="premium-picker-trigger-divider" aria-hidden="true" /><span><Clock size={18} aria-hidden="true" />{value ? formatPickerTime(value) : "Choose time"}</span></> : null}
        </span>
        <CalendarPlus size={19} aria-hidden="true" />
      </button>
      {open ? (
        <div className="premium-picker-popover premium-date-time-popover" role="dialog" aria-label={label}>
          <div className="premium-picker-popover-head">
            <strong>{label}</strong>
            <button type="button" className="premium-picker-close" aria-label="Close picker" onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
          <div className={`premium-date-time-layout ${mode === "date" ? "is-date-only" : ""}`}>
            <section className="premium-picker-calendar-pane" aria-label="Calendar">
              <MonthYearNavigator viewMonth={viewMonth} setViewMonth={setViewMonth} menu={menu} setMenu={setMenu} />
              <CalendarWeekHeader />
              <PickerCalendarGrid viewMonth={viewMonth} selected={draft} onSelect={(date) => updateDraft(new Date(date.getFullYear(), date.getMonth(), date.getDate(), draft.getHours(), draft.getMinutes()))} />
              <div className="premium-picker-quick-actions">
                <button type="button" onClick={() => updateDraft(new Date())}><CalendarBlank size={16} />Today</button>
                <button type="button" onClick={() => { const now = new Date(); updateTime(((now.getHours() + 11) % 12) + 1, now.getMinutes(), now.getHours() >= 12 ? "PM" : "AM"); }}><Clock size={16} />Now</button>
              </div>
            </section>
            {mode === "datetime" ? <section className="premium-picker-time-pane" aria-label="Time">
              <div className="premium-picker-time-heading"><Clock size={17} /><strong>Time</strong></div>
              <div className="premium-picker-time-columns">
                <TimeColumn label="Hour" value={String(hour).padStart(2, "0")} onUp={() => changeHour(1)} onDown={() => changeHour(-1)} onChange={(event) => editNumber("hour", event)} />
                <TimeColumn label="Minute" value={String(minute).padStart(2, "0")} onUp={() => changeMinute(1)} onDown={() => changeMinute(-1)} onChange={(event) => editNumber("minute", event)} />
                <TimeColumn label="AM / PM" value={period} onUp={() => updateTime(hour, minute, period === "AM" ? "PM" : "AM")} onDown={() => updateTime(hour, minute, period === "AM" ? "PM" : "AM")} onChange={(event) => updateTime(hour, minute, event.target.value.toUpperCase().startsWith("P") ? "PM" : "AM")} />
              </div>
            </section> : null}
          </div>
          <div className="premium-picker-popover-footer">
            <span>{mode === "datetime" ? `${formatPickerDate(draft)} · ${formatPickerTime(draft)}` : formatPickerDate(draft)}</span>
            <button type="button" className="button button-primary premium-picker-done" onClick={apply}><Check size={17} />Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeColumn({
  label,
  value,
  onUp,
  onDown,
  onChange,
}: {
  label: string;
  value: string;
  onUp: () => void;
  onDown: () => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="premium-picker-time-column">
      <span>{label}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={onUp}>▲</button>
      <input value={value} inputMode="numeric" aria-label={label} onChange={onChange} />
      <button type="button" aria-label={`Decrease ${label}`} onClick={onDown}>▼</button>
    </label>
  );
}
