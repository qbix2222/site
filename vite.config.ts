import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { apiDev } from './devtools/api-dev';

const base = process.env.DEPLOY_TARGET === 'pages' ? '/site/' : '/';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base,
    plugins: [
      react(),
      apiDev({
        BRAVE_API_KEY: env.BRAVE_API_KEY || undefined,
        TAVILY_API_KEY: env.TAVILY_API_KEY || undefined,
        SERPER_API_KEY: env.SERPER_API_KEY || undefined,
        SEARXNG_URL: env.SEARXNG_URL || undefined,
        ALLOWED_ORIGIN: env.ALLOWED_ORIGIN || undefined,
        PROXY_ALLOW_LOCAL: env.PROXY_ALLOW_LOCAL || '1',
      }),
    ],
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
            if (
              /[\\/]node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|lowlight|highlight\.js|devlop|vfile|bail|trough|unified|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|html-url-attributes|estree-util-is-identifier-name)[\\/]?/.test(
                id,
              )
            ) {
              return 'markdown';
            }
            if (/[\\/]node_modules[\\/](@webcontainer)[\\/]/.test(id)) return 'sandbox';
            if (/[\\/]node_modules[\\/](@ai-sdk|ai)[\\/]/.test(id)) return 'ai-core';
            return undefined;
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: true,
      headers: isolationHeaders,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      headers: isolationHeaders,
    },
  };
});
