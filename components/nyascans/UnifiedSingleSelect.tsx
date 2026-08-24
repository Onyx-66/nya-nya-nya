"use client";

import { CaretDown, CheckCircle } from "@phosphor-icons/react";
import {
  Children,
  Fragment,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

type SelectOption = {
  disabled: boolean;
  group: string | null;
  label: string;
  value: string;
};

type OptionElement = ReactElement<{
  children?: ReactNode;
  disabled?: boolean;
  label?: string;
  value?: string | number;
}>;

type OptGroupElement = ReactElement<{
  children?: ReactNode;
  disabled?: boolean;
  label?: string;
}>;

function optionText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return Children.toArray(value).map(optionText).join("").trim();
}

function readOptions(
  children: ReactNode,
  inheritedGroup: string | null = null,
  inheritedDisabled = false,
): SelectOption[] {
  const options: SelectOption[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === Fragment) {
      options.push(
        ...readOptions(
          (child.props as { children?: ReactNode }).children,
          inheritedGroup,
          inheritedDisabled,
        ),
      );
      return;
    }

    if (child.type === "optgroup") {
      const group = child as OptGroupElement;
      const groupLabel = group.props.label?.trim() || inheritedGroup;
      options.push(
        ...readOptions(
          group.props.children,
          groupLabel,
          inheritedDisabled || Boolean(group.props.disabled),
        ),
      );
      return;
    }

    if (child.type !== "option") return;
    const option = child as OptionElement;
    const label = option.props.label?.trim() || optionText(option.props.children);
    options.push({
      disabled: inheritedDisabled || Boolean(option.props.disabled),
      group: inheritedGroup,
      label,
      value: String(option.props.value ?? label),
    });
  });

  return options;
}

export type UnifiedSingleSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
> & {
  children: ReactNode;
};

/**
 * The canonical NyaScans single-choice control.
 *
 * A real, visually-hidden select preserves form submission and validation,
 * while the Library-style trigger/listbox provides consistent theming,
 * selected checkmarks, and keyboard behavior in every workspace.
 */
export function UnifiedSingleSelect({
  children,
  className = "",
  defaultValue,
  disabled = false,
  id,
  onBlur,
  onChange,
  onFocus,
  onInvalid,
  title,
  value,
  ...selectProps
}: UnifiedSingleSelectProps) {
  const generatedId = useId();
  const selectId = id ?? `nya-single-select-${generatedId.replaceAll(":", "")}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const options = useMemo(() => readOptions(children), [children]);
  const initialValue = String(value ?? defaultValue ?? options[0]?.value ?? "");
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const selectedValue = String(value ?? uncontrolledValue);
  const selected =
    options.find((option) => option.value === selectedValue) ??
    options.find((option) => !option.disabled) ??
    options[0];
  const accessibleLabel =
    typeof selectProps["aria-label"] === "string"
      ? selectProps["aria-label"]
      : typeof title === "string"
        ? title
        : undefined;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedValue && !option.disabled),
    );
    window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
  }, [open, options, selectedValue]);

  useEffect(() => {
    if (value !== undefined || !selectRef.current?.form) return;
    const form = selectRef.current.form;
    const reset = () => {
      window.setTimeout(() => {
        const nextValue = String(selectRef.current?.value ?? defaultValue ?? options[0]?.value ?? "");
        setUncontrolledValue(nextValue);
      }, 0);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [defaultValue, options, value]);

  function emitChange(nextValue: string) {
    const nativeSelect = selectRef.current;
    if (!nativeSelect) return;
    nativeSelect.value = nextValue;
    if (value === undefined) setUncontrolledValue(nextValue);
    onChange?.({
      currentTarget: nativeSelect,
      target: nativeSelect,
    } as ChangeEvent<HTMLSelectElement>);
    nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function choose(option: SelectOption) {
    if (disabled || option.disabled) return;
    emitChange(option.value);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function focusRelative(currentIndex: number, direction: 1 | -1) {
    if (!options.length) return;
    let nextIndex = currentIndex;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      nextIndex = (nextIndex + direction + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        optionRefs.current[nextIndex]?.focus();
        return;
      }
    }
  }

  return (
    <div
      className={`unified-single-select${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
      ref={rootRef}
      data-single-select
    >
      <button
        ref={triggerRef}
        className="unified-single-select-trigger"
        type="button"
        aria-controls={`${selectId}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={accessibleLabel}
        disabled={disabled}
        title={title}
        onBlur={(event) => onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
        onFocus={(event) => onFocus?.(event as unknown as React.FocusEvent<HTMLSelectElement>)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label || "Choose an option"}</span>
        <CaretDown size={16} aria-hidden="true" />
      </button>

      <select
        {...selectProps}
        ref={selectRef}
        id={selectId}
        className={`unified-single-select-native${className ? ` ${className}` : ""}`}
        value={selectedValue}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => undefined}
        onInvalid={(event) => {
          onInvalid?.(event);
          setOpen(true);
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        }}
      >
        {children}
      </select>

      {open ? (
        <div
          className="unified-single-select-menu"
          id={`${selectId}-listbox`}
          role="listbox"
          aria-label={accessibleLabel}
          aria-activedescendant={`${selectId}-option-${Math.max(0, options.findIndex((option) => option.value === selectedValue))}`}
        >
          {options.map((option, index) => {
            const previousGroup = options[index - 1]?.group ?? null;
            const showGroup = Boolean(option.group && option.group !== previousGroup);
            return (
              <Fragment key={`${option.group ?? "option"}-${option.value}-${index}`}>
                {showGroup ? (
                  <span className="unified-single-select-group" aria-hidden="true">
                    {option.group}
                  </span>
                ) : null}
                <button
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  id={`${selectId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={option.value === selectedValue}
                  disabled={option.disabled}
                  tabIndex={option.value === selectedValue ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    choose(option);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      focusRelative(index, 1);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      focusRelative(index, -1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      const first = options.findIndex((candidate) => !candidate.disabled);
                      if (first >= 0) optionRefs.current[first]?.focus();
                    } else if (event.key === "End") {
                      event.preventDefault();
                      const last = options.findLastIndex((candidate) => !candidate.disabled);
                      if (last >= 0) optionRefs.current[last]?.focus();
                    } else if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(option);
                    } else if (event.key === "Tab") {
                      setOpen(false);
                    }
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === selectedValue ? (
                    <CheckCircle size={16} weight="fill" aria-hidden="true" />
                  ) : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
