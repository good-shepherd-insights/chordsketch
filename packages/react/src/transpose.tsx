import type { ChangeEvent, HTMLAttributes } from 'react';
import { useCallback, useMemo } from 'react';

import { clamp as clampValue } from './clamp';
import { unicodeAccidentals } from './music-glyphs';
import { SLUG } from './brand.generated';

/**
 * Default minimum the `<Transpose>` select exposes when the host
 * does not pass `min` explicitly. The `TRANSPOSE_MIN` /
 * `TRANSPOSE_MAX` constants in `chord-source-edit.ts` are the
 * absolute feature limits (`±11`); the select's default option
 * range is the narrower `±6` per #2560, since wider transposition
 * is rarely useful in practice.
 */
export const TRANSPOSE_DEFAULT_MIN = -6;
/** Default maximum the `<Transpose>` select exposes. See {@link TRANSPOSE_DEFAULT_MIN}. */
export const TRANSPOSE_DEFAULT_MAX = 6;

/** Props accepted by {@link Transpose}. */
export interface TransposeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Current semitone offset (controlled mode). */
  value: number;
  /** Fired when the select value changes. */
  onChange: (next: number) => void;
  /**
   * Minimum offset the select will emit. Defaults to
   * {@link TRANSPOSE_DEFAULT_MIN} (`-6`). Pass an explicit value
   * (down to the `TRANSPOSE_MIN` floor of `-11`) to widen the
   * range.
   */
  min?: number;
  /**
   * Maximum offset the select will emit. Defaults to
   * {@link TRANSPOSE_DEFAULT_MAX} (`+6`). Pass an explicit value
   * (up to the `TRANSPOSE_MAX` ceiling of `+11`) to widen the
   * range.
   */
  max?: number;
  /**
   * Step between adjacent options. Defaults to `1`. A controlled
   * `value` that does not land on the option grid snaps to the
   * nearest rendered option, so a non-dividing `step` never leaves
   * the select showing an unselectable value. A non-positive `step`
   * (or `max < min`) produces an empty, inert select.
   */
  step?: number;
  /**
   * Optional label shown inline before the select. Defaults to
   * `"Transpose"`. Pass `null` to omit the visible label; the
   * select still carries an `aria-label`.
   */
  label?: React.ReactNode;
  /**
   * Format an option's semitone value. Defaults to signed integer.
   * The result is rendered as the `<option>`'s text content, so the
   * return type is `string | number` — elements do not render
   * inside `<option>`.
   */
  formatValue?: (value: number) => string | number;
  /**
   * Also render − / + step buttons and a value label (the select laid over
   * the label, so a tap still opens the list). They are shown only on
   * narrow viewports by `styles.css`; wider ones keep the plain select.
   */
  stepper?: boolean;
  /**
   * The sounding key, shown as "Key …" between the steppers. When it is
   * `null` or omitted the label shows the semitone offset instead.
   */
  keyLabel?: string | null;
}

function defaultFormat(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Accessible transposition control: a native `<select>` listing
 * every semitone offset between `min` and `max`, styled as the
 * design-system select (white surface, hairline border, inline
 * chevrons-up-down caret) to match the playground's
 * `.chordsketch-app__select`. Keyboard and screen-reader support
 * come from the native select.
 *
 * The component is **controlled** — pass `value` and `onChange`.
 * Wire up `useTranspose()` next to it if you want the internal
 * state helper.
 *
 * ```tsx
 * const { value, setValue } = useTranspose();
 * <Transpose value={value} onChange={setValue} />
 * ```
 */
export function Transpose({
  value,
  onChange,
  min = TRANSPOSE_DEFAULT_MIN,
  max = TRANSPOSE_DEFAULT_MAX,
  step = 1,
  label = 'Transpose',
  formatValue = defaultFormat,
  stepper = false,
  keyLabel,
  className,
  ...divProps
}: TransposeProps): JSX.Element {
  const clamp = useCallback(
    (next: number): number => clampValue(next, min, max),
    [min, max],
  );

  // Highest offset first so the dropdown reads top-down as
  // `+6 … 0 … -6` (pitch up at the top, matching the ↕ caret).
  const options = useMemo(() => {
    if (step <= 0 || max < min) return [] as number[];
    const out: number[] = [];
    for (let p = max; p >= min; p -= step) out.push(p);
    return out;
  }, [min, max, step]);

  // Resolve the host `value` to the nearest rendered option. A
  // native <select> cannot display a value that has no matching
  // <option>, so an out-of-range value (clamped here) or an
  // off-grid value (when `step` does not divide the range) would
  // otherwise leave the control showing the wrong offset. Snapping
  // to the nearest option keeps the selection in sync with state.
  const displayValue = useMemo(() => {
    const bounded = clamp(value);
    if (options.length === 0) return bounded;
    return options.reduce(
      (best, opt) =>
        Math.abs(opt - bounded) < Math.abs(best - bounded) ? opt : best,
      options[0],
    );
  }, [value, options, clamp]);

  const handleSelectChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) return;
      onChange(clamp(parsed));
    },
    [onChange, clamp],
  );

  const ariaLabel =
    typeof divProps['aria-label'] === 'string'
      ? divProps['aria-label']
      : typeof label === 'string'
        ? label
        : 'Transpose';

  const select = (
    <select
      className={`${SLUG}-transpose__select`}
      value={displayValue}
      onChange={handleSelectChange}
      aria-label={ariaLabel}
    >
      {options.map((pos) => (
        <option key={pos} value={pos}>
          {formatValue(pos)}
        </option>
      ))}
    </select>
  );

  return (
    <div
      {...divProps}
      role="group"
      aria-label={ariaLabel}
      className={[`${SLUG}-transpose`, className].filter(Boolean).join(' ')}
    >
      {label !== null ? (
        <span className={`${SLUG}-transpose__label`} aria-hidden="true">
          {label}
        </span>
      ) : null}
      {stepper ? (
        <button
          type="button"
          className={`${SLUG}-transpose__step`}
          aria-label="Transpose down"
          disabled={options.length === 0 || displayValue <= options[options.length - 1]!}
          onClick={() => onChange(clamp(displayValue - step))}
        >
          −
        </button>
      ) : null}
      {stepper ? (
        <span className={`${SLUG}-transpose__value`}>
          <span className={`${SLUG}-transpose__value-text`} aria-hidden="true">
            {keyLabel ? `Key ${unicodeAccidentals(keyLabel)}` : formatValue(displayValue)}
          </span>
          {select}
        </span>
      ) : (
        select
      )}
      {stepper ? (
        <button
          type="button"
          className={`${SLUG}-transpose__step`}
          aria-label="Transpose up"
          disabled={options.length === 0 || displayValue >= options[0]!}
          onClick={() => onChange(clamp(displayValue + step))}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
