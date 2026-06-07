(() => {
  const eventType = "CLONE3D_MAIN_EVENT";
  const settingsEventType = "CLONE3D_API_REPLAY_SETTINGS";
  const patchFlag = "__clone3dPhase1HooksInstalled";
  const state = window as Window & { [patchFlag]?: boolean };
  const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string; hasAuthorizationHeader: boolean }>();
  let apiReplaySettings = {
    apiReplayEnabled: true,
    apiReplayMaxBodyKb: 2048,
    apiReplayCaptureSameOriginOnly: false,
    apiReplayAllowTextPlain: true
  };

  if (state[patchFlag]) {
    return;
  }

  state[patchFlag] = true;

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data as { type?: string; payload?: Partial<typeof apiReplaySettings> } | null;
    if (data?.type !== settingsEventType || !data.payload) {
      return;
    }

    apiReplaySettings = {
      ...apiReplaySettings,
      ...data.payload
    };
  });

  report({ kind: "boot" });
  patchFetch();
  patchXhrOpen();
  patchWorker();
  patchImageSrc();
  patchWebAssemblyStreaming();

  function report(event: Record<string, unknown> & { kind: string; url?: string; method?: string }): void {
    window.postMessage(
      {
        type: eventType,
        payload: {
          ...event,
          pageUrl: location.href,
          createdAt: Date.now()
        }
      },
      "*"
    );
  }

  function patchFetch(): void {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") {
      return;
    }

    window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = readRequestUrl(input);
      const method = readRequestMethod(input, init);
      report({
        kind: "fetch",
        url,
        method
      });

      const result = originalFetch.apply(this, [input, init]);
      void result
        .then((response) => captureFetchResponse(input, init, response, url, method))
        .catch(() => undefined);
      return result;
    };
  }

  function patchXhrOpen(): void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      report({
        kind: "xhr-open",
        url: String(url),
        method
      });

      xhrMeta.set(this, {
        method: String(method || "GET").toUpperCase(),
        url: String(url),
        hasAuthorizationHeader: false
      });

      return originalOpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name: string, value: string) {
      const meta = xhrMeta.get(this);
      if (meta && String(name).toLowerCase() === "authorization") {
        meta.hasAuthorizationHeader = true;
      }

      return originalSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function patchedSend(body?: Document | XMLHttpRequestBodyInit | null) {
      this.addEventListener(
        "loadend",
        () => {
          captureXhrResponse(this);
        },
        { once: true }
      );

      return originalSend.call(this, body);
    };
  }

  function patchWorker(): void {
    const OriginalWorker = window.Worker;
    if (typeof OriginalWorker !== "function") {
      return;
    }

    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args, newTarget) {
        if (args[0] !== undefined) {
          report({
            kind: "worker",
            url: String(args[0])
          });
        }

        return Reflect.construct(target, args, newTarget);
      }
    });
  }

  function patchImageSrc(): void {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (!descriptor?.set || !descriptor.get || descriptor.configurable === false) {
      return;
    }

    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value: string) {
        report({
          kind: "image-src",
          url: String(value)
        });

        descriptor.set?.call(this, value);
      }
    });
  }

  function patchWebAssemblyStreaming(): void {
    const webAssembly = window.WebAssembly;
    if (!webAssembly) {
      return;
    }

    patchStreamingFunction(webAssembly, "instantiateStreaming");
    patchStreamingFunction(webAssembly, "compileStreaming");
  }

  function patchStreamingFunction(target: typeof WebAssembly, key: "instantiateStreaming" | "compileStreaming"): void {
    const original = target[key];
    if (typeof original !== "function") {
      return;
    }

    Object.defineProperty(target, key, {
      configurable: true,
      value(input: Response | PromiseLike<Response>, ...rest: unknown[]) {
        void Promise.resolve(input)
          .then((response) => {
            if (response?.url) {
              report({
                kind: "wasm-streaming",
                url: response.url
              });
            }
          })
          .catch(() => undefined);

        return (original as (...args: unknown[]) => unknown).apply(this, [input, ...rest]);
      }
    });
  }

  function readRequestUrl(input: RequestInfo | URL): string | undefined {
    if (typeof input === "string") {
      return input;
    }

    if (input instanceof URL) {
      return input.href;
    }

    return input.url;
  }

  function readRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) {
      return init.method;
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      return input.method;
    }

    return "GET";
  }

  function captureFetchResponse(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    response: Response,
    url: string | undefined,
    method: string
  ): void {
    try {
      const finalUrl = url || response.url;
      const hasAuthorizationHeader = requestHasAuthorization(input, init);
      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || "0") || undefined;
      const decision = shouldCaptureApiResponse(method, finalUrl, response.status, contentType, contentLength, hasAuthorizationHeader);
      if (!decision.ok) {
        reportApiSkip("fetch", method, finalUrl, contentType, contentLength, decision.reason);
        return;
      }

      void response
        .clone()
        .text()
        .then((bodyText) => {
          const size = new TextEncoder().encode(bodyText).byteLength;
          const finalDecision = shouldCaptureApiResponse(method, finalUrl, response.status, contentType, size, hasAuthorizationHeader);
          if (!finalDecision.ok) {
            reportApiSkip("fetch", method, finalUrl, contentType, size, finalDecision.reason);
            return;
          }

          reportApiResponse("fetch", method, finalUrl, response.status, contentType, bodyText, size);
        })
        .catch(() => {
          reportApiSkip("fetch", method, finalUrl, contentType, contentLength, "read-error");
        });
    } catch {
      // The page's fetch result must never be affected by capture.
    }
  }

  function captureXhrResponse(xhr: XMLHttpRequest): void {
    try {
      const meta = xhrMeta.get(xhr);
      if (!meta) {
        return;
      }

      if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "json") {
        reportApiSkip("xhr", meta.method, meta.url, "", undefined, "unsupported-response-type");
        return;
      }

      const contentType = xhr.getResponseHeader("content-type") || "";
      const contentLength = Number(xhr.getResponseHeader("content-length") || "0") || undefined;
      const decision = shouldCaptureApiResponse(meta.method, meta.url, xhr.status, contentType, contentLength, meta.hasAuthorizationHeader);
      if (!decision.ok) {
        reportApiSkip("xhr", meta.method, meta.url, contentType, contentLength, decision.reason);
        return;
      }

      let bodyText = "";
      if (xhr.responseType === "json" && xhr.response !== undefined) {
        bodyText = JSON.stringify(xhr.response);
      } else {
        bodyText = xhr.responseText;
      }

      const size = new TextEncoder().encode(bodyText).byteLength;
      const finalDecision = shouldCaptureApiResponse(meta.method, meta.url, xhr.status, contentType, size, meta.hasAuthorizationHeader);
      if (!finalDecision.ok) {
        reportApiSkip("xhr", meta.method, meta.url, contentType, size, finalDecision.reason);
        return;
      }

      reportApiResponse("xhr", meta.method, meta.url, xhr.status, contentType, bodyText, size);
    } catch {
      // Ignore inaccessible responseText or browser-specific XHR failures.
    }
  }

  function shouldCaptureApiResponse(
    method: string,
    url: string | undefined,
    status: number,
    contentType: string,
    size: number | undefined,
    hasAuthorizationHeader: boolean
  ): { ok: true } | { ok: false; reason: string } {
    if (!apiReplaySettings.apiReplayEnabled) {
      return { ok: false, reason: "disabled" };
    }

    if (String(method || "GET").toUpperCase() !== "GET") {
      return { ok: false, reason: "unsupported-method" };
    }

    if (!url || isSensitiveUrl(url)) {
      return { ok: false, reason: "sensitive-url" };
    }

    if (hasAuthorizationHeader) {
      return { ok: false, reason: "authorization-header" };
    }

    if (status < 200 || status > 299) {
      return { ok: false, reason: "non-success-status" };
    }

    if (!isReplayableContentType(contentType)) {
      return { ok: false, reason: "unsupported-content-type" };
    }

    if (size !== undefined && size > apiReplaySettings.apiReplayMaxBodyKb * 1024) {
      return { ok: false, reason: "too-large" };
    }

    if (apiReplaySettings.apiReplayCaptureSameOriginOnly) {
      try {
        if (new URL(url, location.href).origin !== location.origin) {
          return { ok: false, reason: "cross-origin" };
        }
      } catch {
        return { ok: false, reason: "sensitive-url" };
      }
    }

    return { ok: true };
  }

  function reportApiResponse(
    transport: "fetch" | "xhr",
    method: string,
    url: string,
    status: number,
    contentType: string,
    bodyText: string,
    size: number
  ): void {
    let normalizedUrl = url;
    try {
      normalizedUrl = new URL(url, location.href).href;
    } catch {
      // Keep raw URL.
    }

    report({
      kind: "api-response",
      transport,
      method: "GET",
      url,
      normalizedUrl,
      frameUrl: location.href,
      status,
      contentType,
      bodyText,
      size,
      capturedAt: Date.now()
    });
  }

  function reportApiSkip(
    transport: "fetch" | "xhr",
    method: string,
    url: string | undefined,
    contentType: string,
    size: number | undefined,
    skippedReason: string
  ): void {
    report({
      kind: "api-response-skipped",
      transport,
      method,
      url,
      frameUrl: location.href,
      contentType,
      size,
      skippedReason,
      capturedAt: Date.now()
    });
  }

  function requestHasAuthorization(input: RequestInfo | URL, init?: RequestInit): boolean {
    try {
      if (headersHaveAuthorization(init?.headers)) {
        return true;
      }

      if (typeof Request !== "undefined" && input instanceof Request) {
        return input.headers.has("authorization");
      }
    } catch {
      return true;
    }

    return false;
  }

  function headersHaveAuthorization(headers: HeadersInit | undefined): boolean {
    if (!headers) {
      return false;
    }

    if (headers instanceof Headers) {
      return headers.has("authorization");
    }

    if (Array.isArray(headers)) {
      return headers.some(([name]) => String(name).toLowerCase() === "authorization");
    }

    return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
  }

  function isReplayableContentType(contentType: string): boolean {
    const normalized = contentType.toLowerCase().split(";")[0]?.trim() || "";
    return (
      normalized === "application/json" ||
      normalized === "text/json" ||
      normalized === "application/manifest+json" ||
      normalized === "application/vnd.api+json" ||
      normalized === "model/gltf+json" ||
      normalized.endsWith("+json") ||
      (apiReplaySettings.apiReplayAllowTextPlain && normalized === "text/plain")
    );
  }

  function isSensitiveUrl(value: string): boolean {
    try {
      const url = new URL(value, location.href);
      return /(?:login|logout|auth|oauth|token|session|csrf|password|passwd|account|user|me|profile|billing|checkout|payment|cart|order|admin|private|secret)/i.test(
        `${url.pathname}${url.search}`
      );
    } catch {
      return true;
    }
  }
})();
