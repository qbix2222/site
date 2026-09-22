const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const fromBase64 = (value: string): string => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
};

export const encodeTarget = (baseUrl: string): string =>
  toBase64(baseUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const decodeTarget = (value: string): string =>
  fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'));

export const PROXY_PREFIX = '/api/provider/';

export function proxyUrl(backendUrl: string, baseUrl: string): string {
  const origin = backendUrl.replace(/\/+$/, '');
  return `${origin}${PROXY_PREFIX}${encodeTarget(baseUrl)}`;
}
