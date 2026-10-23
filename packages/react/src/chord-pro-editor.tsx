import type { ComponentType, HTMLAttributes, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ChordInspector } from './chord-inspector';
import { ChordProPreview } from './chord-pro-preview';
import { ChordSourceArea, type ChordSourceAreaHandle } from './chord-source-area';
import { InsertToolbar } from './insert-toolbar';
import { diagramsSetting, withDiagrams } from './source-directives';
import type { PdfExportProps } from './pdf-export';
import type { PreviewFormat } from './renderer-preview';
import type { ChordDiagramOrientation } from './use-chord-diagram';
import { SplitLayout } from './split-layout';
import { useChordEditor } from './use-chord-editor';
import type { ChordWasmLoader } from './use-chord-render';
import { BRAND, SLUG } from './brand.generated';

// Minimal `process.env.NODE_ENV` typing so we do not pull in
// `@types/node` for a single dev-only reference. The exact
// `process.env.NODE_ENV` token is required — bundlers (esbuild,
// Rollup, Vite, webpack DefinePlugin) replace it at build time and
// a helper that accesses it via `globalThis.process` would not
// match the substitution pattern, so the production build would
// still carry the warning code path.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Props accepted by {@link ChordProEditor}.
 *
 * `defaultValue` is omitted from the forwarded div attributes: the
 * initial source is `defaultSource`, and an inherited `defaultValue`
 * type-checked but did nothing, so the sibling `<IrealProEditor>`'s
 * prop name silently produced an empty editor.
 */
export interface ChordProEditorProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'title' | 'defaultValue'> {
  /**
   * Initial ChordPro source to seed the editor with. Ignored when
   * `source` is supplied (controlled mode). Defaults to an empty
   * document so the editor mounts cleanly when the host wants to
   * supply content asynchronously.
   */
  defaultSource?: string;
  /**
   * Controlled source value. When set, the host owns the source of
   * truth; pair with `onSourceChange` to capture edits.
   */
  source?: string;
  /** Fires synchronously on every editor edit. */
  onSourceChange?: (next: string) => void;
  /**
   * Initial preview format. Defaults to `"html"`. The user can
   * change the format via the preview header `<select>`; the change
   * does not bubble unless `onFormatChange` is supplied (uncontrolled
   * mode keeps state internally).
   */
  defaultFormat?: PreviewFormat;
  /** Controlled preview format. */
  format?: PreviewFormat;
  /** Fires when the preview format changes. */
  onFormatChange?: (next: PreviewFormat) => void;
  /**
   * Initial transposition offset. Defaults to `0`.
   */
  defaultTranspose?: number;
  /** Controlled transposition offset. */
  transpose?: number;
  /** Fires when the transposition control commits a new offset. */
  onTransposeChange?: (next: number) => void;
  /**
   * Heading text shown in the header bar. Defaults to
   * `"ChordSketch"`. Pass `null` or the empty string to omit the
   * heading entirely.
   *
   * Narrowed to `string | null` (no `ReactNode` substructure)
   * because the heading is rendered inside a single `<h1>` next to
   * a brand mark — the layout assumes one-line text content, not
   * arbitrary React subtrees. The narrow type also avoids the
   * `title === 0` truthiness ambiguity a permissive `ReactNode`
   * would surface.
   */
  title?: string | null;
  /** Filename used for the PDF download. Defaults to the brand's `pdfFilename` (`brand/brand.json`). */
  pdfFilename?: string;
  /**
   * The `PdfExport` component from `@chordsketch/react/pdf`, forwarded
   * to the underlying {@link ChordProPreview}. Omit to hide PDF
   * export — the format `<select>` still offers "PDF", but selecting
   * it renders a hint instead of an export button. See
   * `@chordsketch/react/pdf`'s module doc for why this is injected
   * rather than statically imported.
   *
   * ```tsx
   * import { PdfExport } from '@chordsketch/react/pdf';
   * <ChordProEditor pdfExportComponent={PdfExport} ... />
   * ```
   */
  pdfExportComponent?: ComponentType<PdfExportProps>;
  /**
   * Optional render prop appended to the right of the header — useful
   * for hosts that want to add their own controls (e.g. an
   * input-format toggle, a save button) without fully replacing the
   * layout.
   */
  headerExtras?: ReactNode;
  /**
   * Show the {@link InsertToolbar} above the source (Chord, + Directive,
   * + Section, inserted at the caret). Defaults to `false`.
   */
  insertToolbar?: boolean;
  /**
   * Use the preview's performance toolbar ({@link PreviewToolbar}: Transpose
   * ±6, Capo, chord-diagram orientation and a Chord audio toggle) in place of
   * the Format select + Transpose header. Guitar chord diagrams show under
   * the song, and with Chord audio on, clicking a chord or a diagram plays it.
   * The preview stays in its current format (HTML by default). Defaults to
   * `false`.
   */
  performanceToolbar?: boolean;
  /**
   * Preview formats offered, forwarded to {@link ChordProPreview}. Defaults to
   * HTML, Text and PDF. A single format hides the Format select.
   */
  formats?: ReadonlyArray<PreviewFormat>;
  /**
   * Show a Split / Source / Preview toggle in the header, so the source and
   * the preview can each be shown alone. Starts on Source on viewports
   * narrower than 768px, where two panes do not fit side by side. Defaults to
   * `false` (always split).
   */
  viewToggle?: boolean;
  /**
   * Test-only WASM loader override. Production callers never need
   * to supply this.
   *
   * @internal
   */
  wasmLoader?: ChordWasmLoader;
}

