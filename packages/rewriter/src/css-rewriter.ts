import { resolvePublicUrl, shouldIgnoreUrl } from "./asset-map";
import type { RewriteCssInput, RewriteCssOutput } from "./types";

export function rewriteCss(input: RewriteCssInput): RewriteCssOutput {
  const unresolvedUrls: string[] = [];
  const warnings: string[] = [];
  let rewrites = 0;
  let css = input.css;

  css = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote: string, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (shouldIgnoreUrl(trimmed)) {
      return match;
    }

    const publicUrl = resolvePublicUrl(trimmed, input.cssUrlOrBaseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedUrls.push(trimmed);
      return match;
    }

    rewrites += 1;
    const preservedQuote = quote || "";
    return `url(${preservedQuote}${publicUrl}${preservedQuote})`;
  });

  css = css.replace(/@import\s+(url\(\s*)?(["'])([^"']+)\2(\s*\))?/gi, (match, urlPrefix: string | undefined, quote: string, rawUrl: string, urlSuffix: string | undefined) => {
    const trimmed = rawUrl.trim();
    if (shouldIgnoreUrl(trimmed)) {
      return match;
    }

    const publicUrl = resolvePublicUrl(trimmed, input.cssUrlOrBaseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedUrls.push(trimmed);
      return match;
    }

    rewrites += 1;
    if (urlPrefix) {
      return `@import ${urlPrefix}${quote}${publicUrl}${quote}${urlSuffix ?? ")"}`;
    }

    return `@import ${quote}${publicUrl}${quote}`;
  });

  return {
    css,
    rewrites,
    unresolvedUrls: unique(unresolvedUrls),
    warnings
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
