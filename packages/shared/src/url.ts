export interface UrlVariants {
  raw: string;
  absolute: string;
  noHash: string;
  pathWithQuery: string;
  pathOnly: string;
  decoded: string;
  encoded: string;
  relativeFromDocument?: string;
  relativeFromScript?: string;
}

export function buildUrlVariants(raw: string, baseUrl: string): UrlVariants {
  const url = new URL(raw, baseUrl);
  const noHashUrl = new URL(url.href);
  noHashUrl.hash = "";

  return {
    raw,
    absolute: url.href,
    noHash: noHashUrl.href,
    pathWithQuery: `${url.pathname}${url.search}`,
    pathOnly: url.pathname,
    decoded: safeDecode(raw),
    encoded: encodeURI(raw)
  };
}

export interface DownloadableUrlCheck {
  downloadable: boolean;
  reason?: string;
  protocol?: string;
}

export function isDownloadableAssetUrl(value: string): DownloadableUrlCheck {
  if (!value.trim()) {
    return { downloadable: false, reason: "empty-url" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { downloadable: false, reason: "invalid-url" };
  }

  switch (url.protocol) {
    case "http:":
    case "https:":
    case "data:":
      return { downloadable: true, protocol: url.protocol };
    case "blob:":
      return { downloadable: false, reason: "blob-url-without-bytes", protocol: url.protocol };
    case "chrome-extension:":
      return { downloadable: false, reason: "chrome-extension-url", protocol: url.protocol };
    case "javascript:":
      return { downloadable: false, reason: "javascript-url", protocol: url.protocol };
    case "mailto:":
      return { downloadable: false, reason: "mailto-url", protocol: url.protocol };
    case "tel:":
      return { downloadable: false, reason: "tel-url", protocol: url.protocol };
    case "about:":
      return { downloadable: false, reason: "about-url", protocol: url.protocol };
    default:
      return { downloadable: false, reason: `unsupported-protocol:${url.protocol}`, protocol: url.protocol };
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
