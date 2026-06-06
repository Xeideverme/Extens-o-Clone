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

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
