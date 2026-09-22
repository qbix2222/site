import type { ReactNode } from 'react';

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="section-title">{title}</h3>
      {note && <p className="setting-hint">{note}</p>}
      {children}
    </section>
  );
}

export function Row({ name, hint, children }: { name: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-name">{name}</span>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange(next: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ id: T; label: string; title?: string }>;
  onChange(next: T): void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          title={option.title}
          data-on={value === option.id}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(next: number): void;
  label: string;
  format(value: number): string;
}) {
  return (
    <span className="row gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="label mono">{format(value)}</span>
    </span>
  );
}

export function NumberBox({
  value,
  onChange,
  min,
  max,
  label,
  placeholder,
}: {
  value: number | null;
  onChange(next: number | null): void;
  min: number;
  max: number;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      className="field field-mono field-narrow"
      type="number"
      min={min}
      max={max}
      value={value ?? ''}
      placeholder={placeholder}
      aria-label={label}
      onChange={(event) => {
        const raw = event.target.value;
        const parsed = Number(raw);

        onChange(raw.trim() === '' || !Number.isFinite(parsed) ? null : Math.min(max, Math.max(min, parsed)));
      }}
    />
  );
}
