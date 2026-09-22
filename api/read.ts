import { handleRead, type ServerEnv } from '../server/handlers';

export const runtime = 'edge';

const env = (): ServerEnv => ({
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
  PROXY_ALLOW_LOCAL: process.env.PROXY_ALLOW_LOCAL,
});

export default async function handler(request: Request): Promise<Response> {
  return handleRead(request, env());
}
