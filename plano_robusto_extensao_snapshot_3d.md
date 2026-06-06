# Plano robusto — Extensão de snapshot/clonagem autorizada de páginas 3D com R2

> Documento de contexto para usar no Codex caso o contexto da conversa acabe.
>
> Objetivo: construir uma extensão Chrome Manifest V3 que capture a página atualmente aberta, descubra assets web/3D, baixe os assets acessíveis pela sessão do navegador, envie arquivos grandes para Cloudflare R2 via Cloudflare Worker, reescreva HTML/CSS/JS/API snapshots para apontar para as novas URLs públicas, e gere um `app.html` final preferencialmente autossuficiente.
>
> Escopo permitido: arquivamento, migração, backup, estudo e reprodução local de sites/conteúdos próprios ou com autorização. Não implementar bypass de DRM, paywall, login, anti-bot, criptografia ou controles anticópia.

---

## 1. Veredito técnico

A extensão não deve ser tratada como “clonador universal de qualquer site”. Ela deve ser tratada como uma ferramenta de snapshot técnico de páginas carregadas.

O alvo realista é:

- Alta confiabilidade para páginas estáticas/semiestáticas.
- Alta confiabilidade para experiências WebGL/Three.js/Babylon/model-viewer quando os assets são carregáveis pelo navegador.
- Alta confiabilidade para APIs de configuração/manifests JSON capturados durante a sessão.
- Baixa ou nenhuma garantia para backend dinâmico, login, DRM, streaming protegido, WebSocket essencial, pagamento, carrinho, dashboard, geração server-side e conteúdo não carregado durante a captura.

A arquitetura correta é:

```txt
Extensão Chrome MV3
  ├─ content script isolado: lê DOM e conversa com background
  ├─ script injetado no MAIN world: intercepta fetch/XHR/Worker/Blob/Image/Audio
  ├─ background service worker: fila persistente, download, upload, jobs
  ├─ IndexedDB: blobs, manifests, estado persistente
  ├─ Cloudflare Worker: endpoint seguro de upload
  ├─ Cloudflare R2: armazenamento público de assets grandes
  ├─ rewriter HTML/CSS/JS/API: cria clone final
  └─ gerador de app.html: saída final para download
```

---

## 2. Problemas que a extensão precisa resolver

### 2.1 CORS local

Problema: abrir `file://app.html` e o HTML tentar fazer `fetch('./dados.json')`, importar `./chunk.js`, carregar CSS local, JSON local ou assets locais pode quebrar por origem/CORS/restrições de módulos.

Solução:

- Embutir HTML, CSS, JS e JSON pequeno no próprio `app.html`.
- Evitar `fetch('./arquivo.json')`, `script type="module" src="./main.js"`, `import './modulo.js'` e assets relativos locais no resultado final.
- Para assets grandes, usar URLs públicas do R2 com CORS correto.
- Injetar runtime resolver para reescrever URLs em tempo de execução.

### 2.2 CORS remoto do R2

Mesmo com HTML único, se o arquivo final carregar `https://assets.seudominio.com/job/model.glb`, isso é cross-origin. O bucket/domínio do R2 precisa retornar headers CORS adequados.

CORS de desenvolvimento recomendado:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

Para produção, restringir origens quando possível. Como `file://` usa origem especial/null, para testes `*` é mais simples.

### 2.3 Credenciais do Cloudflare

Nunca colocar Access Key, Secret Key, API Token do Cloudflare ou chave R2 dentro da extensão.

Fluxo correto:

```txt
Extensão → Cloudflare Worker → R2
```

O Worker recebe o arquivo, valida tamanho/tipo/hash/autorização, grava no R2 e devolve a URL pública.

### 2.4 Service worker MV3 pode encerrar

Não confiar em variáveis globais do background. Tudo que importa precisa ser persistido.

Usar:

- IndexedDB para blobs e grandes registros.
- `chrome.storage.local` para settings e estado leve.
- Job queue persistente.
- Retry/resume.
- Hash por asset.
- Limite de concorrência.

### 2.5 Reescrita de JavaScript não pode ser só `replaceAll`

Reescrever JS com `replaceAll(originalUrl, publicUrl)` funciona em casos simples, mas falha em:

