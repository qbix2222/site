import type {
  CapabilitySource,
  Modality,
  ModelCapabilities,
  ModelCost,
  ModelLimits,
} from './types';

export const BASE_CAPABILITIES: ModelCapabilities = {
  attachment: false,
  reasoning: false,
  toolCall: false,
  structuredOutput: false,
  temperature: true,
  streaming: true,
  systemMessages: true,
  inputModalities: ['text'],
  outputModalities: ['text'],
};

export const ZERO_LIMITS: ModelLimits = { context: 0, input: 0, output: 0 };

export const ZERO_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
};

export interface CapabilityPatch {
  attachment?: boolean;
  reasoning?: boolean;
  toolCall?: boolean;
  structuredOutput?: boolean;
  temperature?: boolean;
  streaming?: boolean;
  systemMessages?: boolean;
  inputModalities?: readonly string[];
  outputModalities?: readonly string[];
  context?: number;
  input?: number;
  output?: number;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
  costReasoning?: number;
}

const MODALITIES: readonly Modality[] = ['text', 'image', 'audio', 'video', 'pdf', 'file'];

const isModality = (value: string): value is Modality =>
  MODALITIES.includes(value as Modality);

const sanitizeModalities = (values: readonly string[] | undefined): Modality[] | null => {
  if (!values?.length) return null;
  const known = values.filter((value) => isModality(value));
  return known.length ? known : null;
};

const CONFIDENCE: Record<CapabilitySource, number> = {
  manual: 1,
  provider: 0.9,
  catalog: 0.75,
  unknown: 0.2,
};

export const confidenceOf = (source: CapabilitySource): number => CONFIDENCE[source];

const positive = (value: number | undefined): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export function applyPatch(
  capabilities: ModelCapabilities,
  limits: ModelLimits,
  cost: ModelCost,
  patch: CapabilityPatch,
): { capabilities: ModelCapabilities; limits: ModelLimits; cost: ModelCost } {
  const nextCapabilities: ModelCapabilities = { ...capabilities };
  const nextLimits: ModelLimits = { ...limits };
  const nextCost: ModelCost = { ...cost };

  if (patch.attachment !== undefined) nextCapabilities.attachment = patch.attachment;
  if (patch.reasoning !== undefined) nextCapabilities.reasoning = patch.reasoning;
  if (patch.toolCall !== undefined) nextCapabilities.toolCall = patch.toolCall;
  if (patch.structuredOutput !== undefined) {
    nextCapabilities.structuredOutput = patch.structuredOutput;
  }
  if (patch.temperature !== undefined) nextCapabilities.temperature = patch.temperature;
  if (patch.streaming !== undefined) nextCapabilities.streaming = patch.streaming;
  if (patch.systemMessages !== undefined) {
    nextCapabilities.systemMessages = patch.systemMessages;
  }
  const inputModalities = sanitizeModalities(patch.inputModalities);
  if (inputModalities) nextCapabilities.inputModalities = inputModalities;
  const outputModalities = sanitizeModalities(patch.outputModalities);
  if (outputModalities) nextCapabilities.outputModalities = outputModalities;

  if (positive(patch.context)) nextLimits.context = patch.context as number;
  if (positive(patch.input)) nextLimits.input = patch.input as number;
  if (positive(patch.output)) nextLimits.output = patch.output as number;

  if (patch.costInput !== undefined && patch.costInput >= 0) nextCost.input = patch.costInput;
  if (patch.costOutput !== undefined && patch.costOutput >= 0) nextCost.output = patch.costOutput;
  if (patch.costCacheRead !== undefined) nextCost.cacheRead = patch.costCacheRead;
  if (patch.costCacheWrite !== undefined) nextCost.cacheWrite = patch.costCacheWrite;
  if (patch.costReasoning !== undefined) nextCost.reasoning = patch.costReasoning;

  if (nextCapabilities.inputModalities.includes('image')) {
    nextCapabilities.attachment = true;
  }
  if (nextCapabilities.inputModalities.includes('pdf')) {
    nextCapabilities.attachment = true;
  }

  if (!positive(nextLimits.context) && positive(nextLimits.input)) {
    nextLimits.context = nextLimits.input;
  }

  return { capabilities: nextCapabilities, limits: nextLimits, cost: nextCost };
}

export const acceptsImages = (capabilities: ModelCapabilities): boolean =>
  capabilities.attachment && capabilities.inputModalities.includes('image');

export const acceptsPdf = (capabilities: ModelCapabilities): boolean =>
  capabilities.attachment && capabilities.inputModalities.includes('pdf');

export const acceptsAudio = (capabilities: ModelCapabilities): boolean =>
  capabilities.attachment && capabilities.inputModalities.includes('audio');

export const acceptsModality = (
  capabilities: ModelCapabilities,
  modality: Modality,
): boolean => {
  if (modality === 'text') return true;
  if (modality === 'image') return acceptsImages(capabilities);
  if (modality === 'pdf') return acceptsPdf(capabilities);
  if (modality === 'audio') return acceptsAudio(capabilities);
  return capabilities.attachment && capabilities.inputModalities.includes(modality);
};

export interface UnsupportedReport {
  images: boolean;
  documents: boolean;
  audio: boolean;
  tools: boolean;
  reasoning: boolean;
  temperature: boolean;
  streaming: boolean;
  context: boolean;
}

export function findUnsupported(
  capabilities: ModelCapabilities,
  limits: ModelLimits,
  request: {
    hasImages: boolean;
    hasDocuments: boolean;
    hasAudio: boolean;
    needsTools: boolean;
    needsReasoning: boolean;
    usesTemperature: boolean;
    estimatedTokens: number;
  },
): UnsupportedReport {
  return {
    images: request.hasImages && !acceptsImages(capabilities),
    documents: request.hasDocuments && !acceptsModality(capabilities, 'pdf'),
    audio: request.hasAudio && !acceptsAudio(capabilities),
    tools: request.needsTools && !capabilities.toolCall,
    reasoning: request.needsReasoning && !capabilities.reasoning,
    temperature: request.usesTemperature && !capabilities.temperature,
    streaming: !capabilities.streaming,
    context: positive(limits.context) && request.estimatedTokens > limits.context,
  };
}

export const hasBlocker = (report: UnsupportedReport): boolean =>
  report.images || report.documents || report.audio || report.tools || report.context;

export const describeUnsupported = (report: UnsupportedReport): string[] => {
  const lines: string[] = [];
  if (report.images) lines.push('модель не принимает изображения');
  if (report.documents) lines.push('модель не принимает документы');
  if (report.audio) lines.push('модель не принимает аудио');
  if (report.tools) lines.push('модель не поддерживает вызов инструментов');
  if (report.reasoning) lines.push('модель не отдаёт ход рассуждений');
  if (report.temperature) lines.push('модель игнорирует temperature');
  if (report.streaming) lines.push('модель отвечает только целиком, без потока');
  if (report.context) lines.push('запрос не помещается в контекстное окно');
  return lines;
};
