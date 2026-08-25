"use client";
import {
  ArrowCounterClockwise,
  ArrowsHorizontal,
  Eye,
  Image as ImageIcon,
  List,
  Moon,
  NavigationArrow,
  SlidersHorizontal,
} from "@phosphor-icons/react";

export type ReaderSettings = {
  mode: "vertical" | "single" | "double";
  imageFit: "width" | "height" | "page" | "original" | "smart";
  imageSpacing: number;
  topMargin: number;
  bottomMargin: number;
  brightness: number;
  backgroundColor: string;
  readerTheme: "dark" | "paper" | "sepia";
  tapZones: boolean;
  readingDirection: "ltr" | "rtl";
  volumeNavigation: boolean;
  keepAwake: boolean;
  autoMarkRead: boolean;
  preloadNextChapter: boolean;
  saveReadingProgress: boolean;
  rememberSettings: boolean;
};

export const defaultReaderSettings: ReaderSettings = {
  mode: "vertical",
  imageFit: "smart",
  imageSpacing: 8,
  topMargin: 76,
  bottomMargin: 86,
  brightness: 100,
  backgroundColor: "#090b09",
  readerTheme: "dark",
  tapZones: true,
  readingDirection: "ltr",
  volumeNavigation: false,
  keepAwake: false,
  autoMarkRead: true,
  preloadNextChapter: true,
  saveReadingProgress: true,
  rememberSettings: true,
};

type Props = {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
  wakeLockSupported: boolean;
  volumeNavigationSupported: boolean;
};

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="reader-setting-choices">
      <legend>{label}</legend>
      <div>
        {options.map(([option, text]) => (
          <button
            type="button"
            key={option}
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  checked,
  disabled = false,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  detail?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`reader-setting-toggle ${disabled ? "is-disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function ReaderSettingsPanel({
  settings,
  onChange,
  onReset,
  wakeLockSupported,
  volumeNavigationSupported,
}: Props) {
  return (
    <div className="reader-settings-sheet">
      <header>
        <div>
          <span>Reader controls</span>
          <strong>Reading settings</strong>
        </div>
        <SlidersHorizontal size={21} />
      </header>

      <section>
        <h3>
          <List size={17} /> Display
        </h3>
        <ChoiceGroup
          label="Page layout"
          value={settings.mode}
          options={[
            ["vertical", "Long strip"],
            ["single", "Single page"],
            ["double", "Double page"],
          ]}
          onChange={(mode) => onChange({ mode })}
        />
      </section>

      <section>
        <h3>
          <ImageIcon size={17} /> Image
        </h3>
        <ChoiceGroup
          label="Image sizing"
          value={settings.imageFit}
          options={[
            ["width", "Fit width"],
            ["height", "Fit height"],
            ["page", "Page fit"],
            ["original", "Original"],
            ["smart", "Smart fit"],
          ]}
          onChange={(imageFit) => onChange({ imageFit })}
        />
      </section>

      <section>
        <h3>
          <ArrowsHorizontal size={17} /> Spacing
        </h3>
        {(
          [
            ["imageSpacing", "Image spacing", 0, 40],
            ["topMargin", "Top margin", 56, 180],
            ["bottomMargin", "Bottom margin", 64, 220],
          ] as const
        ).map(([key, label, min, max]) => (
          <label className="reader-setting-range" key={key}>
            <span>
              {label} <output>{settings[key]} px</output>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              value={settings[key]}
              onChange={(event) =>
                onChange({ [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
      </section>

      <section>
        <h3>
          <Eye size={17} /> Appearance
        </h3>
        <label className="reader-setting-range">
          <span>
            Brightness <output>{settings.brightness}%</output>
          </span>
          <input
            type="range"
            min={35}
            max={120}
            value={settings.brightness}
            onChange={(event) =>
              onChange({ brightness: Number(event.target.value) })
            }
          />
        </label>
        <ChoiceGroup
          label="Reader theme"
          value={settings.readerTheme}
          options={[
            ["dark", "Dark"],
            ["paper", "Paper"],
            ["sepia", "Sepia"],
          ]}
          onChange={(readerTheme) => onChange({ readerTheme })}
        />
        <label className="reader-color-control">
          <span>
            <Moon size={16} /> Background color
          </span>
          <input
            type="color"
            value={settings.backgroundColor}
            onChange={(event) =>
              onChange({
                backgroundColor: event.target.value,
                readerTheme: "dark",
              })
            }
          />
        </label>
      </section>

      <section>
        <h3>
          <NavigationArrow size={17} /> Navigation
        </h3>
        <ChoiceGroup
          label="Reading direction"
          value={settings.readingDirection}
          options={[
            ["ltr", "Left to right"],
            ["rtl", "Right to left"],
          ]}
          onChange={(readingDirection) => onChange({ readingDirection })}
        />
        <Toggle
          checked={settings.tapZones}
          label="Tap zones"
          detail="Tap the left or right half to turn pages."
          onChange={(tapZones) => onChange({ tapZones })}
        />
        <Toggle
          checked={settings.volumeNavigation}
          disabled={!volumeNavigationSupported}
          label="Volume button navigation"
          detail={
            volumeNavigationSupported
              ? "Use hardware volume keys to turn pages."
              : "Web browsers do not expose volume keys reliably."
          }
          onChange={(volumeNavigation) => onChange({ volumeNavigation })}
        />
        <Toggle
          checked={settings.keepAwake}
          disabled={!wakeLockSupported}
          label="Keep screen awake"
          detail={
            wakeLockSupported
              ? "Prevent the screen from sleeping while reading."
              : "Screen Wake Lock is not supported on this device."
          }
          onChange={(keepAwake) => onChange({ keepAwake })}
        />
      </section>

      <section>
        <h3>
          <SlidersHorizontal size={17} /> Behavior
        </h3>
        <Toggle
          checked={settings.autoMarkRead}
          label="Auto mark as read"
          onChange={(autoMarkRead) => onChange({ autoMarkRead })}
        />
        <Toggle
          checked={settings.preloadNextChapter}
          label="Preload next chapter"
          detail="Only access metadata is prefetched; paid pages stay private."
          onChange={(preloadNextChapter) =>
            onChange({ preloadNextChapter })
          }
        />
        <Toggle
          checked={settings.saveReadingProgress}
          label="Save reading progress"
          onChange={(saveReadingProgress) =>
            onChange({ saveReadingProgress })
          }
        />
        <Toggle
          checked={settings.rememberSettings}
          label="Remember last reader settings"
          onChange={(rememberSettings) => onChange({ rememberSettings })}
        />
      </section>

      <button
        className="reader-settings-reset"
        type="button"
        onClick={onReset}
      >
        <ArrowCounterClockwise size={17} /> Restore defaults
      </button>
    </div>
  );
}
