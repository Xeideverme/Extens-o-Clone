import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const validator = source("packages/rewriter/src/app-html-validator.ts");
const generator = source("packages/rewriter/src/app-html-generator.ts");
const runtime = source("packages/rewriter/src/runtime-template.ts");
const assetServing = source("packages/rewriter/src/asset-serving.ts");
const assetMap = source("packages/rewriter/src/asset-map.ts");
const pipeline = source("apps/extension/src/background/pipeline-runner.ts");
const rewriteRunner = source("apps/extension/src/background/rewrite-runner.ts");

function ensureGlobalRegExp(regex) {
  if (regex.global) {
    return regex;
  }

  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  return new RegExp(regex.source, flags);
}

function safeMatchAll(input, regex) {
  return Array.from(input.matchAll(ensureGlobalRegExp(regex)));
}

assert.match(validator, /export function isTransientWorkerWithoutBlob/);
assert.match(validator, /export function ensureGlobalRegExp/);
assert.match(validator, /export function safeMatchAll/);
assert.match(validator, /safeMatchAll\(value, pattern\)/);
assert.match(validator, /asset\.assetRole === "worker"/);
assert.match(validator, /asset\.status === "skipped"/);
assert.match(validator, /asset\.source\?\.includes\("worker-hook"\)/);
assert.match(validator, /isUuidLikeUrl\(url\)/);
assert.match(validator, /!hasScriptExtension\(url\)/);
assert.match(validator, /if \(isTransientWorkerWithoutBlob\(asset\)\) \{\s*return false;/s);
assert.match(validator, /missing-asset-manifest/);
assert.match(validator, /missing-runtime-resolver/);

assert.doesNotMatch(generator, /const manifestScript = ``/);
assert.doesNotMatch(generator, /const apiReplayScript = ``/);
assert.doesNotMatch(generator, /const moduleSourcesScript = ``/);
assert.doesNotMatch(generator, /const runtimeScript = input\.runtimeResolverEnabled\s*\?\s*``/);
assert.match(generator, /__CLONE3D_ASSET_MANIFEST__/);
assert.match(generator, /__CLONE3D_API_REPLAY__/);
assert.match(generator, /__CLONE3D_MODULE_SOURCES__/);
assert.match(generator, /data-clone3d-runtime/);
assert.match(generator, /buildRuntimeResolverScript\(manifest/);
assert.match(generator, /escapeScriptForHtml/);

assert.match(runtime, /__CLONE3D_RUNTIME_INSTALLED__/);
assert.match(runtime, /__CLONE3D_MODULE_SOURCES__/);
assert.match(runtime, /__CLONE3D_MODULE_BLOB_URLS__/);
assert.match(runtime, /__clone3dResolveModuleUrl/);
assert.match(runtime, /readJsonScript\("__CLONE3D_MODULE_SOURCES__"\)/);

assert.match(assetServing, /toCatboxProxyUrl/);
assert.match(assetServing, /\/catbox\//);
assert.match(assetServing, /getAssetPublicUrl\(asset\)/);
assert.doesNotMatch(assetMap, /files\.catbox\.moe\/"\s*\+\s*filename/);
assert.doesNotMatch(assetMap, /files\.catbox\.moe\/\$\{filename\}/);

assert.match(pipeline, /markPipelineRewriteFailed/);
assert.match(pipeline, /currentStepLabel:\s*"Falha ao gerar app\.html"/);
assert.match(pipeline, /status:\s*"failed"/);
assert.match(pipeline, /rewrittenJob\?\.status === "rewrite-failed"/);

assert.match(rewriteRunner, /lastError:\s*message/);
assert.match(rewriteRunner, /validation-not-run-because-rewrite-failed/);
assert.match(rewriteRunner, /parseCriticalAssetsMissing/);

assert.doesNotThrow(() => safeMatchAll("Authorization Bearer abc Authorization", /Authorization/i));
assert.equal(safeMatchAll("Authorization Bearer abc Authorization", /Authorization/i).length, 2);
assert.deepEqual(
  safeMatchAll("a A a", /a/i).map((match) => match[0]),
  ["a", "A", "a"]
);

console.log("Regression checks passed.");
