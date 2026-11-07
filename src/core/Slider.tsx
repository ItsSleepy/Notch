import type { CSSProperties } from 'react';

interface Props {
  /** 0..1 */
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}

/** Thin range slider with a filled track. Controlled: the owner updates `value` optimistically. */
export function Slider({ value, onChange, disabled, label }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <input
      type="range"
      className="slider"
      min={0}
      max={100}
      step={1}
      value={pct}
      disabled={disabled}
      aria-label={label}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
    />
  );
}
