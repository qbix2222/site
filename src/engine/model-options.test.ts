import { describe, expect, it } from 'vitest';
import type { TurnSettings } from '../core/types';
import { DEFAULT_TURN_SETTINGS } from '../store/repository';
import { callSettingsFor, describeSettings, providerOptionsFor } from './model-options';

const settings = (partial: Partial<TurnSettings> = {}): TurnSettings => ({
  ...DEFAULT_TURN_SETTINGS,
  ...partial,
});

describe('providerOptionsFor', () => {
  it('переводит усилие рассуждений в бюджет токенов Anthropic', () => {
    expect(providerOptionsFor('anthropic', settings({ reasoningEffort: 'high' }))).toEqual({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 16_000 } },
    });
  });

  it('отключает расширенное мышление Anthropic, когда рассуждения выключены', () => {
    expect(providerOptionsFor('anthropic', settings({ reasoningEffort: 'off' }))).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    });
  });

  it('уважает вручную заданный бюджет вместо пресета', () => {
    expect(
      providerOptionsFor('anthropic', settings({ reasoningEffort: 'low', thinkingBudget: 900 })),
    ).toEqual({ anthropic: { thinking: { type: 'enabled', budgetTokens: 900 } } });
  });

  it('отдаёт Google thinkingBudget и не выходит за его потолок', () => {
    expect(providerOptionsFor('google', settings({ reasoningEffort: 'medium' }))).toEqual({
      google: { thinkingConfig: { thinkingBudget: 6_000 } },
    });

    expect(
      providerOptionsFor('google', settings({ reasoningEffort: 'high', thinkingBudget: 90_000 })),
    ).toEqual({ google: { thinkingConfig: { thinkingBudget: 24_576 } } });
  });

  it('обнуляет бюджет Google, когда рассуждения выключены', () => {
    expect(providerOptionsFor('google', settings({ reasoningEffort: 'off' }))).toEqual({
      google: { thinkingConfig: { thinkingBudget: 0 } },
    });
  });

  it('кладёт reasoningEffort и textVerbosity в ключ своего протокола OpenAI', () => {
    expect(providerOptionsFor('openai-responses', settings({ verbosity: 'low' }))).toEqual({
      openai: { textVerbosity: 'low', reasoningEffort: 'medium' },
    });

    expect(providerOptionsFor('openai-chat', settings({ verbosity: 'high' }))).toEqual({
      openaiCompatible: { textVerbosity: 'high', reasoningEffort: 'medium' },
    });
  });

  it('не отправляет reasoningEffort для моделей без рассуждений', () => {
    expect(providerOptionsFor('openai-chat', settings({ reasoningEffort: 'off' }))).toEqual({
      openaiCompatible: { textVerbosity: 'medium' },
    });
  });
});

describe('callSettingsFor', () => {
  it('пропускает только заданные пользователем параметры выборки', () => {
    const call = callSettingsFor('anthropic', settings({ temperature: 0.2 }));

    expect(call.temperature).toBe(0.2);
    expect(call).not.toHaveProperty('topP');
    expect(call).not.toHaveProperty('maxOutputTokens');
    expect(call.providerOptions).toBeDefined();
  });

  it('передаёт потолок вывода и topP, когда они выставлены', () => {
    const call = callSettingsFor('openai-chat', settings({ topP: 0.9, maxOutputTokens: 1_024 }));

    expect(call).toMatchObject({ topP: 0.9, maxOutputTokens: 1_024 });
  });

  it('не подставляет temperature 0 как отсутствующее значение', () => {
    expect(callSettingsFor('google', settings({ temperature: 0 })).temperature).toBe(0);
  });
});

describe('describeSettings', () => {
  it('описывает режим human-readable строкой', () => {
    const line = describeSettings(
      settings({ reasoningEffort: 'high', verbosity: 'low', maxToolRounds: 3, maxOutputTokens: 2_000 }),
    );

    expect(line).toContain('глубокие рассуждения ≈16000 токенов');
    expect(line).toContain('ответ кратко');
    expect(line).toContain('до 3 шагов');
    expect(line).toContain('потолок 2000 токенов');
  });

  it('согласует падеж для одного шага', () => {
    expect(describeSettings(settings({ maxToolRounds: 1 }))).toContain('до 1 шага');
  });
});