```js
const url = base + name + '.glb';
fetch(new URL('./config.json', import.meta.url));
import('./chunks/viewer-' + id + '.js');
loader.load(`/assets/${model}.glb`);
```

A solução é combinar:

1. Substituição direta por asset map.
2. Parser AST para JS.
3. Rewriter CSS/HTML.
4. Runtime resolver com patches de APIs.
5. Captura real de rede/fetch/XHR durante execução original.

---

## 3. Modos de captura

### Modo 1 — Snapshot básico

Captura:

- DOM final.
- HTML renderizado.
- CSS externo/inline.
- Imagens em `src`, `srcset`, CSS `url()`.
- Scripts carregados.

Saída:

- `app.html` com CSS/JS inline quando possível.

### Modo 2 — Snapshot com rede

Inclui Modo 1 + observação de:

- `chrome.webRequest` para URLs requisitadas.
- `performance.getEntriesByType('resource')`.
- Hooks de `fetch` e `XMLHttpRequest` no MAIN world.

### Modo 3 — Snapshot 3D

Inclui Modo 2 + suporte especial a:

- `.glb`
- `.gltf`
- `.bin`
- `.drc`
- `.ktx2`
- `.basis`
- `.wasm`
- `.hdr`
- `.exr`
- `.png`
- `.jpg`
- `.webp`
- `.avif`
- `.ogg`
- `.mp3`
- `.mp4`
- `draco_decoder.wasm`
- `draco_wasm_wrapper.js`
- `basis_transcoder.wasm`
- `basis_transcoder.js`
- `meshopt_decoder.module.js`

### Modo 4 — API replay

Captura respostas seguras de APIs, principalmente:

- `GET` JSON.
- `GET` text/plain.
- manifests/configs.
- respostas de listas de assets.

No clone final, `fetch('/api/config')` retorna um `Response` local baseado no snapshot.

### Modo 5 — Deep capture opcional

Modo avançado e não padrão.

Usa `chrome.debugger`/CDP para capturar rede com mais profundidade. Deve ser opcional porque a permissão é sensível, invasiva e pode assustar o usuário.

---

## 4. Componentes do projeto

### 4.1 Estrutura recomendada do monorepo

```txt
/clone3d-extension
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json

  /apps
    /extension
      manifest.json
      vite.config.ts
      /src
        /background
          index.ts
          job-runner.ts
          message-router.ts
          downloader.ts
          uploader-client.ts
          queue.ts
          settings.ts
        /content
          content.ts
          dom-scanner.ts
          bridge.ts
        /injected
          main-world-hooks.ts
          runtime-capture.ts
        /popup
          popup.html
          popup.tsx
          App.tsx
        /options
          options.html
          options.tsx
        /offscreen
          offscreen.html
          offscreen.ts
        /assets
          icon.png

    /worker
      wrangler.toml
      package.json
      /src
        index.ts
        auth.ts
        mime.ts
        upload.ts
        cors.ts
        rate-limit.ts

  /packages
    /shared
      src/types.ts
      src/mime.ts
      src/url.ts
      src/hash.ts
      src/constants.ts

    /rewriter
      src/html-rewriter.ts
      src/css-rewriter.ts
      src/js-rewriter.ts
      src/gltf-rewriter.ts
      src/runtime-template.ts
      src/build-app-html.ts

    /storage
      src/idb.ts
      src/job-store.ts
      src/blob-store.ts

    /test-fixtures
      /static-fetch-json
      /three-glb
      /gltf-external-bin-textures
      /draco-ktx2
      /worker-wasm
      /api-config
      /blob-url
```

### 4.2 Stack recomendada

- TypeScript em todo o projeto.
- Vite/esbuild para build da extensão.
- React opcional no popup/options, mas manter UI simples.
- IndexedDB com wrapper pequeno ou Dexie.
- `parse5` para HTML.
- `postcss` para CSS.
- `@babel/parser`, `@babel/traverse`, `@babel/generator` ou `acorn` + `magic-string` para JS.
- Cloudflare Worker em TypeScript.
- Playwright/Puppeteer para testes E2E com extensão carregada.

---

## 5. Manifest V3

