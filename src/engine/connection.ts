export type ConnectionPhase = 'idle' | 'connecting' | 'streaming' | 'stalled' | 'closed';

export interface StreamTelemetry {
  phase: ConnectionPhase;
  startedAt: number | null;
  firstChunkAt: number | null;
  lastChunkAt: number | null;
  chunks: number;
  bytes: number;
  stalls: number;
}

export const emptyTelemetry = (): StreamTelemetry => ({
  phase: 'idle',
  startedAt: null,
  firstChunkAt: null,
  lastChunkAt: null,
  chunks: 0,
  bytes: 0,
  stalls: 0,
});

export interface WatchdogOptions {
  firstChunkTimeoutMs: number;
  idleTimeoutMs: number;
  onStall?: (telemetry: StreamTelemetry) => void;
  onPhase?: (phase: ConnectionPhase) => void;
  now?: () => number;
}

export class StreamWatchdog {
  private telemetry: StreamTelemetry = emptyTelemetry();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: WatchdogOptions;
  private readonly clock: () => number;

  constructor(options: WatchdogOptions) {
    this.options = options;
    this.clock = options.now ?? Date.now;
  }

  snapshot(): StreamTelemetry {
    return { ...this.telemetry };
  }

  private setPhase(phase: ConnectionPhase): void {
    if (this.telemetry.phase === phase) return;
    this.telemetry.phase = phase;
    this.options.onPhase?.(phase);
  }

  start(): void {
    this.telemetry = { ...emptyTelemetry(), phase: 'connecting', startedAt: this.clock() };
    this.options.onPhase?.('connecting');
    this.arm(this.options.firstChunkTimeoutMs);
  }

  chunk(bytes: number): void {
    const now = this.clock();
    this.telemetry.chunks += 1;
    this.telemetry.bytes += bytes;
    this.telemetry.lastChunkAt = now;

    if (this.telemetry.firstChunkAt === null) {
      this.telemetry.firstChunkAt = now;
      this.setPhase('streaming');
    }

    this.arm(this.options.idleTimeoutMs);
  }

  private arm(timeoutMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.trip(), timeoutMs);
  }

  private trip(): void {
    if (this.telemetry.phase === 'closed' || this.telemetry.phase === 'stalled') return;
    this.telemetry.stalls += 1;
    this.setPhase('stalled');
    this.options.onStall?.(this.snapshot());
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setPhase('closed');
  }

  elapsedMs(): number {
    const start = this.telemetry.startedAt;
    return start === null ? 0 : this.clock() - start;
  }

  timeToFirstChunkMs(): number | null {
    const { startedAt, firstChunkAt } = this.telemetry;
    if (startedAt === null || firstChunkAt === null) return null;
    return firstChunkAt - startedAt;
  }
}

export type NetworkState = 'online' | 'offline' | 'restored';

export interface NetworkSnapshot {
  state: NetworkState;
  onlineSince: number | null;
  effectiveType: string | null;
  downlinkMbps: number | null;
  tabHidden: boolean;
}

interface NavigatorConnection {
  readonly effectiveType?: string;
  readonly downlink?: number;
}

function readConnection(): { effectiveType: string | null; downlinkMbps: number | null } {
  const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
  if (!connection) return { effectiveType: null, downlinkMbps: null };
  return {
    effectiveType: connection.effectiveType ?? null,
    downlinkMbps: typeof connection.downlink === 'number' ? connection.downlink : null,
  };
}

export interface ConnectionMonitorOptions {
  onOffline?: () => void;
  onRestored?: (offlineMs: number) => void;
  onVisible?: () => void;
}

export function createConnectionMonitor(options: ConnectionMonitorOptions = {}): {
  snapshot: () => NetworkSnapshot;
  start: () => () => void;
} {
  let state: NetworkState = navigator.onLine ? 'online' : 'offline';
  let offlineAt: number | null = navigator.onLine ? null : Date.now();
  let onlineSince: number | null = navigator.onLine ? Date.now() : null;

  const snapshot = (): NetworkSnapshot => {
    const { effectiveType, downlinkMbps } = readConnection();
    return {
      state,
      onlineSince,
      effectiveType,
      downlinkMbps,
      tabHidden: document.visibilityState === 'hidden',
    };
  };

  const handleOnline = (): void => {
    const duration = offlineAt === null ? 0 : Date.now() - offlineAt;
    offlineAt = null;
    onlineSince = Date.now();
    state = 'restored';
    options.onRestored?.(duration);
    state = 'online';
  };

  const handleOffline = (): void => {
    state = 'offline';
    offlineAt = Date.now();
    onlineSince = null;
    options.onOffline?.();
  };

  const handleVisibility = (): void => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      options.onVisible?.();
    }
  };

  const start = (): (() => void) => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  };

  return { snapshot, start };
}

export async function measureLatency(url: string, timeoutMs = 5_000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
    return Math.round(performance.now() - startedAt);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
