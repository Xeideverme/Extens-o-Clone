import { resolvePublicUrl, shouldIgnoreUrl } from "./asset-map";
import { rewriteCss } from "./css-rewriter";
import { rewriteJs } from "./js-rewriter";
import type { RewriteHtmlInput, RewriteHtmlOutput } from "./types";

const URL_ATTRS = new Set([
  "src",
  "href",
  "poster",
  "data-src",
  "data-href",
  "data-model",
  "data-model-src",
  "ar-src",
  "ios-src",
  "environment-image",
  "skybox-image",
  "data-background"
]);

export function rewriteHtml(input: RewriteHtmlInput): RewriteHtmlOutput {
  const warnings: string[] = [];
  const unresolvedUrls: string[] = [];
  let htmlRewrites = 0;
  let cssRewrites = 0;
  let jsDirectRewrites = 0;
  let html = input.html;

  html = normalizeDoctype(html, input.doctype);

  html = html.replace(/<base\b[^>]*>/gi, (match) => {
    warnings.push(`removed base element: ${match.slice(0, 120)}`);
    htmlRewrites += 1;
    return "";
  });

  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs: string, css: string) => {
    const cssOutput = rewriteCss({
      css,
      cssUrlOrBaseUrl: input.baseUrl,
      manifest: input.manifest
    });
    cssRewrites += cssOutput.rewrites;
    unresolvedUrls.push(...cssOutput.unresolvedUrls);
    warnings.push(...cssOutput.warnings);
    return `<style${attrs}>${escapeStyleText(cssOutput.css)}</style>`;
  });

  html = html.replace(/<link\b([^>]*?)>/gi, (match, attrs: string) => {
    const rel = getAttribute(attrs, "rel")?.toLowerCase() ?? "";
    const href = getAttribute(attrs, "href");
    if (!href) {
      return match;
    }

    if (rel.split(/\s+/).includes("modulepreload") && resolveTextAsset(href, input.baseUrl, input.jsByUrl) !== undefined) {
      warnings.push(`removed modulepreload for inlined module: ${href}`);
      htmlRewrites += 1;
      return "";
    }

    if (!rel.split(/\s+/).includes("stylesheet")) {
      return match;
    }

    const cssText = resolveTextAsset(href, input.baseUrl, input.cssByUrl);
    if (cssText !== undefined) {
      const cssOutput = rewriteCss({
        css: cssText,
        cssUrlOrBaseUrl: absolutize(href, input.baseUrl) ?? input.baseUrl,
        manifest: input.manifest
      });
      cssRewrites += cssOutput.rewrites;
      unresolvedUrls.push(...cssOutput.unresolvedUrls);
      warnings.push(...cssOutput.warnings);
      htmlRewrites += 1;
      return `<style data-clone3d-inlined-from="${escapeHtmlAttribute(href)}">${escapeStyleText(cssOutput.css)}</style>`;
    }

    const publicUrl = resolvePublicUrl(href, input.baseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedUrls.push(href);
      return match;
    }

    htmlRewrites += 1;
    return `<link${setAttribute(attrs, "href", publicUrl)}>`;
  });

  html = html.replace(/<script\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*)><\/script>/gi, (match, beforeSrc: string, quote: string, src: string, afterSrc: string) => {
    const attrs = `${beforeSrc} src=${quote}${src}${quote}${afterSrc}`;
    const jsText = resolveTextAsset(src, input.baseUrl, input.jsByUrl);
    if (jsText !== undefined) {
      const jsOutput = rewriteJs({
        js: jsText,
        scriptUrlOrBaseUrl: absolutize(src, input.baseUrl) ?? input.baseUrl,
        manifest: input.manifest
      });
      jsDirectRewrites += jsOutput.directRewrites;
      unresolvedUrls.push(...jsOutput.unresolvedCandidates);
      warnings.push(...jsOutput.warnings);
      htmlRewrites += 1;
      return `<script${removeAttribute(attrs, "src")} data-clone3d-inlined-from="${escapeHtmlAttribute(src)}">\n// Clone3D inlined from: ${src.replace(/\r?\n/g, " ")}\n${escapeScriptText(jsOutput.js)}</script>`;
    }

    const publicUrl = resolvePublicUrl(src, input.baseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedUrls.push(src);
      return match;
    }

    htmlRewrites += 1;
    return `<script${setAttribute(attrs, "src", publicUrl)}></script>`;
  });

  html = html.replace(/\sstyle=(["'])(.*?)\1/gi, (match, quote: string, styleValue: string) => {
    const cssOutput = rewriteCss({
      css: styleValue,
      cssUrlOrBaseUrl: input.baseUrl,
      manifest: input.manifest
    });
    cssRewrites += cssOutput.rewrites;
    unresolvedUrls.push(...cssOutput.unresolvedUrls);
    warnings.push(...cssOutput.warnings);
    return ` style=${quote}${escapeAttributePreservingQuote(cssOutput.css, quote)}${quote}`;
  });

  html = html.replace(/\ssrcset=(["'])(.*?)\1/gi, (match, quote: string, srcset: string) => {
    const rewritten = rewriteSrcset(srcset, input.baseUrl, input.manifest, unresolvedUrls);
    if (rewritten.rewrites > 0) {
      htmlRewrites += rewritten.rewrites;
      return ` srcset=${quote}${escapeAttributePreservingQuote(rewritten.value, quote)}${quote}`;
    }

    return match;
  });

  html = html.replace(/<([a-z][\w:-]*)([^<>]*?)>/gi, (match, tagName: string, attrs: string) => {
    if (/^script$/i.test(tagName) || /^style$/i.test(tagName)) {
      return match;
    }

    let nextAttrs = attrs;
    for (const attrName of URL_ATTRS) {
      const attrValue = getAttribute(nextAttrs, attrName);
      if (!attrValue || shouldIgnoreUrl(attrValue)) {
        continue;
      }

      const publicUrl = resolvePublicUrl(attrValue, input.baseUrl, input.manifest);
      if (!publicUrl) {
        unresolvedUrls.push(attrValue);
        continue;
      }

      nextAttrs = setAttribute(nextAttrs, attrName, publicUrl);
      htmlRewrites += 1;
    }

    return `<${tagName}${nextAttrs}>`;
  });

  html = ensureMetaCharset(html);
  html = injectHeadScripts(html, [input.manifestScript, input.runtimeScript, input.reportScript].filter(Boolean).join("\n"));

  return {
    html,
    htmlRewrites,
    cssRewrites,
    jsDirectRewrites,
    jsonInlined: Object.keys(input.inlineResponses).length,
    warnings: unique(warnings),
    unresolvedUrls: unique(unresolvedUrls)
  };
}

function rewriteSrcset(srcset: string, baseUrl: string, manifest: RewriteHtmlInput["manifest"], unresolvedUrls: string[]) {
  let rewrites = 0;
  const value = srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      const [url, ...descriptors] = trimmed.split(/\s+/);
      if (!url || shouldIgnoreUrl(url)) {
        return candidate;
      }

      const publicUrl = resolvePublicUrl(url, baseUrl, manifest);
      if (!publicUrl) {
        unresolvedUrls.push(url);
        return candidate;
      }

      rewrites += 1;
      return [publicUrl, ...descriptors].join(" ");
    })
    .join(", ");

  return { value, rewrites };
}

