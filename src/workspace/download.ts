export function saveBlob(filename: string, payload: Blob): void {
  const url = URL.createObjectURL(payload);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

export function saveText(filename: string, text: string, mediaType = 'application/json'): void {
  saveBlob(filename, new Blob([text], { type: `${mediaType};charset=utf-8` }));
}

export interface SaveSource {
  dataUrl: string | null;
  text: string | null;
  mediaType: string | null;
}

export async function saveSource(filename: string, source: SaveSource): Promise<void> {
  if (source.dataUrl) {
    const response = await fetch(source.dataUrl);
    saveBlob(filename, await response.blob());
    return;
  }

  saveBlob(
    filename,
    new Blob([source.text ?? ''], { type: source.mediaType ?? 'text/plain;charset=utf-8' }),
  );
}
