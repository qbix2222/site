export type PatchFailure =
  | { kind: 'not-found'; search: string }
  | { kind: 'ambiguous'; search: string; matches: number }
  | { kind: 'identical' }
  | { kind: 'empty-search' };

export type PatchResult =
  | { ok: true; text: string; replaced: number }
  | { ok: false; failure: PatchFailure };

export interface PatchEdit {
  search: string;
  replace: string;
  replaceAll?: boolean;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

export function normalizeForSearch(text: string): string {
  return text.replace(/\r\n/g, '\n').trimEnd();
}

export function applyEdit(source: string, edit: PatchEdit): PatchResult {
  const search = edit.search.replace(/\r\n/g, '\n');
  const replace = edit.replace.replace(/\r\n/g, '\n');

  if (!search.trim()) {
    return { ok: false, failure: { kind: 'empty-search' } };
  }

  const text = source.replace(/\r\n/g, '\n');

  if (search === replace) {
    return { ok: false, failure: { kind: 'identical' } };
  }

  const exact = countOccurrences(text, search);
  if (exact > 0) {
    if (exact > 1 && !edit.replaceAll) {
      return { ok: false, failure: { kind: 'ambiguous', search, matches: exact } };
    }
    const next = edit.replaceAll ? text.split(search).join(replace) : text.replace(search, replace);
    return { ok: true, text: next, replaced: edit.replaceAll ? exact : 1 };
  }

  const normalizedSearch = normalizeForSearch(search);
  const normalizedText = normalizeForSearch(text);
  const normalized = countOccurrences(normalizedText, normalizedSearch);

  if (normalized === 1) {
    const next = normalizedText.replace(normalizedSearch, normalizeForSearch(replace));
    return { ok: true, text: next, replaced: 1 };
  }
  if (normalized > 1 && !edit.replaceAll) {
    return { ok: false, failure: { kind: 'ambiguous', search, matches: normalized } };
  }
  if (normalized > 1) {
    const next = normalizedText.split(normalizedSearch).join(normalizeForSearch(replace));
    return { ok: true, text: next, replaced: normalized };
  }

  const loose = looseMatch(text, search);
  if (loose) {
    if (loose.matches > 1 && !edit.replaceAll) {
      return { ok: false, failure: { kind: 'ambiguous', search, matches: loose.matches } };
    }
    const next = edit.replaceAll
      ? text.replaceAll(loose.pattern, () => replace)
      : text.replace(loose.pattern, () => replace);
    return { ok: true, text: next, replaced: edit.replaceAll ? loose.matches : 1 };
  }

  return { ok: false, failure: { kind: 'not-found', search } };
}

function looseMatch(
  text: string,
  search: string,
): { pattern: RegExp; matches: number } | null {
  const searchLines = search.split('\n').filter((line) => line.trim().length > 0);
  if (searchLines.length < 1) return null;

  const body = searchLines
    .map((line) => `[ \\t]*${escapeRegExp(line.trim())}[ \\t]*`)
    .join('\\n');

  const pattern = new RegExp(body);
  const matches = (text.match(new RegExp(pattern.source, 'g')) ?? []).length;
  return matches > 0 ? { pattern, matches } : null;
}

export function applyEdits(source: string, edits: PatchEdit[]): PatchResult {
  let text = source;
  let replaced = 0;

  for (const edit of edits) {
    const result = applyEdit(text, edit);
    if (!result.ok) return result;
    text = result.text;
    replaced += result.replaced;
  }

  return { ok: true, text, replaced };
}

export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

export function diffLines(before: string, after: string, contextLines = 2): DiffLine[] {
  const left = before.split('\n');
  const right = after.split('\n');
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    Array.from({ length: right.length + 1 }, () => 0),
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ kind: 'same', text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'remove', text: left[i] });
      i += 1;
    } else {
      lines.push({ kind: 'add', text: right[j] });
      j += 1;
    }
  }

  while (i < left.length) {
    lines.push({ kind: 'remove', text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    lines.push({ kind: 'add', text: right[j] });
    j += 1;
  }

  if (contextLines < 0) return lines;

  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (let offset = -contextLines; offset <= contextLines; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < lines.length) keep.add(target);
    }
  });

  const trimmed: DiffLine[] = [];
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      trimmed.push(line);
      return;
    }
    const previous = trimmed[trimmed.length - 1];
    if (previous?.text !== '…') trimmed.push({ kind: 'same', text: '…' });
  });

  return trimmed;
}
