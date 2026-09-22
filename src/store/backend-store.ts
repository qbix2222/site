import { create } from 'zustand';
import type { EndpointPolicy } from '../core/providers';
import { probeBackend, unknownBackend, type BackendStatus } from '../net/backend';
import { useSettings } from './settings-store';

export interface BackendStore {
  status: BackendStatus;
  checking: boolean;
  check(force?: boolean): Promise<BackendStatus>;
  policy(): EndpointPolicy;
}

export const useBackend = create<BackendStore>((set, get) => ({
  status: unknownBackend(),
  checking: false,

  async check(force = false) {
    const current = get();
    if (current.checking) return current.status;
    if (!force && current.status.checkedAt && Date.now() - current.status.checkedAt < 60_000) {
      return current.status;
    }

    set({ checking: true });

    try {
      const status = await probeBackend(useSettings.getState().backendUrl);
      set({ status, checking: false });
      return status;
    } catch {
      const status: BackendStatus = { ...unknownBackend(), checkedAt: Date.now() };
      set({ status, checking: false });
      return status;
    }
  },

  policy() {
    const { backendUrl, providerRoute } = useSettings.getState();
    const status = get().status;

    return {
      backendUrl,
      backendReady: status.ready,
      route: providerRoute,
    };
  },
}));
