import { describe, expect, it } from 'vitest';
import { mergeModelRecords } from './discovery';
import {
  envVarName,
  matchesGlob,
  npmOf,
  opencodeConfigOf,
  parseOpencodeConfig,
  providerKeyOf,
  resolveApiKey,
} from './opencode';
import { createAccount } from '../core/providers';
import type { ModelRecord, ProviderAccount } from '../core/types';

const SAMPLE = JSON.stringify({
  $schema: 'https://opencode.ai/config.json',
  model: 'anthropic/claude-sonnet-4-5',
  provider: {
    anthropic: {
      npm: '@ai-sdk/anthropic',
      name: 'Anthropic',
      options: {
        apiKey: '{env:ANTHROPIC_API_KEY}',
        headers: { 'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14' },
      },
      models: {
        'claude-sonnet-4-5': {
          name: 'Claude Sonnet 4.5',
          limit: { context: 200000, output: 64000 },
          attachment: true,
          tool_call: true,
          temperature: true,
          cost: { input: 3, output: 15, cache_read: 0.3 },
          options: { thinking: { type: 'enabled', budgetTokens: 8000 } },
        },
        'claude-haiku-4': { limit: { context: 200000, output: 8192 } },
      },
    },
    ollama: {
      npm: '@ai-sdk/openai-compatible',
      name: 'Локальная Ollama',
      options: { baseURL: 'http://localhost:11434/v1', apiKey: 'ollama' },
      models: {
        'qwen3:14b': { limit: { context: 32768, output: 4096 }, reasoning: true },
        'llama3.2:3b': { limit: { context: 8192, output: 2048 } },
        'nomic-embed': {},
      },
      blacklist: ['*embed*'],
    },
    'my-proxy': {
      npm: '@ai-sdk/openai',
      options: { baseURL: 'https://gateway.internal/v1', apiKey: 'sk-secret' },
      models: { 'gpt-5': { limit: { context: 400000, output: 128000 } } },
      whitelist: ['gpt-*'],
    },
  },
});

