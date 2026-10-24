import type { ComponentType, CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ChordInspector } from './chord-inspector';
import { ChordProPreview } from './chord-pro-preview';
import { ChordSourceArea, type ChordSourceAreaHandle } from './chord-source-area';
import { InsertToolbar } from './insert-toolbar';
import type { ChordEditorPosition } from './preview-toolbar';
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
   * The view the toggle starts on (`'split'`, `'source'` or `'preview'`).
   * When unset it starts on Split, or on Source on narrow viewports. Only
   * used with `viewToggle`. On a narrow viewport Split is not offered (two
   * panes do not fit side by side) and shows as Source.
   */
  defaultView?: EditorView;
  /**
   * Test-only WASM loader override. Production callers never need
   * to supply this.
   *
   * @internal
   */
  wasmLoader?: ChordWasmLoader;
}

/** Where the chord editor's mode (fixed top, fixed bottom, popup) is
 * remembered in this browser. */
const POPUP_POSITION_KEY = `${SLUG}-chord-editor-mode`;
/** Popup width (px), and its gap to the chord and to the window edge. */
const POPUP_WIDTH = 560;
const POPUP_GAP = 10;
const POPUP_EDGE = 8;

/** The popup's left edge: just left of the chord, kept inside the window. */
function popupLeft(chord: DOMRect): number {
  const width = Math.min(POPUP_WIDTH, window.innerWidth - 2 * POPUP_EDGE);
  return Math.max(POPUP_EDGE, Math.min(chord.left - 20, window.innerWidth - width - POPUP_EDGE));
}

/** Fixed-position style for the popup below the chord. */
function popupStyle(chord: DOMRect): CSSProperties {
  return {
    left: popupLeft(chord),
    width: Math.min(POPUP_WIDTH, window.innerWidth - 2 * POPUP_EDGE),
    top: chord.bottom + POPUP_GAP,
  };
}

/** Fixed-position style for the strip docked to the top or bottom of the
 * window, as wide as the editor. */
function dockStyle(editor: DOMRect): CSSProperties {
  return { left: editor.left, width: editor.width };
}

/** The tip's offset inside the popup, pointing at the chord's centre and
 * kept clear of the popup's rounded corners. */
function tipLeft(chord: DOMRect): number {
  const width = Math.min(POPUP_WIDTH, window.innerWidth - 2 * POPUP_EDGE);
  const centre = chord.left + chord.width / 2 - popupLeft(chord);
  return Math.max(16, Math.min(centre - 6, width - 28));
}

/** The panes {@link ChordProEditor}'s view toggle can show. */
export type EditorView = 'split' | 'source' | 'preview';
const VIEWS: ReadonlyArray<{ value: EditorView; label: string }> = [
  { value: 'split', label: 'Split' },
  { value: 'source', label: 'Source' },
  { value: 'preview', label: 'Preview' },
];
/** Viewport width (px) below which the view toggle starts on Source alone,
 *  drops Split, and the chord editor opens as a sheet from the bottom of the
 *  window; matches {@link SplitLayout}'s default stacking breakpoint. */
const NARROW_PX = 768;

/** Whether the viewport is narrower than {@link NARROW_PX}, following
 *  resizes and rotation. `false` where `matchMedia` is unavailable (SSR). */
