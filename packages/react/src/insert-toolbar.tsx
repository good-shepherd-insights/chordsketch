import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { ChordSourceAreaHandle } from './chord-source-area';
import { loadChordproCatalog, type DirectiveCatalogEntry } from './chordpro-completion';
import { SLUG } from './brand.generated';
import { withHeaderLines, withoutLines } from './source-directives';

/** Props for {@link InsertToolbar}. */
export interface InsertToolbarProps {
  /** The `<ChordSourceArea>` the snippets are inserted into, at its caret. */
  editorRef: RefObject<ChordSourceAreaHandle | null>;
  /** The current source, read to show the chord Bold state. */
  source?: string;
}

/** The sections `+ Section` offers, each inserted as an empty block. */
const SECTIONS = ['verse', 'chorus', 'bridge', 'tab', 'grid'] as const;

/** A whole-line `{chordfont: …}` directive (or its `{cf: …}` alias). */
const CHORD_FONT_LINE = /^[ \t]*\{[ \t]*(?:chordfont|cf)[ \t]*:([^}]*)\}[ \t]*$/gim;

/** The font written when chords are switched to bold. */
const BOLD_CHORD_FONT = 'Helvetica-Bold';

/** Chords are regular unless the last `{chordfont}` names a bold font. */
function chordsAreBold(source: string): boolean {
  let last: string | null = null;
  for (const m of source.matchAll(CHORD_FONT_LINE)) last = m[1].trim();
  return last !== null && /bold/i.test(last);
}

/**
 * The source with chords set regular (every `{chordfont}` line removed:
 * regular is the default) or bold (one `{chordfont: Helvetica-Bold}` line
 * under the song's leading directives, such as title and key).
 */
function withChordWeight(source: string, bold: boolean): string {
  const base = withoutLines(source, CHORD_FONT_LINE);
  return bold ? withHeaderLines(base, [`{chordfont: ${BOLD_CHORD_FONT}}`]) : base;
}

/**
 * Insert helpers for the ChordPro source: `Chord` puts `[C]` at the caret
 * (selected, so the next keystroke replaces it), `+ Directive` inserts any
 * directive from the shared catalog (ADR-0028) and `+ Section` an empty
 * section. The playground's editor pane shows the same controls.
 */
export function InsertToolbar({ editorRef, source = '' }: InsertToolbarProps): JSX.Element {
  // Directive options come from the @chordsketch/wasm catalog, so the list
  // matches what the parser, completion and LSP recognise.
  const [directives, setDirectives] = useState<DirectiveCatalogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadChordproCatalog()
      .then((catalog) => {
        if (!cancelled) setDirectives(catalog.listDirectives());
      })
      .catch(() => {
        // wasm unavailable: the picker keeps only its placeholder.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const insert = useCallback(
    (text: string, selectInside = true) => {
      editorRef.current?.insertAtCursor(text, selectInside);
    },
    [editorRef],
  );

  const bold = chordsAreBold(source);
  const toggleBold = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getValue();
    const next = withChordWeight(current, !chordsAreBold(current));
    if (next !== current) editor.replaceRange(0, current.length, next);
  }, [editorRef]);

  return (
    <div className={`${SLUG}-insert-toolbar`} role="toolbar" aria-label="Editor insert helpers">
      <span className={`${SLUG}-insert-toolbar__label`}>Insert</span>
      <button type="button" className={`${SLUG}-insert-toolbar__button`} onClick={() => insert('[C]')}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Chord
      </button>
      <select
        className={`${SLUG}-insert-toolbar__select`}
        aria-label="Insert ChordPro directive"
        value=""
        onChange={(e) => {
          const snippet = e.currentTarget.value;
          e.currentTarget.value = '';
          if (snippet) insert(snippet);
        }}
      >
        <option value="" disabled>
          + Directive
        </option>
        {directives.map((directive) => (
          <option
            key={directive.name}
            value={directive.valueKind === 'none' ? `{${directive.name}}` : `{${directive.name}: }`}
          >
            {directive.name}
          </option>
        ))}
      </select>
      <select
        className={`${SLUG}-insert-toolbar__select`}
        aria-label="Insert ChordPro section"
        value=""
        onChange={(e) => {
          const snippet = e.currentTarget.value;
          e.currentTarget.value = '';
          if (snippet) insert(snippet, false);
        }}
      >
        <option value="" disabled>
          + Section
        </option>
        {SECTIONS.map((section) => (
          <option key={section} value={`\n{start_of_${section}}\n\n{end_of_${section}}\n`}>
            {section}
          </option>
        ))}
      </select>
      <span className={`${SLUG}-insert-toolbar__divider`} aria-hidden="true" />
      <span className={`${SLUG}-insert-toolbar__label`}>Chords</span>
      <button
        type="button"
        className={`${SLUG}-insert-toolbar__button ${SLUG}-insert-toolbar__toggle`}
        aria-pressed={bold}
        aria-label="Bold chords"
        onClick={toggleBold}
      >
        Bold
      </button>
      <label className={`${SLUG}-insert-toolbar__colour`}>
        <span className={`${SLUG}-insert-toolbar__swatch`} aria-hidden="true" />
        <select aria-label="Chord colour" value="black" onChange={() => {}}>
          <option value="black">Black</option>
        </select>
      </label>
    </div>
  );
}