describe('parseOpencodeConfig', () => {
  const parsed = parseOpencodeConfig(SAMPLE);

  it('разбирает все три подключения', () => {
    expect(parsed.profiles).toHaveLength(3);
    expect(parsed.notices).toEqual([]);
  });

  it('сопоставляет известный провайдер с пресетом и протоколом', () => {
    const [anthropic] = parsed.profiles;

    expect(anthropic.draft.presetId).toBe('anthropic');
    expect(anthropic.draft.protocol).toBe('anthropic');
    expect(anthropic.draft.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(anthropic.draft.headers).toEqual({
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    });
    expect(anthropic.draft.opencode).toBe(true);
  });

  it('предупреждает, что ключ из переменной окружения недоступен браузеру', () => {
    const [anthropic] = parsed.profiles;

    expect(anthropic.draft.apiKey).toBe('');
    expect(anthropic.notices.join(' ')).toContain('ANTHROPIC_API_KEY');
  });

  it('переносит лимиты, вложения и рассуждения моделей', () => {
    const [anthropic] = parsed.profiles;
    const sonnet = anthropic.models.find((model) => model.id === 'claude-sonnet-4-5');

    expect(sonnet?.name).toBe('Claude Sonnet 4.5');
    expect(sonnet?.patch).toMatchObject({
      context: 200000,
      output: 64000,
      attachment: true,
      toolCall: true,
      temperature: true,
      reasoning: true,
      costInput: 3,
      costOutput: 15,
      costCacheRead: 0.3,
      inputModalities: ['text', 'image', 'pdf', 'file'],
    });
  });

  it('узнаёт локальную Ollama по адресу и оставляет прямой маршрут', () => {
    const ollama = parsed.profiles[1];

    expect(ollama.draft.presetId).toBe('ollama');
    expect(ollama.draft.label).toBe('Локальная Ollama');
    expect(ollama.draft.route).toBe('direct');
    expect(ollama.draft.apiKey).toBe('ollama');
  });

  it('применяет blacklist и whitelist к списку моделей', () => {
    const ollama = parsed.profiles[1];
    const proxy = parsed.profiles[2];

    expect(ollama.models.map((model) => model.id)).toEqual(['qwen3:14b', 'llama3.2:3b']);
    expect(proxy.models.map((model) => model.id)).toEqual(['gpt-5']);
  });

  it('делает провайдера без пресета пользовательским', () => {
    const proxy = parsed.profiles[2];

    expect(proxy.draft.presetId).toBe('custom');
    expect(proxy.draft.baseUrl).toBe('https://gateway.internal/v1');
    expect(proxy.draft.label).toBe('gateway.internal');
    expect(proxy.draft.route).toBeUndefined();
  });

  it('сообщает о битом JSON и об отсутствии секции provider', () => {
    expect(parseOpencodeConfig('{ не json').profiles).toEqual([]);
    expect(parseOpencodeConfig('{ не json').notices[0]).toContain('JSON');
    expect(parseOpencodeConfig('{"model":"x"}').notices[0]).toContain('provider');
  });
});

describe('resolveApiKey', () => {
  it('различает литерал, переменную окружения и файл', () => {
    expect(resolveApiKey('sk-123')).toEqual({ key: 'sk-123', notice: null });
    expect(resolveApiKey('{env:TOKEN}').key).toBe('');
    expect(resolveApiKey('{file:~/.key}').notice).toContain('~/.key');
    expect(resolveApiKey(undefined).notice).toContain('не указан');
  });
});

describe('matchesGlob', () => {
  it('поддерживает звёздочку и нечувствителен к регистру', () => {
    expect(matchesGlob('gpt-5-mini', 'gpt-*')).toBe(true);
    expect(matchesGlob('claude-3', 'gpt-*')).toBe(false);
    expect(matchesGlob('nomic-embed-text', '*embed*')).toBe(true);
    expect(matchesGlob('GPT-4O', 'gpt-*')).toBe(true);
  });
});

describe('opencodeConfigOf', () => {
  const anthropic = createAccount({
    presetId: 'anthropic',
    label: 'Anthropic',
    apiKey: 'sk-ant-secret',
    opencode: true,
    headers: { 'anthropic-beta': 'x' },
  });

  const local = createAccount({
    presetId: 'custom',
    label: 'Внутренний шлюз',
    apiKey: 'sk-local',
    baseUrl: 'https://gateway.internal/v1',
    protocol: 'openai-responses',
    opencode: true,
  });

  const unmarked = createAccount({ presetId: 'groq', label: 'Groq', apiKey: 'gsk-1' });

  const models: ModelRecord[] = mergeModelRecords(anthropic, [], [
    {
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      patch: { context: 200000, output: 64000, costInput: 3, costOutput: 15 },
      deprecated: false,
    },
  ]);

  it('выгружает только подключения с включённым профилем', () => {
    const config = JSON.parse(opencodeConfigOf([anthropic, local, unmarked], models));

    expect(Object.keys(config.provider)).toEqual(['anthropic', providerKeyOf(local)]);
    expect(config.$schema).toBe('https://opencode.ai/config.json');
  });

  it('заменяет ключ ссылкой на переменную окружения по умолчанию', () => {
    const config = JSON.parse(opencodeConfigOf([anthropic], models));

    expect(config.provider.anthropic.options.apiKey).toBe('{env:PULT_ANTHROPIC_API_KEY}');
    expect(config.provider.anthropic.options.apiKey).not.toContain('sk-ant-secret');
    expect(envVarName(local)).toBe('PULT_GATEWAY_INTERNAL_API_KEY');
  });

  it('кладёт настоящий ключ, когда экспорт с ключами разрешён', () => {
    const config = JSON.parse(opencodeConfigOf([anthropic], models, { includeKeys: true }));

    expect(config.provider.anthropic.options.apiKey).toBe('sk-ant-secret');
  });

  it('подбирает npm-адаптер под протокол', () => {
    const config = JSON.parse(opencodeConfigOf([anthropic, local], models));

    expect(config.provider.anthropic.npm).toBe('@ai-sdk/anthropic');
    expect(config.provider[providerKeyOf(local)].npm).toBe('@ai-sdk/openai');
    expect(npmOf(unmarked)).toBe('@ai-sdk/openai-compatible');
  });

  it('описывает модели с лимитами и ценой', () => {
    const config = JSON.parse(opencodeConfigOf([anthropic], models));
    const model = config.provider.anthropic.models['claude-sonnet-4-5'];

    expect(model.name).toBe('Claude Sonnet 4.5');
    expect(model.limit).toEqual({ context: 200000, output: 64000 });
    expect(model.cost).toEqual({ input: 3, output: 15 });
  });

  it('прописывает модель по умолчанию', () => {
    const config = JSON.parse(
      opencodeConfigOf([anthropic], models, { defaultModelKey: models[0].key }),
    );

    expect(config.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('не повторяет заголовки пресета в выгрузке', () => {
    const openai = createAccount({
      presetId: 'anthropic',
      label: 'Anthropic',
      apiKey: 'k',
      opencode: true,
    });
    const config = JSON.parse(opencodeConfigOf([openai], []));

    expect(config.provider.anthropic.options.headers).toBeUndefined();
  });
});

describe('обратная совместимость выгрузки и разбора', () => {
  it('сохраняет адреса, протоколы и лимиты моделей', () => {
    const account: ProviderAccount = createAccount({
      presetId: 'openrouter',
      label: 'OpenRouter',
      apiKey: 'sk-or-1',
      opencode: true,
    });

    const models = mergeModelRecords(account, [], [
      {
        id: 'deepseek/deepseek-v3',
        name: null,
        patch: { context: 64000, output: 8192, toolCall: true },
        deprecated: false,
      },
    ]);

    const exported = opencodeConfigOf([account], models, { includeKeys: true });
    const parsed = parseOpencodeConfig(exported);

    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0].draft.presetId).toBe('openrouter');
    expect(parsed.profiles[0].draft.protocol).toBe('openai-chat');
    expect(parsed.profiles[0].draft.apiKey).toBe('sk-or-1');
    expect(parsed.profiles[0].models[0].patch).toMatchObject({
      context: 64000,
      output: 8192,
      toolCall: true,
    });
  });
});
