import { resolvePublicUrl, shouldIgnoreUrl } from "./asset-map";
import type { RewriteJsInput, RewriteJsOutput } from "./types";

const RELEVANT_EXTENSIONS = /\.(glb|gltf|bin|drc|ktx2|basis|wasm|hdr|exr|png|jpe?g|webp|avif|svg|gif|ogg|mp3|wav|mp4|webm|json|mjs?|css)([?#][^"'`\s)]*)?$/i;

export function rewriteJs(input: RewriteJsInput): RewriteJsOutput {
  const unresolvedCandidates: string[] = [];
  const warnings: string[] = [];
  let directRewrites = 0;

  let js = input.js.replace(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g, (match, quote: string, rawValue: string) => {
    if (quote === "`" && rawValue.includes("${")) {
      return match;
    }

    const value = unescapeJsString(rawValue);
    if (!looksLikeAssetReference(value) || shouldIgnoreUrl(value)) {
      return match;
    }

    const publicUrl = resolvePublicUrl(value, input.scriptUrlOrBaseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedCandidates.push(value);
      return match;
    }

    directRewrites += 1;
    return `${quote}${escapeForQuote(publicUrl, quote)}${quote}`;
  });

  js = js.replace(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g, (_match, quote: string, specifier: string) => {
    directRewrites += 1;
    return `import(window.__clone3dResolveModuleUrl ? window.__clone3dResolveModuleUrl(${quote}${escapeForQuote(specifier, quote)}${quote}, ${quote}${escapeForQuote(input.scriptUrlOrBaseUrl, quote)}${quote}) : ${quote}${escapeForQuote(specifier, quote)}${quote})`;
  });

  if (/\bimport\s*\(\s*[^"'`]/.test(js)) {
    warnings.push("dynamic-import-non-literal");
  }

  return {
    js,
    directRewrites,
    unresolvedCandidates: unique(unresolvedCandidates),
    warnings
  };
}

function looksLikeAssetReference(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("/") ||
    RELEVANT_EXTENSIONS.test(value)
  );
}

function unescapeJsString(value: string): string {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function escapeForQuote(value: string, quote: string): string {
  return value.replace(/\\/g, "\\\\").replace(new RegExp(escapeRegExp(quote), "g"), `\\${quote}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