function resolveTextAsset(value: string, baseUrl: string, textByUrl: Map<string, string>): string | undefined {
  const raw = value.trim();
  if (textByUrl.has(raw)) {
    return textByUrl.get(raw);
  }

  try {
    const url = new URL(raw, baseUrl);
    return (
      textByUrl.get(url.href) ??
      textByUrl.get(url.href.split("#")[0] ?? url.href) ??
      textByUrl.get(`${url.pathname}${url.search}`) ??
      textByUrl.get(url.pathname)
    );
  } catch {
    return undefined;
  }
}

function normalizeDoctype(html: string, doctype: string | undefined): string {
  if (/^\s*<!doctype/i.test(html)) {
    return html;
  }

  return `${doctype?.trim() || "<!doctype html>"}\n${html}`;
}

function ensureMetaCharset(html: string): string {
  if (/<meta\b[^>]*charset=/i.test(html)) {
    return html;
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>\n<meta charset="utf-8">`);
  }

  return html.replace(/<html\b([^>]*)>/i, `<html$1>\n<head><meta charset="utf-8"></head>`);
}

function injectHeadScripts(html: string, scripts: string): string {
  if (!scripts) {
    return html;
  }

  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b([^>]*)>/i, `<head$1>\n${scripts}`);
  }

  return html.replace(/<html\b([^>]*)>/i, `<html$1>\n<head>${scripts}</head>`);
}

function getAttribute(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return attrs.match(pattern)?.[2];
}

function setAttribute(attrs: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])(.*?)\\2`, "i");
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, (_match, prefix: string) => `${prefix}"${escapeHtmlAttribute(value)}"`);
  }

  return `${attrs} ${name}="${escapeHtmlAttribute(value)}"`;
}

function removeAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["']).*?\\1`, "i");
  return attrs.replace(pattern, "");
}

function absolutize(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeScriptText(value: string): string {
  return value
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

function escapeAttributePreservingQuote(value: string, quote: string): string {
  const escaped = value.replace(/&/g, "&amp;");
  return quote === '"' ? escaped.replace(/"/g, "&quot;") : escaped.replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
