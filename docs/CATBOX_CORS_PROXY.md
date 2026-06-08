# Catbox CORS Proxy

Catbox continua sendo usado como storage remoto, mas `files.catbox.moe` nao deve ser usado diretamente para recursos que exigem CORS, como module scripts, dynamic imports, WASM, GLTF, JSON via `fetch`, workers e decoders.

O Worker em `apps/worker` expoe um proxy restrito:

- `GET /catbox/:filename`
- `HEAD /catbox/:filename`
- `OPTIONS /catbox/:filename`
- `GET /health`

Ele so aceita filenames seguros, por exemplo `fx27je.js`, e sempre busca em:

```text
https://files.catbox.moe/:filename
```

Ele nao e um proxy aberto e nao usa R2.

## Deploy

```bash
cd apps/worker
npx wrangler deploy
```

## Configuracao Na Extensao

Abra Options e configure:

- `assetServingMode`: `auto` ou `catbox-cors-proxy`
- `corsProxyEnabled`: ligado
- `corsProxyEndpoint`: `https://seu-worker.workers.dev`
- `moduleServingStrategy`: `auto` ou `proxy`

Com isso, um asset publicado como:

```text
https://files.catbox.moe/fx27je.js
```

sera usado no app.html como:

```text
https://seu-worker.workers.dev/catbox/fx27je.js
```

## Por Que Isso Existe

Ao abrir `app.html` via `file://`, a origem e `null`. Module scripts, imports dinamicos, WASM, GLTF e fetch precisam de respostas com CORS. Catbox nao fornece headers CORS configuraveis, entao o navegador bloqueia esses carregamentos. O Worker adiciona:

```text
Access-Control-Allow-Origin: *
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: public, max-age=31536000, immutable
```

## Limites

- O proxy so serve arquivos ja hospedados em `files.catbox.moe`.
- O proxy nao autentica nem armazena arquivos.
- O proxy nao corrige assets que nunca foram capturados/uploadados.
- Nao use para contornar login, paywall, DRM ou controles anticopia.
