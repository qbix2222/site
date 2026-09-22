const DAY_MS = 86_400_000;

const timeOf = (at: number): string =>
  new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function shortWhen(at: number): string {
  const now = Date.now();
  const diff = now - at;

  if (diff < DAY_MS && new Date(at).getDate() === new Date(now).getDate()) return timeOf(at);
  if (diff < 6 * DAY_MS) {
    return new Date(at).toLocaleDateString('ru-RU', { weekday: 'short' });
  }

  return new Date(at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export function fullWhen(at: number): string {
  return new Date(at).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function duration(ms: number): string {
  if (ms < 1_000) return `${ms} мс`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} с`;
  return `${Math.floor(ms / 60_000)} мин ${Math.round((ms % 60_000) / 1_000)} с`;
}

export function tokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function usd(value: number): string {
  if (value === 0) return '0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function fileCount(count: number): string {
  return `${count} ${plural(count, 'файл', 'файла', 'файлов')}`;
}
