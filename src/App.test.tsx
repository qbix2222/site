// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { clearEverything } from './store/repository';
import { useAccounts } from './store/accounts-store';
import { useChatStore } from './store/chat-store';

const MODELS_PAYLOAD = {
  data: [
    {
      id: 'llama-3.3-70b-versatile',
      owned_by: 'groq',
      context_length: 131072,
      architecture: { input_modalities: ['text'], output_modalities: ['text'] },
      supported_parameters: ['tools', 'temperature', 'streaming'],
      pricing: { prompt: '0.59', completion: '0.79' },
      top_provider: { context_length: 131072, max_completion_tokens: 8192 },
    },
  ],
};

const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
  const url = String(input);

  if (url.includes('/api/health')) {
    return Response.json({ ok: true, search: { duckduckgo: true } });
  }

  if (url.includes('/models')) {
    return Response.json(MODELS_PAYLOAD);
  }

  if (url.includes('models.dev')) {
    return new Response('недоступно', { status: 503 });
  }

  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const text = (): string => document.body.textContent ?? '';

const find = (selector: string, byText?: string): HTMLElement | null => {
  const nodes = [...document.querySelectorAll<HTMLElement>(selector)];
  if (!byText) return nodes[0] ?? null;
  return nodes.find((node) => (node.textContent ?? '').includes(byText)) ?? null;
};

const click = async (element: HTMLElement | null): Promise<void> => {
  if (!element) throw new Error('Элемент не найден');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
};

const type = async (element: HTMLElement, value: string): Promise<void> => {
  const target = element as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  await act(async () => {
    setter?.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
};

const press = async (key: string, init: KeyboardEventInit = {}): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    await Promise.resolve();
  });
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  vi.stubGlobal('fetch', fakeFetch);

  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });

  root = null;
  host?.remove();
  host = null;
  vi.unstubAllGlobals();

  useChatStore.setState({ booted: false, engine: null, sessions: [], activeId: null, messages: [] });
  useAccounts.setState({ booted: false, accounts: [], models: [], owners: {}, raw: null });

  await clearEverything();
});

const tick = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

async function waitFor(condition: () => boolean): Promise<void> {
  for (let step = 0; step < 80; step += 1) {
    await tick();
    if (condition()) return;
  }

  throw new Error('Условие не выполнилось');
}

async function render(): Promise<void> {
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<App />);
    await Promise.resolve();
  });

  await waitFor(() => useAccounts.getState().booted && useChatStore.getState().sessions.length > 0);
}

describe('первый запуск', () => {
  it('показывает подбор провайдера, пока подключений нет', async () => {
    await render();

    expect(text()).toContain('Пульт');
    expect(text()).toContain('Подключите модель');
    expect(text()).toContain('OpenRouter');
    expect(text()).toContain('развернуть свой экземпляр');
  });

  it('подключает провайдера и подтягивает его модели', async () => {
    await render();

    await click(find('button.preset-line', 'Groq'));
    expect(find('input[aria-label="Ключ Groq"]')).not.toBeNull();

    await type(find('input[aria-label="Ключ Groq"]') as HTMLInputElement, 'gsk-test-key');
    await click(find('button', 'подключить'));
    await waitFor(() => useAccounts.getState().models.length > 0);

    const state = useAccounts.getState();
    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].presetId).toBe('groq');
    expect(state.models.map((model) => model.id)).toEqual(['llama-3.3-70b-versatile']);

    expect(text()).not.toContain('Подключите модель');
    expect(text()).toContain('Разговор с рабочей папкой');
    expect(text()).toContain('llama-3.3-70b-versatile');
  });

  it('открывает настройки и лист провайдеров', async () => {
    await render();

    await click(find('button[aria-label="Настройки"]'));
    expect(text()).toContain('Расход токенов');
    expect(text()).toContain('Поиск в интернете');
    expect(text()).toContain('BRAVE_API_KEY');

    await click(find('button', 'подключения, модели, opencode.json'));
    expect(text()).toContain('Провайдеры и модели');
    expect(text()).toContain('Подключений нет');

    await click(find('.segmented button', 'opencode'));
    expect(text()).toContain('Импорт профиля');
    expect(text()).toContain('opencode.json');
    expect(text()).toContain('Экспорт профиля');

    await press('Escape');
    expect(find('.sheet')).toBeNull();
  });

  it('открывает палитру команд по ctrl+k и закрывает по escape', async () => {
    await render();

    await press('k', { ctrlKey: true });
    expect(document.querySelector('.palette')).not.toBeNull();
    expect(text()).toContain('Сжать историю');

    await type(document.querySelector('.palette-input') as HTMLInputElement, 'тема');
    expect([...document.querySelectorAll('.palette-label')].map((node) => node.textContent)).toContain(
      'Тёмная тема',
    );

    await press('Escape');
    expect(document.querySelector('.palette')).toBeNull();
  });

  it('показывает состояние контекста и маршрута в нижней полосе', async () => {
    await render();

    const strip = document.querySelector('.status-strip');
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain('контекст');
    expect(strip?.textContent).toContain('нет подключения');
  });
});
