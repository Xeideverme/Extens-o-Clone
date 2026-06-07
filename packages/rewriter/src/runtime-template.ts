import type { AssetManifest } from "@clone3d/shared";
import type { InlineResponse } from "./types";

export function buildRuntimeResolverScript(
  manifest: AssetManifest,
  inlineResponses: Record<string, InlineResponse> = {},
  apiReplayMap: Record<string, InlineResponse> = {}
): string {
  const assetMapJson = JSON.stringify(manifest.map);
  const inlineResponsesJson = JSON.stringify(inlineResponses);
  const apiReplayMapJson = JSON.stringify(apiReplayMap);

  return `(function () {
  try {
    if (window.__CLONE3D_RUNTIME_INSTALLED__) return;
    window.__CLONE3D_RUNTIME_INSTALLED__ = true;

    const ASSET_MAP = ${assetMapJson};
    const INLINE_RESPONSES = ${inlineResponsesJson};
    const API_REPLAY = ${apiReplayMapJson};
    window.__CLONE3D_ASSET_MAP__ = ASSET_MAP;
    window.__CLONE3D_INLINE_RESPONSES__ = INLINE_RESPONSES;
    window.__CLONE3D_API_REPLAY__ = API_REPLAY;

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

    function apiReplayKeys(method, input, base) {
      const normalizedMethod = String(method || "GET").toUpperCase();
      const raw = String(input);
      const abs = normalizeUrl(raw, base);
      const keys = [normalizedMethod + " " + raw, normalizedMethod + " " + abs, normalizedMethod + " " + abs.split("#")[0]];
      try {
        const parsed = new URL(abs);
        keys.push(normalizedMethod + " " + parsed.pathname + parsed.search);
        keys.push(normalizedMethod + " " + parsed.pathname);
      } catch {}
      return keys;
    }

    function findApiReplay(method, input, base) {
      if (String(method || "GET").toUpperCase() !== "GET") return undefined;
      for (const key of apiReplayKeys(method, input, base || location.href)) {
        if (API_REPLAY[key]) return API_REPLAY[key];
      }
      return undefined;
    }

    function readFetchMethod(input, init) {
      return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    }

    function readFetchUrl(input) {
      return typeof input === "string" || input instanceof URL ? String(input) : input && input.url;
    }

    function responseFromReplay(replay) {
      return new Response(replay.bodyText || "", {
        status: replay.status || 200,
        headers: { "content-type": replay.contentType || "application/json; charset=utf-8" }
      });
    }

    window.__clone3dResolveUrl = resolveUrl;

    try {
      const originalFetch = window.fetch;
      window.fetch = function clone3dFetch(input, init) {
        const url = readFetchUrl(input);
        const method = readFetchMethod(input, init);
        const replay = url ? findApiReplay(method, url, location.href) : undefined;
        if (replay) {
          return Promise.resolve(responseFromReplay(replay));
        }

        const inline = url ? inlineResponseFor(url, location.href) : undefined;
        if (inline) {
          return Promise.resolve(responseFromReplay(inline));
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
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function clone3dOpen(method, url) {
        this.__clone3dMethod = String(method || "GET").toUpperCase();
        this.__clone3dUrl = String(url);
        arguments[1] = resolveUrl(url, location.href);
        return originalOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function clone3dSend(body) {
        try {
          const replay = this.__clone3dUrl ? findApiReplay(this.__clone3dMethod || "GET", this.__clone3dUrl, location.href) : undefined;
          if (replay) {
            const xhr = this;
            setTimeout(function () {
              try {
                const text = replay.bodyText || "";
                Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });
                Object.defineProperty(xhr, "status", { configurable: true, value: replay.status || 200 });
                Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
                Object.defineProperty(xhr, "responseText", { configurable: true, value: text });
                let response = text;
                if (xhr.responseType === "json") {
                  try { response = JSON.parse(text); } catch {}
                }
                Object.defineProperty(xhr, "response", { configurable: true, value: response });
                if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(new Event("readystatechange"));
                xhr.dispatchEvent(new Event("readystatechange"));
                if (typeof xhr.onload === "function") xhr.onload(new Event("load"));
                xhr.dispatchEvent(new Event("load"));
                if (typeof xhr.onloadend === "function") xhr.onloadend(new Event("loadend"));
                xhr.dispatchEvent(new Event("loadend"));
              } catch {
                try { return originalSend.call(xhr, body); } catch {}
              }
            }, 0);
            return;
          }
        } catch {}
        return originalSend.call(this, body);
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
