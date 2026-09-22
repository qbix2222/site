import type { TransportProtocol, TurnSettings, Verbosity } from '../core/types';

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export type ProviderOptions = Record<string, Record<string, JsonValue>>;

const THINKING_BUDGET: Record<string, number> = {
  low: 2_048,
  medium: 6_000,
  high: 16_000,
};

export const reasoningLabel: Record<TurnSettings['reasoningEffort'] & string, string> = {
  off: 'без рассуждений',
  low: 'короткие рассуждения',
  medium: 'умеренные рассуждения',
  high: 'глубокие рассуждения',
};

export const verbosityLabel: Record<Verbosity, string> = {
  low: 'кратко',
  medium: 'обычно',
  high: 'подробно',
};

const thinkingBudgetOf = (settings: TurnSettings): number | null => {
  if (settings.reasoningEffort === 'off' || settings.reasoningEffort === null) return null;
  return settings.thinkingBudget ?? THINKING_BUDGET[settings.reasoningEffort] ?? null;
};

export function providerOptionsFor(
  protocol: TransportProtocol,
  settings: TurnSettings,
): ProviderOptions {
  const effort = settings.reasoningEffort;

  if (protocol === 'anthropic') {
    const budget = thinkingBudgetOf(settings);

    return {
      anthropic: {
        thinking:
          effort === 'off' || budget === null
            ? { type: 'disabled' }
            : { type: 'enabled', budgetTokens: budget },
      },
    };
  }

  if (protocol === 'google') {
    const budget = thinkingBudgetOf(settings);

    return {
      google: {
        thinkingConfig:
          budget === null
            ? { thinkingBudget: 0 }
            : { thinkingBudget: Math.min(budget, 24_576) },
      },
    };
  }

  const openai: Record<string, JsonValue> = { textVerbosity: settings.verbosity };
  if (effort && effort !== 'off') openai.reasoningEffort = effort;

  return protocol === 'openai-responses'
    ? { openai }
    : { openaiCompatible: openai };
}

export interface CallSettings {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  providerOptions?: ProviderOptions;
}

export function callSettingsFor(
  protocol: TransportProtocol,
  settings: TurnSettings,
): CallSettings {
  const call: CallSettings = {
    providerOptions: providerOptionsFor(protocol, settings),
  };

  if (settings.temperature !== null) call.temperature = settings.temperature;
  if (settings.topP !== null) call.topP = settings.topP;
  if (settings.maxOutputTokens !== null) call.maxOutputTokens = settings.maxOutputTokens;

  return call;
}

export function describeSettings(settings: TurnSettings): string {
  const parts: string[] = [];

  if (settings.reasoningEffort && settings.reasoningEffort !== 'off') {
    const budget = thinkingBudgetOf(settings);
    parts.push(budget ? `${reasoningLabel[settings.reasoningEffort]} ≈${budget} токенов` : reasoningLabel[settings.reasoningEffort]);
  } else {
    parts.push(reasoningLabel.off);
  }

  parts.push(`ответ ${verbosityLabel[settings.verbosity]}`);
  parts.push(`до ${settings.maxToolRounds} ${settings.maxToolRounds === 1 ? 'шага' : 'шагов'} с инструментами`);

  if (settings.maxOutputTokens) parts.push(`потолок ${settings.maxOutputTokens} токенов`);

  return parts.join(', ');
}
