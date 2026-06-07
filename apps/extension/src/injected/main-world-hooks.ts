(() => {
  const eventType = "CLONE3D_MAIN_EVENT";
  const patchFlag = "__clone3dPhase1HooksInstalled";
  const state = window as Window & { [patchFlag]?: boolean };

  if (state[patchFlag]) {
    return;
  }

  state[patchFlag] = true;

  report({ kind: "boot" });
  patchFetch();
  patchXhrOpen();
  patchWorker();
  patchImageSrc();
  patchWebAssemblyStreaming();

  function report(event: { kind: string; url?: string; method?: string }): void {
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
      report({
        kind: "fetch",
        url: readRequestUrl(input),
        method: readRequestMethod(input, init)
      });

      return originalFetch.apply(this, [input, init]);
    };
  }

  function patchXhrOpen(): void {
    const originalOpen = XMLHttpRequest.prototype.open;
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

      return originalOpen.call(this, method, url, async ?? true, username, password);
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
})();