Manifest inicial para desenvolvimento:

```json
{
  "manifest_version": 3,
  "name": "Clone3D Snapshot",
  "version": "0.1.0",
  "description": "Authorized page snapshot tool for 3D/web assets.",
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": [
    "storage",
    "downloads",
    "scripting",
    "activeTab",
    "webRequest",
    "alarms",
    "unlimitedStorage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start",
      "all_frames": true,
      "match_about_blank": true
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["injected-main.js"],
      "matches": ["<all_urls>"]
    }
  ],
  "options_page": "options.html"
}
```

Notas:

- Para publicação, considerar `optional_host_permissions` e solicitar permissão por site em vez de `<all_urls>`.
- Não adicionar `debugger` no MVP. Deixar para modo profundo opcional.
- Não usar `webRequestBlocking` no MVP.

---

## 6. Fluxo principal do usuário

1. Usuário abre a página alvo.
2. Extensão injeta hooks no `document_start`.
3. Usuário interage com a página até carregar os modelos/assets desejados.
4. Usuário abre popup e clica em “Iniciar captura”.
5. Extensão coleta:
   - DOM atual.
   - recursos vistos pelo DOM scanner.
   - recursos vistos por `performance`.
   - recursos vistos por hooks fetch/XHR/Worker/Blob/Image/Audio.
   - recursos vistos por `webRequest`.
6. Background deduplica e normaliza os assets.
7. Background baixa assets acessíveis.
8. Background calcula hash e MIME.
9. Background envia arquivos grandes para Cloudflare Worker.
10. Worker salva no R2.
11. Worker retorna URL pública.
12. Extensão cria `AssetManifest`.
13. Rewriter modifica HTML/CSS/JS/GLTF/API snapshots.
14. Extensão gera `app.html`.
15. Extensão baixa o `app.html` via `chrome.downloads.download`.
16. Usuário abre `app.html` localmente.
17. Runtime resolver no `app.html` redireciona qualquer URL residual para R2/API snapshot.

---

## 7. Modelo de dados

### 7.1 JobRecord

```ts
export type JobStatus =
  | 'created'
  | 'capturing'
  | 'discovering-assets'
  | 'downloading'
  | 'uploading'
  | 'rewriting'
  | 'generating-output'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobRecord {
  id: string;
  tabId: number;
  frameIds: number[];
  pageUrl: string;
  pageTitle?: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  mode: 'basic' | 'network' | '3d' | 'api-replay' | 'deep';
  stats: JobStats;
  errors: JobError[];
  output?: OutputRecord;
}
```

### 7.2 AssetRecord

```ts
export type AssetSource =
  | 'dom'
  | 'css'
  | 'html'
  | 'script'
  | 'performance'
  | 'webRequest'
  | 'fetch-hook'
  | 'xhr-hook'
  | 'worker-hook'
  | 'blob-hook'
  | 'api-snapshot'
  | 'gltf-dependency'
  | 'manual';

export type AssetStatus =
  | 'discovered'
  | 'queued'
  | 'downloading'
  | 'downloaded'
  | 'hashing'
  | 'uploading'
  | 'uploaded'
  | 'inlined'
  | 'rewritten'
  | 'skipped'
  | 'failed';

export interface AssetRecord {
  id: string;
  jobId: string;
  originalUrl: string;
  normalizedUrl: string;
  finalUrl?: string;
  publicUrl?: string;
  objectKey?: string;
  referrerUrl?: string;
  frameUrl?: string;
  source: AssetSource[];
  status: AssetStatus;
  contentType?: string;
  detectedExtension?: string;
  size?: number;
  sha256?: string;
  etag?: string;
  shouldInline: boolean;
  is3dAsset: boolean;
  isApiResponse: boolean;
  isGeneratedBlob: boolean;
  localBlobId?: string;
  error?: string;
  discoveredAt: number;
  updatedAt: number;
}
```

### 7.3 ApiSnapshotRecord

```ts
export interface ApiSnapshotRecord {
  id: string;
  jobId: string;
  url: string;
  normalizedUrl: string;
  method: 'GET' | 'HEAD';
  status: number;
  contentType: string;
  bodyText?: string;
  bodyBlobId?: string;
  headers: Record<string, string>;
  capturedAt: number;
  replayable: boolean;
}
```

