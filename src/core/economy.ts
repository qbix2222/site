import type { EconomyMode, ModelCost, ModelRecord, TurnSettings, UsageRecord } from './types';

export interface EconomyPreset {
  id: EconomyMode;
  title: string;
  hint: string;
  patch: Partial<TurnSettings>;
}

export const ECONOMY_PRESETS: EconomyPreset[] = [
  {
    id: 'off',
    title: 'Без ограничений',
    hint: 'Модель думает столько, сколько считает нужным. Дороже всего, лучше всего на сложных задачах.',
    patch: {
      reasoningEffort: 'high',
      verbosity: 'high',
      maxOutputTokens: null,
      maxToolRounds: 16,
      thinkingBudget: null,
    },
  },
  {
    id: 'balanced',
    title: 'Ровно',
    hint: 'Короткие рассуждения, умеренный ответ, до восьми шагов с инструментами. Разумный расход по умолчанию.',
    patch: {
      reasoningEffort: 'medium',
      verbosity: 'medium',
      maxOutputTokens: 4_096,
      maxToolRounds: 8,
      thinkingBudget: 4_096,
    },
  },
  {
    id: 'strict',
    title: 'Жёсткая экономия',
    hint: 'Рассуждения выключены, ответ короткий, до трёх шагов. Для быстрых вопросов и дешёвых моделей.',
    patch: {
      reasoningEffort: 'off',
      verbosity: 'low',
      maxOutputTokens: 1_024,
      maxToolRounds: 3,
      thinkingBudget: null,
    },
  },
];

export const presetById = (id: EconomyMode): EconomyPreset =>
  ECONOMY_PRESETS.find((preset) => preset.id === id) ?? ECONOMY_PRESETS[1];

export function applyEconomy(settings: TurnSettings, mode: EconomyMode): TurnSettings {
  if (mode === 'off' && settings.reasoningEffort === null) return settings;
  return { ...settings, ...presetById(mode).patch };
}

export const ECONOMY_INSTRUCTIONS: Record<EconomyMode, string> = {
  off: '',
  balanced:
    'Экономь токены: не пересказывай вопрос, не повторяй то, что уже сказано, не объясняй очевидное. Рассуждения держи короткими — только ключевые развилки. Ответ заканчивай, как только вопрос закрыт.',
  strict:
    'Режим жёсткой экономии: отвечай предельно коротко, без вступлений и выводов. Код — без комментариев, если они не объясняют неочевидное. Рассуждения не пиши вовсе. Инструменты вызывай только когда без них ответ будет неверным.',
};

export const costOf = (usage: UsageRecord, cost: ModelCost): number => {
  const perMillion = (rate: number) => rate / 1_000_000;
  const billableInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);

  return (
    billableInput * perMillion(cost.input) +
    usage.cachedInputTokens * perMillion(cost.cacheRead) +
    usage.outputTokens * perMillion(cost.output) +
    usage.reasoningTokens * perMillion(cost.reasoning)
  );
};

export interface SpendSummary {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  byModel: Array<{ modelKey: string; usd: number; turns: number; tokens: number }>;
  byDay: Array<{ day: string; usd: number; turns: number }>;
}

export function summarizeSpend(
  entries: Array<{ modelKey: string; at: number; usage: UsageRecord }>,
): SpendSummary {
  const models = new Map<string, { usd: number; turns: number; tokens: number }>();
  const days = new Map<string, { usd: number; turns: number }>();

  let totalUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const entry of entries) {
    const cost = entry.usage.costUsd || 0;
    const day = new Date(entry.at).toISOString().slice(0, 10);

    totalUsd += cost;
    inputTokens += entry.usage.inputTokens;
    outputTokens += entry.usage.outputTokens;

    const model = models.get(entry.modelKey) ?? { usd: 0, turns: 0, tokens: 0 };
    models.set(entry.modelKey, {
      usd: model.usd + cost,
      turns: model.turns + 1,
      tokens: model.tokens + entry.usage.inputTokens + entry.usage.outputTokens,
    });

    const bucket = days.get(day) ?? { usd: 0, turns: 0 };
    days.set(day, { usd: bucket.usd + cost, turns: bucket.turns + 1 });
  }

  return {
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    inputTokens,
    outputTokens,
    turns: entries.length,
    byModel: [...models.entries()]
      .map(([modelKey, value]) => ({ modelKey, ...value }))
      .sort((left, right) => right.usd - left.usd),
    byDay: [...days.entries()]
      .map(([day, value]) => ({ day, ...value }))
      .sort((left, right) => left.day.localeCompare(right.day)),
  };
}

export interface BudgetVerdict {
  allowed: boolean;
  spentUsd: number;
  capUsd: number | null;
  ratio: number | null;
  message: string | null;
}

export function checkBudget(spentUsd: number, capUsd: number | null): BudgetVerdict {
  if (capUsd === null || capUsd <= 0) {
    return { allowed: true, spentUsd, capUsd, ratio: null, message: null };
  }

  if (spentUsd >= capUsd) {
    return {
      allowed: false,
      spentUsd,
      capUsd,
      ratio: 1,
      message: `Лимит разговора исчерпан: $${spentUsd.toFixed(4)} из $${capUsd.toFixed(4)}`,
    };
  }

  const ratio = spentUsd / capUsd;

  return {
    allowed: true,
    spentUsd,
    capUsd,
    ratio,
    message: ratio >= 0.8 ? `Истрачено ${Math.round(ratio * 100)}% лимита разговора` : null,
  };
}

export function cheaperOf(models: ModelRecord[], tokens: number, count = 3): ModelRecord[] {
  const priced = models.filter((model) => model.cost.input > 0 || model.cost.output > 0);
  const pool = priced.length ? priced : models;

  return [...pool]
    .map((model) => ({
      model,
      estimate: (tokens / 1_000_000) * (model.cost.input + model.cost.output * 3),
      fits: model.limits.context === 0 || model.limits.context >= tokens,
    }))
    .filter((item) => item.fits)
    .sort((left, right) => left.estimate - right.estimate || right.model.confidence - left.model.confidence)
    .slice(0, count)
    .map((item) => item.model);
}

export function pickSmallModel(models: ModelRecord[], preferredKey: string | null): ModelRecord | null {
  if (preferredKey) {
    const preferred = models.find((model) => model.key === preferredKey);
    if (preferred) return preferred;
  }

  const capable = models.filter((model) => !model.deprecated && model.capabilities.streaming);
  return cheaperOf(capable.length ? capable : models, 2_000, 1)[0] ?? null;
}

export const contextFillRatio = (estimatedTokens: number, contextWindow: number): number =>
  contextWindow > 0 ? Math.min(1, estimatedTokens / contextWindow) : 0;
