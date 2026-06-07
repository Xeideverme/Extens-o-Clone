import type { ThreeDPreparationReport } from "@clone3d/shared";

export function createThreeDPreparationReport(jobId: string): ThreeDPreparationReport {
  return {
    jobId,
    startedAt: Date.now(),
    detected3dAssets: 0,
    gltfFilesAnalyzed: 0,
    gltfFilesRewritten: 0,
    derivedAssetsCreated: 0,
    derivedAssetsUploaded: 0,
    decoderAssetsDetected: 0,
    workerAssetsDetected: 0,
    wasmAssetsDetected: 0,
    textureAssetsDetected: 0,
    unresolvedGltfUris: [],
    unresolvedDecoderUrls: [],
    unresolvedWorkerUrls: [],
    warnings: [],
    errors: []
  };
}

export function finalizeThreeDPreparationReport(report: ThreeDPreparationReport): ThreeDPreparationReport {
  return {
    ...report,
    finishedAt: Date.now(),
    unresolvedGltfUris: unique(report.unresolvedGltfUris),
    unresolvedDecoderUrls: unique(report.unresolvedDecoderUrls),
    unresolvedWorkerUrls: unique(report.unresolvedWorkerUrls),
    warnings: unique(report.warnings),
    errors: unique(report.errors)
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
