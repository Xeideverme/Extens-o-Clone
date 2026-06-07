import type { AssetManifest } from "@clone3d/shared";
import { rewriteJs } from "./js-rewriter";

export interface RewriteWorkerJsInput {
  js: string;
  scriptUrlOrBaseUrl: string;
  manifest: AssetManifest;
  injectRuntime?: boolean;
}

export interface RewriteWorkerJsOutput {
  js: string;
  changed: boolean;
  directRewrites: number;
  unresolvedUrls: string[];
  warnings: string[];
  runtimeInjected: boolean;
}

export function rewriteWorkerJs(input: RewriteWorkerJsInput): RewriteWorkerJsOutput {
  const rewritten = rewriteJs({
    js: input.js,
    scriptUrlOrBaseUrl: input.scriptUrlOrBaseUrl,
    manifest: input.manifest
  });

  const shouldInject = input.injectRuntime !== false && !rewritten.js.includes("__CLONE3D_WORKER_RUNTIME_INSTALLED__");
  const prelude = shouldInject ? `${buildWorkerRuntimePrelude(input.manifest)}\n` : "";
  const js = `${prelude}${rewritten.js}`;

  return {
    js,
    changed: shouldInject || rewritten.directRewrites > 0,
    directRewrites: rewritten.directRewrites,
    unresolvedUrls: rewritten.unresolvedCandidates,
    warnings: rewritten.warnings,
    runtimeInjected: shouldInject
  };
}

export function buildWorkerRuntimePrelude(manifest: AssetManifest): string {
  const assetMapJson = JSON.stringify(manifest.map);
  return `(function () {
  try {
    if (self.__CLONE3D_WORKER_RUNTIME_INSTALLED__) return;
    self.__CLONE3D_WORKER_RUNTIME_INSTALLED__ = true;
    const ASSET_MAP = ${assetMapJson};

    function normalizeUrl(input, base) {
      try {
        return new URL(String(input), base || self.location.href).href;
      } catch {
        return String(input);
      }
    }

    function resolveUrl(input, base) {
      try {
        const raw = String(input);
        if (!raw || /^(data|blob|javascript|about|mailto|tel):/i.test(raw)) return raw;
        const abs = normalizeUrl(raw, base);
        const noHash = abs.split("#")[0];
        let pathname = "";
        let pathnameNoSearch = "";
        try {
          const parsed = new URL(abs);
          pathname = parsed.pathname + parsed.search;
          pathnameNoSearch = parsed.pathname;
        } catch {}
        return ASSET_MAP[raw] || ASSET_MAP[abs] || ASSET_MAP[noHash] || ASSET_MAP[pathname] || ASSET_MAP[pathnameNoSearch] || raw;
      } catch {
        return input;
      }
    }

    self.__clone3dResolveUrl = resolveUrl;

    if (typeof self.fetch === "function") {
      const originalFetch = self.fetch.bind(self);
      self.fetch = function clone3dWorkerFetch(input, init) {
        try {
          if (typeof input === "string" || input instanceof URL) {
            return originalFetch(resolveUrl(input), init);
          }
          if (input && input.url) {
            return originalFetch(new Request(resolveUrl(input.url), input), init);
          }
        } catch {}
        return originalFetch(input, init);
      };
    }

    if (typeof self.importScripts === "function") {
      const originalImportScripts = self.importScripts.bind(self);
      self.importScripts = function clone3dImportScripts(...urls) {
        return originalImportScripts(...urls.map((url) => resolveUrl(url)));
      };
    }
  } catch {}
})();`;
}