### 7.4 RewriteReport

```ts
export interface RewriteReport {
  jobId: string;
  htmlRewrites: number;
  cssRewrites: number;
  jsDirectRewrites: number;
  jsAstRewrites: number;
  gltfRewrites: number;
  apiReplays: number;
  unresolvedUrls: string[];
  warnings: string[];
  createdAt: number;
}
```

---

## 8. Descoberta de assets

### 8.1 Normalização de URL

Toda URL descoberta deve gerar múltiplas chaves de busca:

```ts
interface UrlVariants {
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
```

Regras:

- Resolver URLs relativas contra a URL do documento/frame/script.
- Preservar query string quando fizer parte do asset.
- Remover hash para download, mas manter mapeamento com hash para rewrite.
- Normalizar barras duplicadas sem destruir `https://`.
- Decodificar `%2F`, `%20` somente para variante, não para substituir a URL original.

### 8.2 DOM scanner

Capturar atributos:

```txt
src
href
poster
srcset
data-src
data-href
data-model
data-model-src
ar-src
ios-src
```

Elementos:

```txt
img
picture/source
video/source
audio/source
script
link rel=stylesheet/preload/modulepreload/icon
model-viewer
iframe
object
embed
track
```

Capturar CSS inline:

```txt
style="background-image: url(...)"
<style>...</style>
```

Capturar possíveis dados em scripts JSON:

```txt
<script type="application/json">
<script type="application/ld+json">
<script id="__NEXT_DATA__">
```

### 8.3 CSS scanner

Encontrar:

```css
url(...)
@import "...";
/*# sourceMappingURL=... */
```

Para cada CSS externo, baixar conteúdo e escanear URLs relativas à URL do CSS, não à URL do documento.

### 8.4 JS/static scanner

Detectar extensões em strings:

```txt
.glb .gltf .bin .drc .ktx2 .basis .wasm .hdr .exr
.png .jpg .jpeg .webp .avif .svg .gif
.ogg .mp3 .wav .mp4 .webm
.json .js .mjs .css
```

Casos de JS a reescrever:

```js
fetch('./config.json')
new URL('./model.glb', import.meta.url)
loader.load('/assets/model.glb')
import('./chunks/viewer.js')
```

### 8.5 Performance scanner

Após a página carregar e em intervalos durante captura:

```js
performance.getEntriesByType('resource')
```

Coletar `entry.name`, `initiatorType`, `duration`, `transferSize` quando disponível.

### 8.6 webRequest observer

Usar `chrome.webRequest` para observar URLs de recursos carregados pela aba/frame.

Não depender disso para corpo da resposta. Usar para descoberta e metadados de rede.

### 8.7 MAIN world hooks

Injetar no `document_start`, no mundo MAIN, antes dos scripts da página quando possível.

Interceptar:

- `window.fetch`
- `XMLHttpRequest.prototype.open/send`
- `Request` constructor
- `URL.createObjectURL`
- `Worker`
- `SharedWorker`
- setters de `HTMLImageElement.prototype.src`
- setters de `HTMLMediaElement.prototype.src`
- setters de `HTMLSourceElement.prototype.src`
- `Element.prototype.setAttribute` para `src`, `href`, `poster`
- opcional: `WebAssembly.instantiateStreaming`

Comunicação:

```txt
MAIN injected script → window.postMessage → content script isolado → chrome.runtime.sendMessage → background
```

Nunca expor APIs perigosas da extensão diretamente para a página.

---

## 9. Download de assets

### 9.1 Estratégia principal

Background baixa os assets com `fetch`, usando `host_permissions`.

Pseudo:

```ts
async function downloadAsset(asset: AssetRecord): Promise<Blob> {
  const res = await fetch(asset.normalizedUrl, {
    method: 'GET',
    credentials: 'include',
    cache: 'force-cache'
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}
```

### 9.2 Fallbacks

Se background falhar:

1. Verificar se hook fetch/XHR capturou body legível.
2. Verificar cache interno/IndexedDB.
3. Tentar URL alternativa sem hash.
4. Tentar URL com referrer/contexto salvo, sem tentar burlar proteção.
5. Marcar como falha com motivo claro.