/** The panes {@link ChordProEditor}'s view toggle can show. */
type EditorView = 'split' | 'source' | 'preview';
const VIEWS: ReadonlyArray<{ value: EditorView; label: string }> = [
  { value: 'split', label: 'Split' },
  { value: 'source', label: 'Source' },
  { value: 'preview', label: 'Preview' },
];
/** Viewport width (px) below which the view toggle starts on Source alone;
 *  matches {@link SplitLayout}'s default stacking breakpoint. */
const NARROW_PX = 768;

/**
 * Tier 3 composed editor — opinionated all-in-one ChordPro editor +
 * preview shell. Composes {@link ChordSourceArea} (CodeMirror)
 * on the left and {@link ChordProPreview} (format select +
 * transpose + renderer) on the right, separated by a
 * {@link SplitLayout}.
 *
 * Each piece is independently exported, so hosts that want a
 * different arrangement (vertical stack, no header, custom format
 * toggle) can compose the primitives directly. {@link
 * ChordProEditor} is the convenience component for the common case.
 *
 * Source / format / transpose all support both controlled and
 * uncontrolled modes. Pass the corresponding `value` + `onChange`
 * pair to lift state into the parent; pass only `default*` to keep
 * state inside the component.
 *
 * ```tsx
 * <ChordProEditor defaultSource="{title: Hello}" />
 * ```
 */
