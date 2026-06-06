import { CLONE3D_VERSION } from "@clone3d/shared";

interface Env {
  readonly ENVIRONMENT?: string;
}

type WorkerHandler<TEnv> = {
  fetch(request: Request, env: TEnv, context: unknown): Response | Promise<Response>;
};

const worker: WorkerHandler<Env> = {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "clone3d-snapshot-worker",
        version: CLONE3D_VERSION
      });
    }

    return json(
      {
        ok: false,
        error: "not_found"
      },
      404
    );
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export default worker;