Não implementar bypass de autenticação, DRM, anti-bot ou criptografia.

### 9.3 Deduplicação

Calcular SHA-256 dos bytes.

Chave R2 sugerida:

```txt
jobs/{jobId}/assets/{sha256[0..1]}/{sha256}{ext}
```

Se dois assets tiverem mesmo hash, reaproveitar a mesma URL pública.

### 9.4 Inlining vs R2

Critério recomendado:

```txt
<= 50 KB: inline como data URI ou script JSON embutido
> 50 KB: upload para R2
```

Configurar esse limite em Options.

Não embutir `.glb`, `.ktx2`, `.wasm`, `.mp4` grandes em base64, exceto teste pequeno.

---

## 10. Cloudflare Worker + R2

### 10.1 Endpoints mínimos

```txt
GET  /health
POST /v1/assets
```

`POST /v1/assets` recebe arquivo binário.

Headers:

```txt
Authorization: Bearer <user-configured-token>
X-Job-Id: <job-id>
X-Original-Url: <url-encoded-original-url>
X-Content-Sha256: <sha256>
Content-Type: <mime>
```

Resposta:

```json
{
  "ok": true,
  "assetId": "...",
  "key": "jobs/job123/assets/ab/abcdef.glb",
  "publicUrl": "https://assets.seudominio.com/jobs/job123/assets/ab/abcdef.glb",
  "contentType": "model/gltf-binary",
  "size": 123456,
  "sha256": "abcdef...",
  "etag": "..."
}
```

### 10.2 Segurança mínima do Worker

- Não aceitar upload sem `Authorization`.
- Token configurado como secret no Worker, não no código.
- Validar tamanho máximo por arquivo.
- Validar MIME/extensão permitida.
- Rate limit por token/IP quando possível.
- Sanitizar nomes.
- Nunca permitir path traversal.
- Nunca aceitar `objectKey` arbitrário do cliente sem sanitização.
- Registrar logs mínimos.

### 10.3 MIME map obrigatório

```ts
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.drc': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.basis': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.hdr': 'application/octet-stream',
  '.exr': 'image/aces',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};
```

### 10.4 R2 público

Preferir domínio próprio:

```txt
https://assets.seudominio.com/...
```

Usar `r2.dev` somente para desenvolvimento.

---

## 11. Rewriter

### 11.1 Perfis de saída

#### Perfil A — Single HTML estrito

- HTML final único.
- CSS inline.
- JS inline/bundled.
- JSON/API snapshots inline.
- Assets grandes em R2.

Melhor para abrir com duplo clique.

#### Perfil B — Híbrido robusto

- HTML final único.
- CSS inline.
- Runtime resolver inline.
- Alguns JS chunks vão para R2 caso bundling falhe.
- Assets grandes em R2.

Mais robusto para sites com module graph difícil.

#### Perfil C — ZIP/local server opcional

- Futuro.
- Gerar ZIP com app e assets locais.
- Incluir servidor local simples.

Não é prioridade.

### 11.2 HTML rewriter

- Parsear HTML com `parse5`.
- Remover scripts indesejados de analytics/telemetria se o usuário habilitar essa opção.
- Reescrever `src`, `href`, `poster`, `srcset`.
- Embutir CSS externo como `<style>`.
- Embutir scripts quando possível.
- Injetar runtime resolver antes de qualquer script da aplicação.
- Preservar metatags importantes.
- Remover ou neutralizar `<base href>` que quebre resolução local.

### 11.3 CSS rewriter

- Parsear CSS com `postcss`.
- Reescrever `url(...)` e `@import`.
- Resolver relativo à URL original do CSS.
- Inline CSS pequeno.
- Assets grandes referenciam R2.

### 11.4 JS rewriter

Fases:

1. Substituição direta por `AssetManifest`.
2. AST parser.
3. Reescrita de chamadas conhecidas.
4. Runtime fallback.

Casos AST:

```js
fetch('...')
XMLHttpRequest.open('GET', '...')
new URL('...', import.meta.url)
import('...')
loader.load('...')
setPath('...')
setDecoderPath('...')
setTranscoderPath('...')
```