export function ChordProEditor({
  defaultSource = '',
  source: sourceProp,
  onSourceChange,
  defaultFormat = 'html',
  format: formatProp,
  onFormatChange,
  defaultTranspose = 0,
  transpose: transposeProp,
  onTransposeChange,
  title = BRAND.name,
  pdfFilename,
  pdfExportComponent,
  headerExtras,
  insertToolbar = false,
  performanceToolbar = false,
  formats,
  viewToggle = false,
  wasmLoader,
  className,
  ...divProps
}: ChordProEditorProps): JSX.Element {
  // Performance toolbar state: chord audio. Chord diagrams are part of
  // the song (a {diagrams} line), so they come from the source.
  const [chordAudioEnabled, setChordAudioEnabled] = useState(false);
  // Which panes show: both, or one of them alone (viewToggle).
  const [view, setView] = useState<EditorView>(() =>
    viewToggle &&
    typeof window !== 'undefined' &&
    window.matchMedia?.(`(max-width: ${NARROW_PX - 1}px)`).matches
      ? 'source'
      : 'split',
  );
  const shownView: EditorView = viewToggle ? view : 'split';
  // Source — controlled vs uncontrolled.
  const [internalSource, setInternalSource] = useState(defaultSource);
  const isSourceControlled = sourceProp !== undefined;
  const source = isSourceControlled ? sourceProp : internalSource;
  const handleSourceChange = useCallback(
    (next: string) => {
      if (!isSourceControlled) setInternalSource(next);
      onSourceChange?.(next);
    },
    [isSourceControlled, onSourceChange],
  );

  const diagrams = diagramsSetting(source);
  const setDiagrams = useCallback(
    (next: ChordDiagramOrientation | 'off') => {
      const updated = withDiagrams(source, next);
      if (updated !== source) handleSourceChange(updated);
    },
    [source, handleSourceChange],
  );

  // Transpose — controlled vs uncontrolled, tracked here (not only in
  // `<ChordProPreview>`) so the chord-editor gate below sees the current
  // offset. We pass the resolved value down as a controlled prop.
  const [internalTranspose, setInternalTranspose] = useState(defaultTranspose);
  const isTransposeControlled = transposeProp !== undefined;
  const transpose = isTransposeControlled ? transposeProp : internalTranspose;
  const handleTransposeChange = useCallback(
    (next: number) => {
      if (!isTransposeControlled) setInternalTranspose(next);
      onTransposeChange?.(next);
    },
    [isTransposeControlled, onTransposeChange],
  );

  // Caret-driven chord-editor footer (#2644). The hook resolves the
  // chord under the editor caret, drives the preview's selection badge,
  // and applies edit / insert / move / delete to the source.
  const editorRef = useRef<ChordSourceAreaHandle | null>(null);
  const chordEditor = useChordEditor({
    source,
    onSourceChange: handleSourceChange,
    transpose,
    editorRef,
    chordAudio: performanceToolbar && chordAudioEnabled,
  });

  // L4: dev-only controlled/uncontrolled flip warnings for source,
  // format, and transpose. `<ChordProPreview>` already warns for its
  // own `format` / `transpose` axes, but the warnings there mention
  // `<ChordProPreview>` — adding the editor-scoped checks keeps the
  // diagnostic pointing at the surface the caller actually touched.
  const isFormatControlled = formatProp !== undefined;
  const wasSourceControlledRef = useRef(isSourceControlled);
  const wasFormatControlledRef = useRef(isFormatControlled);
  const wasTransposeControlledRef = useRef(isTransposeControlled);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (wasSourceControlledRef.current !== isSourceControlled) {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: A component is changing an ${wasSourceControlledRef.current ? 'controlled' : 'uncontrolled'} <ChordProEditor> source to be ${isSourceControlled ? 'controlled' : 'uncontrolled'}. ` +
          `<ChordProEditor> should not switch between controlled and uncontrolled (or vice versa) during its lifetime. ` +
          `Decide between using a controlled or uncontrolled <ChordProEditor> source for the lifetime of the component.`,
      );
      wasSourceControlledRef.current = isSourceControlled;
    }
  }, [isSourceControlled]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (wasFormatControlledRef.current !== isFormatControlled) {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: A component is changing an ${wasFormatControlledRef.current ? 'controlled' : 'uncontrolled'} <ChordProEditor> format to be ${isFormatControlled ? 'controlled' : 'uncontrolled'}. ` +
          `<ChordProEditor> should not switch between controlled and uncontrolled (or vice versa) during its lifetime. ` +
          `Decide between using a controlled or uncontrolled <ChordProEditor> format for the lifetime of the component.`,
      );
      wasFormatControlledRef.current = isFormatControlled;
    }
  }, [isFormatControlled]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (wasTransposeControlledRef.current !== isTransposeControlled) {
      // eslint-disable-next-line no-console
      console.error(
        `Warning: A component is changing an ${wasTransposeControlledRef.current ? 'controlled' : 'uncontrolled'} <ChordProEditor> transpose to be ${isTransposeControlled ? 'controlled' : 'uncontrolled'}. ` +
          `<ChordProEditor> should not switch between controlled and uncontrolled (or vice versa) during its lifetime. ` +
          `Decide between using a controlled or uncontrolled <ChordProEditor> transpose for the lifetime of the component.`,
      );
      wasTransposeControlledRef.current = isTransposeControlled;
    }
  }, [isTransposeControlled]);

  const wrapperClass = [`${SLUG}-chord-pro-editor`, className]
    .filter(Boolean)
    .join(' ');

  // `title` is narrowed to `string | null` so the falsy check is
  // unambiguous — no `ReactNode` substructure means no `0` /
  // `false` / array edge cases to reason about. The `!== ''` clause
  // suppresses the brand-mark `<h1>` when the host explicitly opts
  // out via an empty string (a common "hide the title" idiom).
  const hasTitle = title !== null && title !== undefined && title !== '';
  // `headerExtras` is `ReactNode`, and `null` / `false` are valid
  // React-rendered values that produce no DOM. Treat them as "no
  // header extras" so a host that conditionally renders header
  // controls (`headerExtras={enabled ? <SaveButton/> : null}`)
  // doesn't get an empty `<div class="…__controls">` rendered when
  // the conditional is falsy.
  const hasHeaderExtras =
    headerExtras !== undefined && headerExtras !== null && headerExtras !== false;
  const hasHeader = hasTitle || hasHeaderExtras || viewToggle;

  const sourcePane = (
    <div className={`${SLUG}-chord-pro-editor__source-pane`}>
      {insertToolbar ? <InsertToolbar editorRef={editorRef} source={source} /> : null}
      <ChordSourceArea
        ref={editorRef}
        value={source}
        onChange={handleSourceChange}
        onCaretChange={chordEditor.onCaretChange}
        placeholder="Paste your ChordPro here…"
      />
    </div>
  );
  const previewPane = (
    <ChordProPreview
      className={`${SLUG}-chord-pro-editor__preview-pane`}
      source={source}
      format={formatProp}
      defaultFormat={defaultFormat}
      onFormatChange={onFormatChange}
      formats={formats}
      transpose={transpose}
      onTransposeChange={handleTransposeChange}
      pdfFilename={pdfFilename}
      pdfExportComponent={pdfExportComponent}
      chordSelection={chordEditor.chordSelection}
      onChordSelectionChange={chordEditor.onChordSelectionChange}
      onChordReposition={chordEditor.onChordReposition}
      {...(performanceToolbar
        ? {
            toolbar: 'performance' as const,
            onSourceChange: handleSourceChange,
            transposeMin: -6,
            transposeMax: 6,
            chordDiagramsInstrument:
              diagrams === 'off' ? undefined : ('guitar' as const),
            chordDiagramsOrientation: diagrams === 'off' ? 'vertical' : diagrams,
            onChordDiagramsOrientationChange: setDiagrams,
            chordDiagramsOff: diagrams === 'off',
            onChordDiagramsChange: setDiagrams,
            chordAudio: chordEditor.chordAudio,
            chordAudioEnabled,
            onChordAudioToggle: setChordAudioEnabled,
          }
        : {})}
      wasmLoader={wasmLoader}
    />
  );

  return (
    <div {...divProps} className={wrapperClass}>
      {hasHeader ? (
        <header className={`${SLUG}-chord-pro-editor__header`}>
          {hasTitle ? (
            <h1 className={`${SLUG}-chord-pro-editor__title`}>
              <span
                className={`${SLUG}-chord-pro-editor__brand-mark`}
                aria-hidden="true"
              />
              <span className={`${SLUG}-chord-pro-editor__brand-text`}>{title}</span>
            </h1>
          ) : null}
          {viewToggle || hasHeaderExtras ? (
            <div className={`${SLUG}-chord-pro-editor__controls`}>
              {viewToggle ? (
                <div
                  className={`${SLUG}-chord-pro-editor__view-toggle`}
                  role="group"
                  aria-label="View"
                >
                  {VIEWS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={shownView === value}
                      onClick={() => setView(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
              {hasHeaderExtras ? headerExtras : null}
            </div>
          ) : null}
        </header>
      ) : null}

      {shownView === 'split' ? (
        <SplitLayout
          className={`${SLUG}-chord-pro-editor__split`}
          start={sourcePane}
          end={previewPane}
        />
      ) : (
        <div className={`${SLUG}-chord-pro-editor__single`}>
          {shownView === 'source' ? sourcePane : previewPane}
        </div>
      )}

      {/* Full-width chord-editor footer spanning both panes (#2644). */}
      <div className={`${SLUG}-chord-pro-editor__chord-footer`}>
        <ChordInspector {...chordEditor.inspectorProps} />
      </div>
    </div>
  );
}
