import { create } from 'zustand';
import type { RuntimePreference } from '../runtime';
import type { SettingsState } from '../core/types';
import { DEFAULT_SETTINGS, readSettings, writeSettings } from './repository';

export type RuntimePreferenceChoice = RuntimePreference;

export interface SettingsStore extends SettingsState {
  runtimePreference: RuntimePreferenceChoice;
  booted: boolean;
  boot(): Promise<SettingsState>;
  patch(changes: Partial<Omit<SettingsStore, 'boot' | 'booted'>>): Promise<void>;
  reset(): Promise<void>;
}

export const persistable = (state: SettingsStore): SettingsState => {
  const {
    runtimePreference: _runtimePreference,
    booted: _booted,
    boot: _boot,
    patch: _patch,
    reset: _reset,
    ...settings
  } = state;

  return settings;
};

export const applyAppearance = (
  settings: Pick<SettingsState, 'theme' | 'density' | 'reduceMotion'>,
): void => {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.style.colorScheme = settings.theme;

  if (settings.reduceMotion) root.dataset.motion = 'off';
  else delete root.dataset.motion;
};

const persistRuntimePreference = (value: RuntimePreferenceChoice): void => {
  try {
    localStorage.setItem('pult.runtime', value);
  } catch {
    /* приватный режим браузера */
  }
};

const readRuntimePreference = (): RuntimePreferenceChoice => {
  try {
    const stored = localStorage.getItem('pult.runtime');
    if (stored === 'webcontainer' || stored === 'local' || stored === 'auto') return stored;
  } catch {
    /* приватный режим браузера */
  }

  return 'auto';
};

export const useSettings = create<SettingsStore>((set, get) => ({
  ...DEFAULT_SETTINGS,
  runtimePreference: 'auto',
  booted: false,

  async boot() {
    if (get().booted) return persistable(get());

    const stored = await readSettings();
    const runtimePreference = readRuntimePreference();

    set({ ...stored, runtimePreference, booted: true });
    applyAppearance(stored);

    return stored;
  },

  async patch(changes) {
    const next = { ...get(), ...changes };
    set(changes);

    if ('theme' in changes || 'density' in changes || 'reduceMotion' in changes) {
      applyAppearance(next);
    }

    if (changes.runtimePreference) {
      persistRuntimePreference(changes.runtimePreference);
    }

    await writeSettings(persistable(next));
  },

  async reset() {
    set({ ...DEFAULT_SETTINGS, runtimePreference: 'auto' });
    applyAppearance(DEFAULT_SETTINGS);
    persistRuntimePreference('auto');
    await writeSettings({ ...DEFAULT_SETTINGS });
  },
}));
