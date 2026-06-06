import type { AssetDiscovery } from "@clone3d/shared";
import { addDiscovery, mergeDiscoveries } from "./asset-discovery";

export function scanPerformanceAssets(): AssetDiscovery[] {
  const discoveries: AssetDiscovery[] = [];

  for (const entry of performance.getEntriesByType("navigation")) {
    addDiscovery(discoveries, {
      rawUrl: entry.name,
      source: ["performance", "html"],
      initiatorType: "navigation",
      element: "performance",
      attribute: "name"
    });
  }

  for (const entry of performance.getEntriesByType("resource")) {
    const resource = entry as PerformanceResourceTiming;
    addDiscovery(discoveries, {
      rawUrl: resource.name,
      source: inferPerformanceSource(resource.initiatorType),
      initiatorType: resource.initiatorType,
      element: "performance",
      attribute: "name"
    });
  }

  return mergeDiscoveries(discoveries);
}

function inferPerformanceSource(initiatorType: string | undefined): AssetDiscovery["source"] {
  switch (initiatorType) {
    case "css":
    case "link":
      return ["performance", "css"];
    case "script":
      return ["performance", "script"];
    case "fetch":
      return ["performance", "fetch-hook"];
    case "xmlhttprequest":
      return ["performance", "xhr-hook"];
    default:
      return ["performance"];
  }
}
