import type { RewriteReport } from "@clone3d/shared";

export function createRewriteReport(jobId: string): RewriteReport {
  return {
    jobId,
    startedAt: Date.now(),
    htmlRewrites: 0,
    cssRewrites: 0,
    jsDirectRewrites: 0,
    jsonInlined: 0,
    assetsInManifest: 0,
    unresolvedUrls: [],
    warnings: []
  };
}

export function finalizeRewriteReport(report: RewriteReport, outputFilename: string, outputSize: number): RewriteReport {
  return {
    ...report,
    finishedAt: Date.now(),
    outputFilename,
    outputSize,
    unresolvedUrls: unique(report.unresolvedUrls),
    warnings: unique(report.warnings)
  };
}

export function appendReportComment(html: string, report: RewriteReport): string {
  const safeReport = JSON.stringify(report, null, 2).replace(/-->/g, "--\\>");
  return `${html}
<!--
Clone3D Snapshot Rewrite Report
${safeReport}
-->`;
}

export function buildReportScript(report: RewriteReport): string {
  return `<script id="__CLONE3D_REWRITE_REPORT__" type="application/json">${escapeJsonForHtml(JSON.stringify(report))}</script>`;
}

export function escapeJsonForHtml(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
