import type { AssetDiscovery, AssetSource } from "@clone3d/shared";

export interface DiscoveryInput {
  rawUrl: string;
  source: AssetSource | AssetSource[];
  baseUrl?: string;
  element?: string;
  attribute?: string;
  initiatorType?: string;
}

const SKIPPED_PROTOCOLS = new Set(["about:", "chrome:", "chrome-extension:", "javascript:", "mailto:"]);

export function createAssetDiscovery(input: DiscoveryInput): AssetDiscovery | undefined {
  const rawUrl = input.rawUrl.trim();
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl, input.baseUrl ?? document.baseURI);
    if (SKIPPED_PROTOCOLS.has(url.protocol)) {
      return undefined;
    }

    url.hash = "";

    return {
      rawUrl,
      normalizedUrl: url.href,
      source: Array.isArray(input.source) ? input.source : [input.source],
      referrerUrl: document.referrer || undefined,
      frameUrl: location.href,
      element: input.element,
      attribute: input.attribute,
      initiatorType: input.initiatorType,
      discoveredAt: Date.now()
    };
  } catch {
    return undefined;
  }
}

export function addDiscovery(target: AssetDiscovery[], input: DiscoveryInput): void {
  const discovery = createAssetDiscovery(input);
  if (discovery) {
    target.push(discovery);
  }
}

export function mergeDiscoveries(discoveries: AssetDiscovery[]): AssetDiscovery[] {
  const byUrl = new Map<string, AssetDiscovery>();

  for (const discovery of discoveries) {
    const existing = byUrl.get(discovery.normalizedUrl);
    if (!existing) {
      byUrl.set(discovery.normalizedUrl, {
        ...discovery,
        source: [...new Set(discovery.source)]
      });
      continue;
    }

    existing.source = [...new Set([...existing.source, ...discovery.source])];
    existing.element ??= discovery.element;
    existing.attribute ??= discovery.attribute;
    existing.initiatorType ??= discovery.initiatorType;
  }

  return [...byUrl.values()].sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl));
}
