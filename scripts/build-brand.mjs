#!/usr/bin/env node
/*
 * Brand generator.
 *
 * `brand/brand.json` is the single source of every brand value: the product
 * name, the names that identify it in output (console prefix, default PDF
 * file name, drag-and-drop MIME type), the logo, the accent colour scale, the
 * neutrals and the font families. This script projects it into every place
 * that needs it, so no surface hardcodes a brand value:
 *
 *   - design-system/tokens.css          --accent-* / --fg-on-accent / --ink-* /
 *                                       --font-* values, rewritten in place
 *                                       (then run scripts/build-tokens.mjs to
 *                                       carry them into the package stylesheets)
 *   - packages/react/src/brand.generated.ts   BRAND constant for the React
 *                                       components (title, file names, prefixes,
 *                                       colours for the CodeMirror theme)
 *   - packages/react/src/styles.css     the editor header's logo mark, between
 *                                       the @generated:brand-mark markers
 *   - crates/chordpro/src/brand.rs      the same values as Rust constants for
 *                                       the renderers and warning messages
 *
 * Every target is checked: a token, marker or key this script expects but
 * cannot find throws, so nothing is silently left on the old brand.
 *
 * Zero dependencies. Run from the repo root: `node scripts/build-brand.mjs`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const write = (p, text) => writeFileSync(join(repoRoot, p), text);

const brand = JSON.parse(read("brand/brand.json"));

const REQUIRED = ["name", "slug", "consolePrefix", "pdfFilename", "dragMime", "logo", "accent", "neutral", "fonts"];
for (const key of REQUIRED) {
  if (brand[key] === undefined) throw new Error(`brand/brand.json: missing "${key}"`);
}
const HEX = /^#[0-9A-Fa-f]{6}$/;
if (!/^[a-z][a-z0-9-]*$/.test(brand.slug)) {
  throw new Error(`brand/brand.json: slug must be lowercase letters, digits and hyphens: ${brand.slug}`);
}
for (const group of ["accent", "neutral"]) {
  for (const [k, v] of Object.entries(brand[group])) {
    if (!HEX.test(v)) throw new Error(`brand/brand.json: ${group}.${k} is not a #RRGGBB colour: ${v}`);
  }
}

// ---------------------------------------------------------------------------
// design-system/tokens.css: brand values, rewritten in place.
// ---------------------------------------------------------------------------

/** Token name -> value for every brand-owned token in tokens.css. */
const tokenValues = new Map();
for (const [k, v] of Object.entries(brand.accent)) {
  tokenValues.set(k === "fg" ? "fg-on-accent" : `accent-${k}`, v);
}
for (const [k, v] of Object.entries(brand.neutral)) tokenValues.set(`ink-${k}`, v);
for (const [k, v] of Object.entries(brand.fonts)) tokenValues.set(`font-${k}`, v);

let tokens = read("design-system/tokens.css");
for (const [name, value] of tokenValues) {
  const decl = new RegExp(`(\\n\\s*--${name}:\\s*)([^;]+)(;)`);
  if (!decl.test(tokens)) {
    throw new Error(`design-system/tokens.css: no --${name} declaration for brand value ${value}`);
  }
  tokens = tokens.replace(decl, (_, before, _old, after) => `${before}${value}${after}`);
}
write("design-system/tokens.css", tokens);

// ---------------------------------------------------------------------------
// Fallback colours in the package stylesheets.
//
// Component rules read tokens as `var(--cs-name, #fallback)`. The fallback is
// what paints a component mounted outside the token-scoped roots, so it must
// carry the brand too: every fallback of a token that resolves to a colour is
// rewritten from tokens.css, never hand-maintained.
// ---------------------------------------------------------------------------

