import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(rootDir, "../..");

function copyManifestPlugin() {
  return {
    name: "clone3d-copy-manifest",
    closeBundle() {
      mkdirSync(path.resolve(rootDir, "dist"), { recursive: true });
      copyFileSync(
        path.resolve(rootDir, "manifest.json"),
        path.resolve(rootDir, "dist/manifest.json")
      );
    }
  };
}

export default defineConfig({
  root: rootDir,
  publicDir: false,
  plugins: [copyManifestPlugin()],
  resolve: {
    alias: {
      "@clone3d/shared": path.resolve(repoRoot, "packages/shared/src/index.ts"),
      "@clone3d/storage": path.resolve(repoRoot, "packages/storage/src/index.ts")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        background: path.resolve(rootDir, "src/background/index.ts"),
        content: path.resolve(rootDir, "src/content/content.ts"),
        "injected-main": path.resolve(rootDir, "src/injected/main-world-hooks.ts"),
        popup: path.resolve(rootDir, "popup.html"),
        options: path.resolve(rootDir, "options.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
