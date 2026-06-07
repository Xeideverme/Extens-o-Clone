import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(rootDir, "../..");
const distDir = path.resolve(rootDir, "dist");

const common = {
  configFile: false,
  root: rootDir,
  publicDir: false,
  resolve: {
    alias: {
      "@clone3d/shared": path.resolve(repoRoot, "packages/shared/src/index.ts"),
      "@clone3d/storage": path.resolve(repoRoot, "packages/storage/src/index.ts"),
      "@clone3d/rewriter": path.resolve(repoRoot, "packages/rewriter/src/index.ts")
    }
  }
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
copyFileSync(path.resolve(rootDir, "manifest.json"), path.resolve(distDir, "manifest.json"));

await build({
  ...common,
  build: {
    outDir: distDir,
    emptyOutDir: false,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        popup: path.resolve(rootDir, "popup.html"),
        options: path.resolve(rootDir, "options.html")
      },
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});

await buildEntry({
  entry: "src/background/index.ts",
  fileName: "background.js",
  format: "es"
});

await buildEntry({
  entry: "src/content/content.ts",
  fileName: "content.js",
  format: "iife",
  name: "Clone3DContent"
});

await buildEntry({
  entry: "src/injected/main-world-hooks.ts",
  fileName: "injected-main.js",
  format: "iife",
  name: "Clone3DInjected"
});

async function buildEntry({ entry, fileName, format, name }) {
  await build({
    ...common,
    build: {
      outDir: distDir,
      emptyOutDir: false,
      sourcemap: true,
      target: "es2022",
      minify: true,
      rollupOptions: {
        input: path.resolve(rootDir, entry),
        output: {
          format,
          name,
          entryFileNames: fileName,
          inlineDynamicImports: true
        }
      }
    }
  });
}