Transformações possíveis:

```js
fetch('./config.json')
```

para:

```js
fetch(window.__cloneResolveUrl('./config.json'))
```

E:

```js
new URL('./model.glb', import.meta.url).href
```

para:

```js
window.__cloneResolveUrl('./model.glb')
```

### 11.5 GLTF rewriter

Para `.gltf` JSON:

- Parsear JSON.
- Encontrar `buffers[].uri`.
- Encontrar `images[].uri`.
- Encontrar extensões com URIs externas.
- Resolver relativas à URL do `.gltf`.
- Subir dependências.
- Reescrever para URLs públicas.
- Upload do `.gltf` reescrito.

Para `.glb`:

- V1: tratar como binário e subir sem alterar.
- V2: opcionalmente parsear chunks para detectar URIs externas, se necessário.

### 11.6 API replay

Criar objeto no HTML:

```js
window.__CLONE_API_RESPONSES__ = {
  "https://site.com/api/config": {
    "status": 200,
    "contentType": "application/json",
    "body": { "model": "https://assets.seudominio.com/model.glb" }
  }
};
```

Patch de fetch:

```js
const originalFetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
  const url = window.__cloneNormalizeInputUrl(input);
  const mapped = window.__CLONE_API_RESPONSES__[url];

  if (mapped && (!init || !init.method || init.method === 'GET')) {
    const body = typeof mapped.body === 'string'
      ? mapped.body
      : JSON.stringify(mapped.body);

    return new Response(body, {
      status: mapped.status || 200,
      headers: { 'Content-Type': mapped.contentType || 'application/json' }
    });
  }

  return originalFetch(input, init);
};
```

---

## 12. Runtime resolver do app.html

O `app.html` precisa começar com um runtime antes do código original.

Funções principais:

```js
window.__CLONE_ASSET_MAP__ = {...};
window.__CLONE_API_RESPONSES__ = {...};

window.__cloneResolveUrl = function(input, base) {
  try {
    const raw = String(input);
    const abs = new URL(raw, base || location.href).href;
    return window.__CLONE_ASSET_MAP__[raw]
      || window.__CLONE_ASSET_MAP__[abs]
      || window.__CLONE_ASSET_MAP__[abs.split('#')[0]]
      || input;
  } catch {
    return input;
  }
};
```

Patches mínimos:

- `fetch`
- `Request`
- `XMLHttpRequest.open`
- `Worker`
- `SharedWorker`
- `Image.src`
- `HTMLImageElement.src`
- `HTMLMediaElement.src`
- `HTMLSourceElement.src`
- `Element.setAttribute('src'|'href'|'poster')`

O runtime precisa ser defensivo: não quebrar a aplicação se algum patch falhar.

---

## 13. Popup/UI

### 13.1 Estados principais

- Configuração ausente.
- Pronto para capturar.
- Capturando.
- Baixando assets.
- Enviando para R2.
- Reescrevendo.
- Concluído.
- Falhou parcialmente.
- Falhou completamente.

### 13.2 Ações

- Iniciar captura.
- Pausar.
- Retomar.
- Cancelar.
- Gerar HTML.
- Baixar HTML.
- Exportar manifest JSON.
- Ver erros.
- Testar conexão com Worker.

### 13.3 Dados visíveis

- Total de assets descobertos.
- Total baixado.
- Total enviado.
- Total falhou.
- Tamanho total.
- Quantidade de modelos 3D.
- Número de APIs capturadas.
- Lista de domínios encontrados.
- Log resumido.

---

## 14. Options page

Campos:

```txt
Cloudflare Worker upload endpoint
Bearer token pessoal do Worker
Public assets base URL
Inline threshold KB
Capture mode padrão
Concurrency de downloads
Concurrency de uploads
Max asset size MB
Habilitar API replay
Habilitar blob capture
Habilitar deep capture opcional
```

Botões:

```txt
Testar conexão
Limpar banco local
Exportar settings
Importar settings
```

---

## 15. Fila persistente

### 15.1 Estados

```txt
discovered → queued → downloading → downloaded → hashing → uploading → uploaded → rewritten
```