/** tokens.css `:root` declarations, with var() chains resolved. */
function resolvedTokens(css) {
  const root = css.slice(css.indexOf(":root"), css.indexOf("\n}", css.indexOf(":root")));
  const raw = new Map();
  for (const m of root.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    raw.set(m[1], m[2].trim());
  }
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`tokens.css: --${name} refers to itself`);
    seen.add(name);
    const value = raw.get(name);
    const alias = value && /^var\(--([\w-]+)\)$/.exec(value);
    return alias ? resolve(alias[1], seen) : value;
  };
  return new Map([...raw.keys()].map((n) => [n, resolve(n)]));
}
const resolved = resolvedTokens(tokens);
const FALLBACK_TARGETS = ["packages/react/src/styles.css", "packages/react-ui/src/styles.css"];
for (const path of FALLBACK_TARGETS) {
  const css = read(path).replace(/var\(--cs-([\w-]+),\s*(#[0-9A-Fa-f]{3,8})\)/g, (whole, name, _old) => {
    const value = resolved.get(name);
    return value && HEX.test(value) ? `var(--cs-${name}, ${value})` : whole;
  });
  write(path, css);
}

// ---------------------------------------------------------------------------
// The logo, as a data URI usable in CSS and in JS.
// ---------------------------------------------------------------------------

const logoSvg = read(brand.logo)
  // Drop the XML prolog, comments and the <title>/<desc> metadata: they are
  // not drawn, and <desc> carries the upstream site's URL.
  .replace(/<\?xml[\s\S]*?\?>/g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<title>[\s\S]*?<\/title>/g, "")
  .replace(/<desc>[\s\S]*?<\/desc>/g, "")
  .replace(/\s+/g, " ")
  .replace(/>\s+</g, "><")
  .trim();
// Percent-encode only what a CSS url('...') and a data URI cannot carry raw.
const logoDataUri =
  "data:image/svg+xml;utf8," + logoSvg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/'/g, "%27");

// ---------------------------------------------------------------------------
// packages/react/src/styles.css: the logo mark.
// ---------------------------------------------------------------------------

// The class-name prefix in the React stylesheet. The components build every
// class from SLUG (brand.generated.ts); the stylesheet's selectors, keyframes
// and ids are renamed here to match. The slug the file was last written with
// is recorded in its first-line marker, so a rebrand renames old -> new.
{
  const path = "packages/react/src/styles.css";
  let css = read(path);
  const marker = /^\/\* @brand-slug: ([a-z][a-z0-9-]*) \*\/\n/;
  const found = marker.exec(css);
  const previous = found ? found[1] : "chordsketch";
  if (found) css = css.slice(found[0].length);
  if (previous !== brand.slug) {
    css = css.replace(new RegExp(`(?<![\\w-])${previous}-`, "g"), `${brand.slug}-`);
  }
  write(path, `/* @brand-slug: ${brand.slug} */\n` + css);
}

const MARK_START = "/* @generated:brand-mark:start — DO NOT EDIT. Source: brand/brand.json. Run: node scripts/build-brand.mjs */";
const MARK_END = "/* @generated:brand-mark:end */";
let styles = read("packages/react/src/styles.css");
const markStart = styles.indexOf(MARK_START);
const markEnd = styles.indexOf(MARK_END);
if (markStart < 0 || markEnd < markStart) {
  throw new Error("packages/react/src/styles.css: @generated:brand-mark markers not found");
}
styles =
  styles.slice(0, markStart + MARK_START.length) +
  `\n  background-image: url('${logoDataUri}');\n  ` +
  styles.slice(markEnd);
write("packages/react/src/styles.css", styles);

// ---------------------------------------------------------------------------
// packages/react/src/brand.generated.ts
// ---------------------------------------------------------------------------

const ts = `// @generated by scripts/build-brand.mjs from brand/brand.json. DO NOT EDIT.
// Change brand/brand.json and run \`node scripts/build-brand.mjs\` instead.

/** Every brand value the React components use. */
export const BRAND = ${JSON.stringify(
  {
    name: brand.name,
    slug: brand.slug,
    consolePrefix: brand.consolePrefix,
    pdfFilename: brand.pdfFilename,
    dragMime: brand.dragMime,
    logoDataUri,
    accent: brand.accent,
    neutral: brand.neutral,
    fonts: brand.fonts,
  },
  null,
  2,
)} as const;

/** The product's identifier in class names, ids and data attributes:
 *  every \`<slug>-…\` class the components emit starts with this. */
export const SLUG = BRAND.slug;

/** Every design token whose value resolves to a colour or a font stack,
 *  resolved through its var() aliases (from design-system/tokens.css). */
export const TOKEN_VALUES: Readonly<Record<string, string>> = ${JSON.stringify(
  Object.fromEntries(
    [...resolved].filter(([n, v]) => v && (HEX.test(v) || n.startsWith("font-"))),
  ),
  null,
  2,
)};

/** \`var(--cs-<name>, <its resolved value>)\` for a design token, so inline
 *  styles carry the brand's value as their fallback instead of a hardcoded one.
 *  Throws on an unknown token so a typo cannot silently drop the fallback. */
export function cssVar(name: string): string {
  const value = TOKEN_VALUES[name];
  if (value === undefined) throw new Error(\`cssVar: unknown design token --\${name}\`);
  return \`var(--cs-\${name}, \${value})\`;
}
`;
write("packages/react/src/brand.generated.ts", ts);

// ---------------------------------------------------------------------------
// crates/chordpro/src/brand.rs
// ---------------------------------------------------------------------------

const rsString = (s) => JSON.stringify(s); // a JSON string literal is a valid Rust string literal here
const constName = (group, key) => `${group}_${key}`.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const rsLines = [];
for (const [k, v] of Object.entries(brand.accent)) {
  rsLines.push(`/// \`accent.${k}\` in \`brand/brand.json\`.`, `pub const ${constName("accent", k)}: &str = ${rsString(v)};`);
}
for (const [k, v] of Object.entries(brand.neutral)) {
  rsLines.push(`/// \`neutral.${k}\` in \`brand/brand.json\`.`, `pub const ${constName("neutral", k)}: &str = ${rsString(v)};`);
}
for (const [k, v] of Object.entries(brand.fonts)) {
  rsLines.push(`/// \`fonts.${k}\` in \`brand/brand.json\`.`, `pub const ${constName("font", k)}: &str = ${rsString(v)};`);
}
const rs = `//! Brand values, generated by \`scripts/build-brand.mjs\` from
//! \`brand/brand.json\`. DO NOT EDIT: change \`brand/brand.json\` and run
//! \`node scripts/build-brand.mjs\` instead.
//!
//! Every renderer and message that shows the product's name or look reads it
//! from here, so a rebrand is one file plus a regeneration.

/// The product name shown to users.
pub const NAME: &str = ${rsString(brand.name)};

/// Lowercase identifier for the product in file names (config files,
/// temporary files) and markup (data attributes).
pub const SLUG: &str = ${rsString(brand.slug)};

/// Prefix on warnings forwarded to a console or stderr.
pub const CONSOLE_PREFIX: &str = ${rsString(brand.consolePrefix)};

${rsLines.join("\n")}

/// The value of a design token from \`design-system/tokens.css\` (colours and
/// font stacks, with \`var()\` aliases resolved), by name without the leading
/// \`--\`. \`None\` for a token that is not a colour or font.
#[must_use]
pub fn token(name: &str) -> Option<&'static str> {
    match name {
${[...resolved]
  .filter(([n, v]) => v && (HEX.test(v) || n.startsWith("font-")))
  .map(([n, v]) => `        ${rsString(n)} => Some(${rsString(v)}),`)
  .join("\n")}
        _ => None,
    }
}
`;
write("crates/chordpro/src/brand.rs", rs);
// The workspace's `cargo fmt --check` covers this file, so format it here
// rather than hand-wrapping long literals. Fails loudly if rustfmt is missing.
execFileSync("rustfmt", ["--edition", "2024", join(repoRoot, "crates/chordpro/src/brand.rs")], { stdio: "inherit" });

console.log("brand: wrote tokens.css values, brand.generated.ts, the styles.css logo mark and brand.rs");
