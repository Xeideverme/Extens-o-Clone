import type { AssetDiscovery, AssetSource } from "@clone3d/shared";
import { addDiscovery, mergeDiscoveries } from "./asset-discovery";

const ATTRIBUTE_SELECTORS = [
  { selector: "[src]", attribute: "src", source: "dom" },
  { selector: "[href]", attribute: "href", source: "dom" },
  { selector: "[poster]", attribute: "poster", source: "dom" },
  { selector: "[data-src]", attribute: "data-src", source: "dom" },
  { selector: "[data-href]", attribute: "data-href", source: "dom" },
  { selector: "[data-model]", attribute: "data-model", source: "dom" },
  { selector: "[data-model-src]", attribute: "data-model-src", source: "dom" },
  { selector: "[ar-src]", attribute: "ar-src", source: "dom" },
  { selector: "[ios-src]", attribute: "ios-src", source: "dom" }
] satisfies Array<{ selector: string; attribute: string; source: AssetSource }>;

const SRCSET_SELECTORS = [
  { selector: "[srcset]", attribute: "srcset" },
  { selector: "source[srcset]", attribute: "srcset" }
];

export function scanDomAssets(): AssetDiscovery[] {
  const discoveries: AssetDiscovery[] = [];

  addDiscovery(discoveries, {
    rawUrl: location.href,
    source: ["html", "performance"],
    element: "document",
    attribute: "location"
  });

  scanAttributes(discoveries);
  scanSrcsets(discoveries);
  scanInlineCss(discoveries);
  scanStylesheets(discoveries);
  scanInlineJsonScripts(discoveries);

  return mergeDiscoveries(discoveries);
}

function scanAttributes(discoveries: AssetDiscovery[]): void {
  for (const rule of ATTRIBUTE_SELECTORS) {
    for (const element of document.querySelectorAll(rule.selector)) {
      const value = element.getAttribute(rule.attribute);
      if (!value) {
        continue;
      }

      addDiscovery(discoveries, {
        rawUrl: value,
        source: inferSource(element, rule.source),
        element: element.tagName.toLowerCase(),
        attribute: rule.attribute
      });
    }
  }
}

function scanSrcsets(discoveries: AssetDiscovery[]): void {
  for (const rule of SRCSET_SELECTORS) {
    for (const element of document.querySelectorAll(rule.selector)) {
      const value = element.getAttribute(rule.attribute);
      if (!value) {
        continue;
      }

      for (const candidate of parseSrcset(value)) {
        addDiscovery(discoveries, {
          rawUrl: candidate,
          source: "dom",
          element: element.tagName.toLowerCase(),
          attribute: rule.attribute
        });
      }
    }
  }
}

function scanInlineCss(discoveries: AssetDiscovery[]): void {
  for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
    collectCssUrls(discoveries, element.getAttribute("style") ?? "", document.baseURI, {
      element: element.tagName.toLowerCase(),
      attribute: "style"
    });
  }

  for (const element of document.querySelectorAll<HTMLStyleElement>("style")) {
    collectCssUrls(discoveries, element.textContent ?? "", document.baseURI, {
      element: "style",
      attribute: "textContent"
    });
  }
}

function scanStylesheets(discoveries: AssetDiscovery[]): void {
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) {
      addDiscovery(discoveries, {
        rawUrl: sheet.href,
        source: "css",
        baseUrl: document.baseURI,
        element: "link",
        attribute: "href"
      });
    }

    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }

    if (!rules) {
      continue;
    }

    const cssBaseUrl = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      collectCssUrls(discoveries, rule.cssText, cssBaseUrl, {
        element: "css-rule",
        attribute: "cssText"
      });
    }
  }
}

function scanInlineJsonScripts(discoveries: AssetDiscovery[]): void {
  const selector = [
    'script[type="application/json"]',
    'script[type="application/ld+json"]',
    "script#__NEXT_DATA__"
  ].join(",");

  for (const element of document.querySelectorAll<HTMLScriptElement>(selector)) {
    collectStringUrls(discoveries, element.textContent ?? "", {
      element: "script",
      attribute: "textContent"
    });
  }
}

function inferSource(element: Element, fallback: AssetSource): AssetSource {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "script") {
    return "script";
  }

  if (tagName === "link" && element.getAttribute("rel")?.toLowerCase().includes("stylesheet")) {
    return "css";
  }

  return fallback;
}

function collectCssUrls(
  discoveries: AssetDiscovery[],
  cssText: string,
  baseUrl: string,
  meta: { element: string; attribute: string }
): void {
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const importPattern = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1/gi;

  for (const match of cssText.matchAll(urlPattern)) {
    addDiscovery(discoveries, {
      rawUrl: match[2],
      source: "css",
      baseUrl,
      ...meta
    });
  }

  for (const match of cssText.matchAll(importPattern)) {
    addDiscovery(discoveries, {
      rawUrl: match[2],
      source: "css",
      baseUrl,
      ...meta
    });
  }
}

function collectStringUrls(
  discoveries: AssetDiscovery[],
  text: string,
  meta: { element: string; attribute: string }
): void {
  const stringUrlPattern = /["']([^"']+\.(?:glb|gltf|bin|drc|ktx2|basis|wasm|hdr|exr|png|jpg|jpeg|webp|avif|svg|gif|ogg|mp3|wav|mp4|webm|json|js|mjs|css)(?:\?[^"']*)?)["']/gi;

  for (const match of text.matchAll(stringUrlPattern)) {
    addDiscovery(discoveries, {
      rawUrl: match[1],
      source: "script",
      ...meta
    });
  }
}

function parseSrcset(value: string): string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}
