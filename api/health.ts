import { handleHealth, type ServerEnv } from '../server/handlers';

export const runtime = 'edge';

const env = (): ServerEnv => ({
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  SERPER_API_KEY: process.env.SERPER_API_KEY,
  SEARXNG_URL: process.env.SEARXNG_URL,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
});

export default async function handler(request: Request): Promise<Response> {
  return handleHealth(request, env());
}