Estados de erro:

```txt
failed-download
failed-upload
failed-rewrite
skipped
```

### 15.2 Regras

- Nunca perder job se service worker encerrar.
- Ao iniciar popup/background, procurar jobs incompletos e oferecer retomada.
- Salvar progresso a cada mudança relevante.
- Usar locks leves para evitar duas instâncias processando o mesmo asset.
- Concorrência padrão: 4 downloads, 2 uploads.
- Retry com backoff exponencial para falhas temporárias.
- Não repetir upload se SHA-256 já existe no job.

---

## 16. Testes

### 16.1 Fixtures obrigatórias

Criar páginas locais de teste:

1. `static-fetch-json`
   - HTML + CSS + JS + `fetch('./dados.json')`.
   - Esperado: app.html abre via file sem erro.

2. `three-glb`
   - Three.js carrega `.glb` simples.
   - Esperado: modelo carrega do R2.

3. `gltf-external-bin-textures`
   - `.gltf` com `.bin` e texturas externas.
   - Esperado: `.gltf` reescrito aponta para R2.

4. `draco-ktx2`
   - GLTF/GLB com Draco/KTX2 e decoders WASM.
   - Esperado: todos decoders e texturas capturados.

5. `worker-wasm`
   - Worker carrega WASM.
   - Esperado: worker/WASM reescritos.

6. `api-config`
   - JS chama API JSON que aponta para asset.
   - Esperado: API replay funciona.

7. `blob-url`
   - Página cria Blob URL.
   - Esperado: blob capturado e substituído.

8. `iframe-basic`
   - Asset dentro de iframe.
   - Esperado: frame capturado quando permitido.

### 16.2 E2E

Usar Playwright/Puppeteer com extensão carregada.

Verificar:

- Sem erros de CORS no console.
- Sem `net::ERR_FILE_NOT_FOUND`.
- Sem requests `file://...json`/`file://...js` indesejados.
- Assets grandes carregando de R2/mock server.
- HTML final gerado.
- Manifest final contém todos os assets esperados.

### 16.3 Mock do R2

Para testes locais, criar mock Worker/HTTP server que simula:

```txt
POST /v1/assets → salva em pasta local → retorna publicUrl local
```

Isso evita depender de Cloudflare nos testes automatizados.

---

## 17. Roadmap de implementação

### Fase 0 — Setup

- Criar monorepo.
- Configurar TypeScript.
- Configurar build da extensão.
- Criar manifest MV3.
- Criar popup simples.
- Criar options simples.
- Criar Worker mínimo `/health`.

Entregável: extensão instala e popup abre.

### Fase 1 — Captura básica

- Content script no `document_start`.
- DOM scanner.
- Performance scanner.
- Envio de eventos ao background.
- JobStore persistente.

Entregável: lista de assets da página atual aparece no popup.

### Fase 2 — Download + armazenamento local

- Background downloader.
- IndexedDB blob store.
- Hash SHA-256.
- MIME detector.
- Deduplicação.
- Retry.

Entregável: assets descobertos são baixados e armazenados localmente.

### Fase 3 — Worker/R2

- Cloudflare Worker `/v1/assets`.
- Auth simples por Bearer token.
- R2 binding.
- MIME metadata.
- Public URL.
- Test connection.

Entregável: arquivo enviado pela extensão aparece no R2 e carrega publicamente.

### Fase 4 — HTML/CSS rewriter

- Capturar DOM atual.
- Baixar/inline CSS.
- Reescrever imagens/CSS URLs para R2/data URI.
- Gerar app.html.

Entregável: página estática abre via file.

### Fase 5 — MAIN world hooks

- Injetar `injected-main.js`.
- Hook fetch/XHR/Worker/Blob/Image/Audio.
- Bridge via postMessage.
- API snapshot básico.

Entregável: URLs dinâmicas aparecem no manifest.

### Fase 6 — JS rewriter + runtime resolver

- Asset map.
- Runtime resolver.
- JS direct rewrite.
- AST rewrite básico.
- Patches no app.html.

Entregável: páginas com `fetch('./dados.json')`, `new URL`, loaders simples funcionam.

### Fase 7 — 3D support

