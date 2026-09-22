import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Connect, Plugin } from 'vite';
import { handleHealth, handleProvider, handleRead, handleSearch, type ServerEnv } from '../server/handlers';

const ENDPOINTS = ['/api/health', '/api/search', '/api/read', '/api/provider/'] as const;

const collect = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

async function toRequest(request: IncomingMessage): Promise<Request> {
  const host = request.headers.host ?? 'localhost';
  const method = request.method ?? 'GET';
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }

  const raw = method === 'GET' || method === 'HEAD' ? null : await collect(request);

  return new Request(`http://${host}${request.url ?? '/'}`, {
    method,
    headers,
    body: raw?.length ? new Uint8Array(raw) : undefined,
  });
}

async function route(request: Request, env: ServerEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname.endsWith('/api/health')) return handleHealth(request, env);
  if (pathname.endsWith('/api/search')) return handleSearch(request, env);
  if (pathname.endsWith('/api/read')) return handleRead(request, env);
  if (pathname.includes('/api/provider/')) return handleProvider(request, env);

  return null;
}

function send(response: ServerResponse, payload: Response): void {
  response.statusCode = payload.status;

  payload.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'content-length') response.setHeader(name, value);
  });

  const body = payload.body as unknown as NodeReadableStream<Uint8Array> | null;

  if (!body) {
    response.end();
    return;
  }

  const stream = Readable.fromWeb(body);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

export function apiDev(env: ServerEnv = {}): Plugin {
  const middleware: Connect.NextHandleFunction = (request, response, next) => {
    const url = request.url ?? '';

    if (!ENDPOINTS.some((endpoint) => url.includes(endpoint))) {
      next();
      return;
    }

    void (async () => {
      try {
        const payload = await route(await toRequest(request), env);

        if (!payload) {
          next();
          return;
        }

        send(response, payload);
      } catch {
        response.statusCode = 500;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: 'Серверная функция завершилась ошибкой' }));
      }
    })();
  };

  return {
    name: 'pult-api-dev',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
