export type Modality = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'file';

export type TransportProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google';

export type AuthScheme = 'bearer' | 'api-key-header' | 'query-key';

export interface AuthSpec {
  scheme: AuthScheme;
  header?: string;
  queryParam?: string;
}

export interface DiscoverySpec {
  kind: 'none' | 'openai-models' | 'anthropic-models' | 'google-models';
  path?: string;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  protocol: TransportProtocol;
  auth: AuthSpec;
  discovery: DiscoverySpec;
  catalogId?: string;
  browserDirect: boolean;
  browserNote?: string;
  optionalKey?: boolean;
  extraHeaders?: Record<string, string>;
  docsUrl: string;
  keysUrl: string;
  keyHint?: string;
  accent: string;
  order: number;
}

export type ProviderRoute = 'direct' | 'proxy';

export interface ProviderAccount {
  id: string;
  presetId: string;
  route: ProviderRoute;
  label: string;
  apiKey: string;
  baseUrl: string;
  protocol: TransportProtocol;
  headers: Record<string, string>;
  catalogId: string | null;
  discovery: DiscoverySpec;
  browserDirect: boolean;
  opencode: boolean;
  enabled: boolean;
  addedAt: number;
  lastCheckedAt: number | null;
  lastStatus: 'unknown' | 'ok' | 'denied' | 'unreachable';
  lastError: string | null;
}

export interface ModelLimits {
  context: number;
  input: number;
  output: number;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export interface ModelCapabilities {
  attachment: boolean;
  reasoning: boolean;
  toolCall: boolean;
  structuredOutput: boolean;
  temperature: boolean;
  streaming: boolean;
  systemMessages: boolean;
  inputModalities: Modality[];
  outputModalities: Modality[];
}

export type CapabilitySource = 'catalog' | 'provider' | 'manual' | 'unknown';

export interface ModelRecord {
  key: string;
  providerId: string;
  id: string;
  name: string;
  family: string | null;
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  cost: ModelCost;
  knowledge: string | null;
  releasedAt: string | null;
  free: boolean;
  source: CapabilitySource;
  confidence: number;
  deprecated: boolean;
  description: string | null;
}

export type AttachmentKind = 'image' | 'document' | 'audio' | 'video' | 'other';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mediaType: string;
  size: number;
  dataUrl: string;
}

export type EntryStatus = 'queued' | 'sending' | 'streaming' | 'settled' | 'failed' | 'aborted';

export interface AttemptRecord {
  at: number;
  modelKey: string;
  outcome: 'ok' | 'error' | 'aborted';
  status?: number;
  message?: string;
  durationMs: number;
}

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface RouteDecision {
  modelKey: string;
  reason: 'requested' | 'vision-required' | 'tools-required' | 'reasoning-required' | 'manual';
  replacedFrom: string | null;
  notice: string | null;
}

export interface TurnMeta {
  status: EntryStatus;
  attempts: AttemptRecord[];
  route: RouteDecision | null;
  usage: UsageRecord | null;
  trimmedMessages: number;
  estimatedTokens: number;
  contextWindow: number;
  errorText: string | null;
  errorCode: string | null;
  createdAt: number;
  settledAt: number | null;
}

export interface WorkspaceNode {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mediaType: string | null;
  createdAt: number;
  updatedAt: number;
  origin: 'user' | 'agent' | 'runtime';
  text: string | null;
  dataUrl: string | null;
}

export interface TerminalLine {
  id: string;
  at: number;
  stream: 'in' | 'out' | 'err' | 'sys';
  text: string;
}

export type RuntimeKind = 'webcontainer' | 'local' | 'none';

export interface RuntimeStatus {
  kind: RuntimeKind;
  ready: boolean;
  reason: string | null;
  isolated: boolean;
}

export type PersonaId = 'default' | 'engineer' | 'editor' | 'analyst' | 'explorer';

export interface ChatSession {
  persona: PersonaId;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  modelKey: string | null;
  instructions: string;
  settings: TurnSettings;
  workspaceRoot: string;
  tokenBudgetRatio: number;
  spendCapUsd: number | null;
  compactedBefore: number;
  titleSource: TitleSource;
  tags: string[];
}

export type TitleSource = 'auto' | 'model' | 'user';

export type Verbosity = 'low' | 'medium' | 'high';

export interface TurnSettings {
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number | null;
  reasoningEffort: 'off' | 'low' | 'medium' | 'high' | null;
  thinkingBudget: number | null;
  verbosity: Verbosity;
  maxToolRounds: number;
  toolsEnabled: boolean;
  workspaceEnabled: boolean;
  executionEnabled: boolean;
  webEnabled: boolean;
  approvalRequired: boolean;
}

export interface StoredMessageMeta {
  turn: TurnMeta;
  attachments: Attachment[];
  workspaceSnapshot: string[];
}

export interface OutboxEntry {
  id: string;
  chatId: string;
  messageId: string;
  text: string;
  attachments: Attachment[];
  modelKey: string;
  settings: TurnSettings;
  attempts: number;
  state: 'pending' | 'in-flight' | 'done' | 'failed';
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
}

export interface SpendEntry {
  id: string;
  chatId: string;
  modelKey: string;
  at: number;
  usage: UsageRecord;
}

export interface SettingsState {
  theme: 'light' | 'dark';
  density: 'compact' | 'cozy';
  reduceMotion: boolean;
  sendOnEnter: boolean;
  language: 'ru';
  catalogTtlHours: number;
  maxRetries: number;
  retryBaseMs: number;
  autoRouteByCapability: boolean;
  fallbackModelKey: string | null;
  keepAlivePingMs: number;
  persistRawResponses: boolean;
  haptics: boolean;
  backendUrl: string;
  providerRoute: 'auto' | ProviderRoute;
  smallModelKey: string | null;
  webSearchEnabled: boolean;
  searchProvider: SearchProviderId;
  braveApiKey: string;
  tavilyApiKey: string;
  serperApiKey: string;
  searxngUrl: string;
  autoCompactRatio: number;
  economyMode: EconomyMode;
  autoTitle: boolean;
}

export type SearchProviderId = 'auto' | 'duckduckgo' | 'brave' | 'tavily' | 'serper' | 'searxng';

export type EconomyMode = 'off' | 'balanced' | 'strict';