function useNarrowViewport(): boolean {
  const query = `(max-width: ${NARROW_PX - 1}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const update = (): void => setNarrow(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return narrow;
}

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
  defaultView,
  wasmLoader,
  className,
  ...divProps
}: ChordProEditorProps): JSX.Element {
  // Performance toolbar state: chord audio. Chord diagrams are part of
  // the song (a {diagrams} line), so they come from the source.
  const [chordAudioEnabled, setChordAudioEnabled] = useState(false);
  // Which panes show: both, or one of them alone (viewToggle).
  const [view, setView] = useState<EditorView>(() =>
    defaultView ??
    (viewToggle &&
    typeof window !== 'undefined' &&
    window.matchMedia?.(`(max-width: ${NARROW_PX - 1}px)`).matches
      ? 'source'
      : 'split'),
  );
  const narrow = useNarrowViewport();
  // Split does not fit a narrow viewport: it is not offered there, and a
  // Split view picked on a wider one shows as Source.
  const shownView: EditorView = viewToggle ? (narrow && view === 'split' ? 'source' : view) : 'split';
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

  // The chord editor opens as a popup on the selected chord in the
  // preview, above or below it (the reader's pick, kept in this browser).
  // With no preview on screen (Source view) it stays a strip under the
  // panes.
  const [popupPosition, setPopupPosition] = useState<ChordEditorPosition>(() => {
    try {
      const saved = window.localStorage.getItem(POPUP_POSITION_KEY);
      return saved === 'top' || saved === 'bottom' ? saved : 'popup';
    } catch {
      return 'popup';
    }
  });
  const changePopupPosition = useCallback((next: ChordEditorPosition) => {
    setPopupPosition(next);
    try {
      window.localStorage.setItem(POPUP_POSITION_KEY, next);
    } catch {
      // Storage blocked: the pick lasts for this visit only.
    }
  }, []);
  // On a narrow viewport the chord editor is always a sheet from the bottom
  // of the window: a popup under the chord or a strip as wide as the editor
  // does not fit there, so the mode choice is hidden (the pick is kept for
  // wider viewports).
  const placement: ChordEditorPosition | 'sheet' = narrow ? 'sheet' : popupPosition;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [frame, setFrame] = useState<DOMRect | null>(null);
  const selected = chordEditor.chordSelection != null;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!selected || !root || shownView === 'source') {
      setAnchor(null);
      setFrame(null);
      return undefined;
    }
    // The selected chord's box on screen, and the editor's. Re-read when
    // the sheet re-renders (the walker draws asynchronously), scrolls or
    // resizes.
    const measure = (): void => {
      const chord = root.querySelector(
        `.${SLUG}-chord-pro-editor__preview-pane .chord--selected`,
      );
      setAnchor(chord ? chord.getBoundingClientRect() : null);
      setFrame(root.getBoundingClientRect());
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [selected, shownView, source]);

  // A click anywhere outside the popup closes it. Clicks in the preview
  // and source panes are left to them: the preview selects the chord
  // clicked (or deselects on a non-chord), and the source caret decides
  // the selection there.
  const popupRef = useRef<HTMLDivElement | null>(null);
  const { onChordSelectionChange } = chordEditor;
  const popupOpen = placement === 'popup' ? anchor != null : selected && frame != null;
  useEffect(() => {
    if (!popupOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      // The event's path, not its target: inside a shadow root (a host that
      // isolates the editor's styles) a listener on the document sees the
      // shadow host as the target, never the element pressed.
      const path = event.composedPath();
      if (popupRef.current && path.includes(popupRef.current)) return;
      const panes = rootRef.current?.querySelectorAll(
        `.${SLUG}-chord-pro-editor__preview-pane, .${SLUG}-chord-pro-editor__source-pane`,
      );
      if (panes && Array.from(panes).some((pane) => path.includes(pane))) return;
      onChordSelectionChange(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [popupOpen, onChordSelectionChange]);

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
            chordEditorPosition: popupPosition,
            onChordEditorPositionChange: narrow ? undefined : changePopupPosition,
            chordAudio: chordEditor.chordAudio,
            chordAudioEnabled,
            onChordAudioToggle: setChordAudioEnabled,
          }
        : {})}
      wasmLoader={wasmLoader}
    />
  );

  return (
    <div {...divProps} ref={rootRef} className={wrapperClass}>
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
                  {VIEWS.filter(({ value }) => !(narrow && value === 'split')).map(({ value, label }) => (
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

      {popupOpen ? (
        // The chord editor for the selected chord: a popup under it, a
        // strip fixed to the top or bottom of the window, or (narrow
        // viewports) a sheet from the bottom, placed by CSS alone.
        <div
          ref={popupRef}
          className={`${SLUG}-chord-pro-editor__chord-footer ${SLUG}-chord-pro-editor__chord-popup ${SLUG}-chord-pro-editor__chord-popup--${placement}`}
          style={
            placement === 'popup' && anchor
              ? popupStyle(anchor)
              : placement !== 'sheet' && frame
                ? dockStyle(frame)
                : undefined
          }
          onKeyDown={(event) => {
            // Enter closes the popup; edits are already applied as made.
            if (event.key === 'Enter') {
              event.preventDefault();
              chordEditor.onChordSelectionChange(null);
            }
          }}
        >
          {placement === 'popup' && anchor ? (
            <span
              className={`${SLUG}-chord-pro-editor__chord-popup-tip`}
              aria-hidden="true"
              style={{ left: tipLeft(anchor) }}
            />
          ) : null}
          <ChordInspector
            {...chordEditor.inspectorProps}
            onClose={() => chordEditor.onChordSelectionChange(null)}
            layout={placement === 'sheet' ? 'sheet' : 'panel'}
          />
        </div>
      ) : shownView === 'source' || !selected ? (
        // Full-width chord-editor footer spanning both panes (#2644), in
        // Source view; idle elsewhere it is hidden until a chord is picked.
        shownView === 'source' ? (
          <div className={`${SLUG}-chord-pro-editor__chord-footer`}>
            <ChordInspector {...chordEditor.inspectorProps} />
          </div>
        ) : null
      ) : null}
    </div>
  );
}
