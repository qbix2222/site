import { useCallback, useEffect, useState } from 'react';
import { ChatRail } from './ui/ChatRail';
import { Composer } from './ui/Composer';
import { FirstRun } from './ui/FirstRun';
import { Masthead } from './ui/Masthead';
import { Notices } from './ui/Notices';
import { Palette } from './ui/Palette';
import { Providers, type ProvidersView } from './ui/Providers';
import { SettingsSheet } from './ui/SettingsSheet';
import { Sheet } from './ui/Sheet';
import { StatusStrip } from './ui/StatusStrip';
import { Stream } from './ui/Stream';
import { TurnSheet } from './ui/TurnSheet';
import { WorkPanel } from './ui/WorkPanel';
import { useMediaQuery } from './ui/use-media';
import { useAccounts } from './store/accounts-store';
import { useBackend } from './store/backend-store';
import { useChatStore } from './store/chat-store';
import { useSettings } from './store/settings-store';

type SheetKind = 'settings' | 'providers' | 'turn';

async function bootStores(): Promise<void> {
  const settings = await useSettings.getState().boot();

  await useBackend.getState().check();
  await useAccounts.getState().boot(settings.catalogTtlHours);
  await useChatStore.getState().boot();

  if (useChatStore.getState().sessions.length === 0) {
    await useChatStore.getState().create();
  }
}

export default function App() {
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [providersView, setProvidersView] = useState<ProvidersView>('list');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  const booted = useChatStore((state) => state.booted);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const phase = useChatStore((state) => state.status.phase);
  const engine = useChatStore((state) => state.engine);
  const accounts = useAccounts((state) => state.accounts);
  const accountsBooted = useAccounts((state) => state.booted);
  const haptics = useSettings((state) => state.haptics);
  const narrow = useMediaQuery('(max-width: 720px)');
  const compact = useMediaQuery('(max-width: 1180px)');

  const boot = useCallback(async (): Promise<void> => {
    setBooting(true);
    setBootError(null);

    try {
      await bootStores();
    } catch (error) {
      setBootError(
        error instanceof Error ? error.message : 'Хранилище браузера недоступно в этом режиме',
      );
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    if (booted) return;
    void boot();
  }, [booted, boot]);

  useEffect(() => {
    setRailOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (!haptics || typeof navigator.vibrate !== 'function') return;

    if (phase === 'streaming') navigator.vibrate(8);
    if (phase === 'awaiting-approval') navigator.vibrate([12, 40, 12]);
    if (phase === 'failed') navigator.vibrate(30);
  }, [phase, haptics]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return;

      const key = event.key.toLowerCase();

      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }

      if (key === 'b') {
        event.preventDefault();
        setWorkOpen((value) => !value);
        return;
      }

      if (key === ',') {
        event.preventDefault();
        setSheet('settings');
        return;
      }

      if (key === 'm' && event.shiftKey) {
        event.preventDefault();
        setProvidersView('list');
        setSheet('providers');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openProviders = useCallback((view: ProvidersView = 'list') => {
    setProvidersView(view);
    setSheet('providers');
  }, []);

  const closeSheet = useCallback(() => setSheet(null), []);

  if (bootError) {
    return (
      <div className="app">
        <div className="boot-error">
          <h1 className="empty-title">Хранилище не открылось</h1>
          <p className="empty-lede">
            {bootError}. Разговоры и файлы живут в IndexedDB этого браузера: проверьте, не закрыт ли
            приватный режим и не заблокированы ли данные сайта.
          </p>
          <button type="button" className="btn btn-signal" onClick={() => void boot()}>
            попробовать снова
          </button>
        </div>
      </div>
    );
  }

  const runtime = engine?.runtimeInfo() ?? { kind: 'none' as const, fallbackReason: null };
  const showFirstRun = accountsBooted && accounts.length === 0;

  return (
    <div className="app" data-booting={booting || undefined}>
      <Masthead
        runtimeKind={runtime.kind}
        runtimeNote={runtime.fallbackReason}
        workOpen={workOpen}
        onOpenRail={() => setRailOpen(true)}
        onToggleWork={() => setWorkOpen((value) => !value)}
        onOpenSettings={() => setSheet('settings')}
      />

      <aside className="rail">
        <ChatRail />
      </aside>

      <main className="conversation">
        {showFirstRun ? (
          <div className="stream">
            <div className="stream-inner">
              <FirstRun onOpenProviders={() => openProviders('add')} onOpenOpencode={() => openProviders('opencode')} />
            </div>
          </div>
        ) : (
          <Stream onPick={setDraft} />
        )}

        {!showFirstRun && sessions.length > 0 && (
          <Composer
            draft={draft}
            onDraft={setDraft}
            onEditInstructions={() => setSheet('turn')}
            onOpenWork={() => setWorkOpen(true)}
          />
        )}

        <StatusStrip />
      </main>

      <aside className="work" hidden={!workOpen}>
        <WorkPanel />
      </aside>

      {railOpen && narrow && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Закрыть список разговоров"
            tabIndex={-1}
            onClick={() => setRailOpen(false)}
          />
          <aside className="drawer drawer-left">
            <button type="button" className="drawer-close" aria-label="Закрыть" onClick={() => setRailOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <ChatRail />
          </aside>
        </>
      )}

      {workOpen && compact && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Закрыть рабочую панель"
            tabIndex={-1}
            onClick={() => setWorkOpen(false)}
          />
          <aside className="drawer drawer-right">
            <button type="button" className="drawer-close" aria-label="Закрыть" onClick={() => setWorkOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
            <WorkPanel />
          </aside>
        </>
      )}

      {sheet === 'settings' && (
        <Sheet
          title="Настройки"
          hint="Поиск, серверные функции, деплой, экономия токенов и данные"
          onClose={closeSheet}
        >
          <SettingsSheet onOpenProviders={() => openProviders('list')} />
        </Sheet>
      )}

      {sheet === 'providers' && (
        <Sheet
          title="Провайдеры и модели"
          hint="Ключи хранятся в этом браузере и уходят провайдеру напрямую или через ваши серверные функции"
          onClose={closeSheet}
        >
          <Providers initialView={providersView} />
        </Sheet>
      )}

      {sheet === 'turn' && (
        <Sheet
          title="Параметры разговора"
          hint="Действуют только для открытого разговора"
          onClose={closeSheet}
        >
          <TurnSheet />
        </Sheet>
      )}

      {paletteOpen && (
        <Palette
          onClose={() => setPaletteOpen(false)}
          onOpenSettings={() => setSheet('settings')}
          onOpenProviders={() => openProviders('list')}
          onOpenTurn={() => setSheet('turn')}
          onToggleWork={() => setWorkOpen((value) => !value)}
          onOpenRail={() => setRailOpen(true)}
        />
      )}

      <Notices />
    </div>
  );
}
