import { describe, expect, it } from 'vitest';
import {
  BASE_CAPABILITIES,
  ZERO_COST,
  ZERO_LIMITS,
  acceptsImages,
  applyPatch,
  describeUnsupported,
  findUnsupported,
  hasBlocker,
} from './capabilities';

describe('applyPatch', () => {
  it('поднимает attachment, когда объявлен вход изображением', () => {
    const result = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, {
      inputModalities: ['text', 'image'],
      attachment: false,
    });
    expect(result.capabilities.attachment).toBe(true);
    expect(acceptsImages(result.capabilities)).toBe(true);
  });

  it('не затирает известные значения пустыми', () => {
    const result = applyPatch(
      BASE_CAPABILITIES,
      { ...ZERO_LIMITS, context: 128_000 },
      { ...ZERO_COST, input: 3 },
      { context: 0, costInput: undefined },
    );
    expect(result.limits.context).toBe(128_000);
    expect(result.cost.input).toBe(3);
  });

  it('достраивает окно контекста из лимита входа', () => {
    const result = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, { input: 200_000 });
    expect(result.limits.context).toBe(200_000);
  });

  it('принимает только известные модальности', () => {
    const result = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, {
      inputModalities: ['text', 'hologram'],
    });
    expect(result.capabilities.inputModalities).toEqual(['text']);
  });

  it('игнорирует пустой список модальностей', () => {
    const result = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, {
      inputModalities: [],
    });
    expect(result.capabilities.inputModalities).toEqual(['text']);
  });
});

describe('findUnsupported', () => {
  const vision = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, {
    inputModalities: ['text', 'image', 'pdf'],
    toolCall: true,
  });

  it('не блокирует текстовый запрос к любой модели', () => {
    const report = findUnsupported(BASE_CAPABILITIES, ZERO_LIMITS, {
      hasImages: false,
      hasDocuments: false,
      hasAudio: false,
      needsTools: false,
      needsReasoning: false,
      usesTemperature: false,
      estimatedTokens: 100,
    });
    expect(hasBlocker(report)).toBe(false);
    expect(describeUnsupported(report)).toHaveLength(0);
  });

  it('блокирует изображение для текстовой модели', () => {
    const report = findUnsupported(BASE_CAPABILITIES, { ...ZERO_LIMITS, context: 8000 }, {
      hasImages: true,
      hasDocuments: false,
      hasAudio: false,
      needsTools: false,
      needsReasoning: false,
      usesTemperature: false,
      estimatedTokens: 100,
    });
    expect(report.images).toBe(true);
    expect(hasBlocker(report)).toBe(true);
    expect(describeUnsupported(report).join()).toContain('изображения');
  });

  it('пропускает изображение и инструменты у способной модели', () => {
    const report = findUnsupported(vision.capabilities, { ...vision.limits, context: 8000 }, {
      hasImages: true,
      hasDocuments: true,
      hasAudio: false,
      needsTools: true,
      needsReasoning: false,
      usesTemperature: true,
      estimatedTokens: 100,
    });
    expect(hasBlocker(report)).toBe(false);
  });

  it('замечает переполнение контекста', () => {
    const report = findUnsupported(BASE_CAPABILITIES, { ...ZERO_LIMITS, context: 1000 }, {
      hasImages: false,
      hasDocuments: false,
      hasAudio: false,
      needsTools: false,
      needsReasoning: false,
      usesTemperature: false,
      estimatedTokens: 5000,
    });
    expect(report.context).toBe(true);
    expect(hasBlocker(report)).toBe(true);
  });

  it('не считает переполнением неизвестное окно', () => {
    const report = findUnsupported(BASE_CAPABILITIES, ZERO_LIMITS, {
      hasImages: false,
      hasDocuments: false,
      hasAudio: false,
      needsTools: false,
      needsReasoning: false,
      usesTemperature: false,
      estimatedTokens: 999_999,
    });
    expect(report.context).toBe(false);
  });
});
