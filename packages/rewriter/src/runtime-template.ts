import type { AssetManifest } from "@clone3d/shared";
import type { InlineResponse } from "./types";

export function buildRuntimeResolverScript(
  manifest: AssetManifest,
  inlineResponses: Record<string, InlineResponse> = {}
): string {
  const assetMapJson = JSON.stringify(manifest.map);
  const inlineResponsesJson = JSON.stringify(inlineResponses);

  return `(function () {
  try {
    if (window.__CLONE3D_RUNTIME_INSTALLED__) return;
    window.__CLONE3D_RUNTIME_INSTALLED__ = true;

    const ASSET_MAP = ${assetMapJson};
    const INLINE_RESPONSES = ${inlineResponsesJson};
    window.__CLONE3D_ASSET_MAP__ = ASSET_MAP;
    window.__CLONE3D_INLINE_RESPONSES__ = INLINE_RESPONSES;

    function normalizeUrl(input, base) {
      try {
        return new URL(String(input), base || location.href).href;
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

    function inlineResponseFor(input, base) {
      const raw = String(input);
      const abs = normalizeUrl(raw, base);
      const noHash = abs.split("#")[0];
      return INLINE_RESPONSES[raw] || INLINE_RESPONSES[abs] || INLINE_RESPONSES[noHash];
    }

    window.__clone3dResolveUrl = resolveUrl;

    try {
      const originalFetch = window.fetch;
      window.fetch = function clone3dFetch(input, init) {
        const url = typeof input === "string" || input instanceof URL ? String(input) : input && input.url;
        const inline = url ? inlineResponseFor(url, location.href) : undefined;
        if (inline) {
          return Promise.resolve(new Response(inline.bodyText, {
            status: inline.status || 200,
            headers: { "content-type": inline.contentType || "application/json; charset=utf-8" }
          }));
        }

        if (typeof input === "string" || input instanceof URL) {
          return originalFetch.call(this, resolveUrl(String(input), location.href), init);
        }

        return originalFetch.call(this, input, init);
      };
    } catch {}

    try {
      const OriginalRequest = window.Request;
      window.Request = function Clone3DRequest(input, init) {
        if (typeof input === "string" || input instanceof URL) {
          return new OriginalRequest(resolveUrl(String(input), location.href), init);
        }
        return new OriginalRequest(input, init);
      };
      window.Request.prototype = OriginalRequest.prototype;
    } catch {}

    try {
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function clone3dOpen(method, url) {
        arguments[1] = resolveUrl(url, location.href);
        return originalOpen.apply(this, arguments);
      };
    } catch {}

    try {
      const OriginalWorker = window.Worker;
      window.Worker = function Clone3DWorker(url, options) {
        return new OriginalWorker(resolveUrl(url, location.href), options);
      };
      window.Worker.prototype = OriginalWorker.prototype;
    } catch {}

    try {
      if (window.SharedWorker) {
        const OriginalSharedWorker = window.SharedWorker;
        window.SharedWorker = function Clone3DSharedWorker(url, options) {
          return new OriginalSharedWorker(resolveUrl(url, location.href), options);
        };
        window.SharedWorker.prototype = OriginalSharedWorker.prototype;
      }
    } catch {}

    function patchUrlProperty(proto, property) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(proto, property);
        if (!descriptor || !descriptor.set) return;
        Object.defineProperty(proto, property, {
          get: descriptor.get,
          set: function clone3dSetUrl(value) {
            return descriptor.set.call(this, resolveUrl(value, location.href));
          },
          configurable: true,
          enumerable: descriptor.enumerable
        });
      } catch {}
    }

    patchUrlProperty(HTMLImageElement.prototype, "src");
    patchUrlProperty(HTMLMediaElement.prototype, "src");
    patchUrlProperty(HTMLSourceElement.prototype, "src");

    try {
      const originalSetAttribute = Element.prototype.setAttribute;
      const URL_ATTRS = new Set(["src", "href", "poster", "data-src", "data-href", "ar-src", "ios-src", "environment-image", "skybox-image", "data-model", "data-model-src", "data-background"]);
      Element.prototype.setAttribute = function clone3dSetAttribute(name, value) {
        if (URL_ATTRS.has(String(name).toLowerCase())) {
          return originalSetAttribute.call(this, name, resolveUrl(value, location.href));
        }
        return originalSetAttribute.call(this, name, value);
      };
    } catch {}
  } catch {}
})();`;
}
