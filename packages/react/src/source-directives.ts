import type { ChordDiagramOrientation } from './use-chord-diagram';

/**
 * Whole-line directive edits the editor's toolbars make to a ChordPro
 * source: a setting is one directive line under the song's leading
 * directives (title, key, …), removed again when it returns to its default.
 */

/** Remove every line `pattern` (a `gim` regex) matches. */
export function withoutLines(source: string, pattern: RegExp): string {
  return source
    .replace(pattern, '\u0000')
    .split('\n')
    .filter((l) => l !== '\u0000')
    .join('\n');
}

/** Insert `lines` after the song's leading directive lines. */
export function withHeaderLines(source: string, lines: string[]): string {
  const all = source.split('\n');
  let at = 0;
  while (at < all.length && /^\s*\{(?!\s*(?:start_of_|so[cvbtg]\b))[^}]*\}\s*$/i.test(all[at])) at++;
  all.splice(at, 0, ...lines);
  return all.join('\n');
}

const DIAGRAMS_LINE = /^[ \t]*\{[ \t]*(?:diagrams|no_diagrams)\b[^}]*\}[ \t]*$/gim;
const ORIENTATION_LINE = /^[ \t]*\{[ \t]*\+config\.diagrams\.orientation[ \t]*:([^}]*)\}[ \t]*$/gim;

/**
 * The song's chord diagrams as the source sets them: `'off'` unless a
 * `{diagrams}` line (not `{diagrams: off}`) turns them on, else the
 * `{+config.diagrams.orientation}` it carries (vertical by default).
 */
export function diagramsSetting(source: string): ChordDiagramOrientation | 'off' {
  let on = false;
  for (const m of source.matchAll(DIAGRAMS_LINE)) {
    on = !/no_diagrams|:\s*off\s*\}/i.test(m[0]);
  }
  if (!on) return 'off';
  let orientation: ChordDiagramOrientation = 'vertical';
  for (const m of source.matchAll(ORIENTATION_LINE)) {
    orientation = /horizontal/i.test(m[1]) ? 'horizontal' : 'vertical';
  }
  return orientation;
}

/**
 * The source with guitar chord diagrams set: off removes the lines;
 * on writes `{diagrams: guitar}`, plus the orientation when horizontal.
 */
export function withDiagrams(source: string, next: ChordDiagramOrientation | 'off'): string {
  const base = withoutLines(withoutLines(source, DIAGRAMS_LINE), ORIENTATION_LINE);
  if (next === 'off') return base;
  const lines = ['{diagrams: guitar}'];
  if (next === 'horizontal') lines.push('{+config.diagrams.orientation: horizontal}');
  return withHeaderLines(base, lines);
}