- Extensões 3D.
- GLTF rewriter.
- Decoders Draco/KTX2/Meshopt.
- Model-viewer attributes.
- Worker/WASM capture.

Entregável: demos Three.js/Babylon/model-viewer carregam modelos do R2.

### Fase 8 — Hardening

- Retomada de jobs.
- Relatório de falhas.
- Export manifest.
- E2E fixtures.
- Melhor UI.
- Rate limit Worker.
- Configuração de CORS documentada.

Entregável: MVP robusto.

### Fase 9 — Deep capture opcional

- Permissão `debugger` opcional.
- CDP Network events.
- Captura de bodies quando apropriado.
- Modo avançado com aviso claro ao usuário.

Entregável: melhor captura para casos difíceis.

---

## 18. Definition of Done da V1 robusta

A V1 só deve ser considerada pronta quando:

- A extensão instala no Chrome MV3.
- O popup inicia captura na aba atual.
- O content script detecta DOM assets.
- O injected script detecta fetch/XHR/Worker/Image/Audio básicos.
- O background persiste job em IndexedDB/storage.
- Downloads continuam/retomam após reiniciar popup/background.
- Upload para Worker/R2 funciona sem chaves Cloudflare na extensão.
- R2 retorna assets com MIME correto.
- CORS do R2 permite carregar assets no `app.html`.
- O rewriter gera HTML com runtime resolver.
- `fetch('./dados.json')` é substituído ou replayado.
- CSS `url(...)` é reescrito.
- GLB simples carrega do R2.
- GLTF externo com `.bin` e textura é reescrito.
- O relatório final lista unresolved URLs.
- O HTML final abre por duplo clique sem erros locais óbvios.

---

## 19. Limitações assumidas

A extensão não promete:

- Clonar backend real.
- Clonar login.
- Clonar banco de dados.
- Clonar pagamentos/carrinho/dashboard.
- Bypassar DRM.
- Bypassar paywall.
- Bypassar anti-bot.
- Descriptografar assets.
- Capturar conteúdo que nunca foi carregado.
- Recriar WebSocket interativo.
- Garantir funcionamento universal de qualquer site.

Promessa correta:

```txt
Gerar snapshots funcionais de páginas carregadas, com suporte forte a assets web/3D e rewrite de dependências, para uso autorizado.
```

---

## 20. Prompt operacional para Codex

Use este contexto ao iniciar implementação:

```txt
Você está implementando uma extensão Chrome Manifest V3 chamada Clone3D Snapshot.

Objetivo: capturar a página atual de forma autorizada, descobrir assets web/3D, baixar assets acessíveis, enviar arquivos grandes para Cloudflare R2 por meio de um Cloudflare Worker, receber URLs públicas, reescrever HTML/CSS/JS/API snapshots com essas URLs, injetar um runtime resolver e gerar um app.html final que abra localmente com o máximo possível de recursos funcionando.

Não implemente bypass de DRM, paywall, login, anti-bot, criptografia ou controles anticópia. Não coloque chaves Cloudflare/R2 dentro da extensão. Upload deve passar por Worker.

Arquitetura obrigatória:
- Chrome Extension MV3.
- background service worker resiliente, sem depender de estado global.
- IndexedDB para blobs/manifests/jobs.
- content script isolado para DOM scanner e bridge.
- injected MAIN world script para hooks de fetch/XHR/Worker/Blob/Image/Audio.
- Cloudflare Worker para upload seguro no R2.
- AssetManifest como fonte de verdade.
- Rewriter HTML/CSS/JS/GLTF.
- Runtime resolver embutido no app.html.

Prioridade de implementação:
1. Monorepo TS + manifest + popup/options mínimos.
2. JobStore persistente.
3. DOM/performance scanner.
4. Background downloader + IDB blob store + hash.
5. Cloudflare Worker upload endpoint + R2 binding.
6. AssetManifest + upload client.
7. HTML/CSS rewrite + app.html.
8. MAIN world hooks.
9. JS rewrite + runtime resolver.
10. GLTF/3D support.
11. Test fixtures e E2E.

Não tente implementar tudo de uma vez. Faça commits/fases pequenas, com testes e contratos bem definidos.
```
