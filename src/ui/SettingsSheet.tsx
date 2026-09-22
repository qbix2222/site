import { useRef, useState } from 'react';
import type { EconomyMode, ProviderRoute, SearchProviderId } from '../core/types';
import { ECONOMY_PRESETS, applyEconomy } from '../core/economy';
import { DEPLOY_ENV_VARS, DEPLOY_STEPS, REPOSITORY_URL, VERCEL_DEPLOY_URL } from '../core/deploy';
import { pushNotice, useChatStore } from '../store/chat-store';
import { useAccounts } from '../store/accounts-store';
import { useBackend } from '../store/backend-store';
import { useSettings } from '../store/settings-store';
import { Choice, NumberBox, Row, Section, Slider, Toggle } from './controls';
import { plural } from './format';

const SEARCH_PROVIDERS: Array<{ id: SearchProviderId; label: string }> = [
  { id: 'auto', label: 'авто' },
  { id: 'duckduckgo', label: 'duckduckgo' },
  { id: 'brave', label: 'brave' },
  { id: 'tavily', label: 'tavily' },
  { id: 'serper', label: 'serper' },
  { id: 'searxng', label: 'searxng' },
];

export function SettingsSheet({ onOpenProviders }: { onOpenProviders(): void }) {
  const settings = useSettings();
  const patch = useSettings((state) => state.patch);
  const reset = useSettings((state) => state.reset);
  const models = useAccounts((state) => state.models);
  const accounts = useAccounts((state) => state.accounts);
  const backend = useBackend((state) => state.status);
  const checking = useBackend((state) => state.checking);
  const check = useBackend((state) => state.check);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const update = useChatStore((state) => state.update);
  const exportAll = useChatStore((state) => state.exportAll);
  const restoreAll = useChatStore((state) => state.restoreAll);
  const wipe = useChatStore((state) => state.wipe);
  const restorePicker = useRef<HTMLInputElement>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const session = sessions.find((item) => item.id === activeId) ?? null;
  const searchOn = Object.entries(backend.search).filter(([, on]) => on).map(([name]) => name);

  function setEconomy(mode: EconomyMode): void {
    void patch({ economyMode: mode });

    if (session) {
      void update(session.id, { settings: applyEconomy(session.settings, mode) });
    }
  }

  return (
    <div className="stack gap-5">
      <Section
        title="Расход токенов"
        note="Пресет меняет параметры текущего разговора: глубину рассуждений, длину ответа и число шагов с инструментами."
      >
        <Choice<EconomyMode>
          label="Режим экономии"
          value={settings.economyMode}
          options={ECONOMY_PRESETS.map((preset) => ({ id: preset.id, label: preset.title }))}
          onChange={setEconomy}
        />

        <p className="setting-hint">
          {ECONOMY_PRESETS.find((preset) => preset.id === settings.economyMode)?.hint}
        </p>

        <Row
          name="Служебная модель"
          hint="Дешёвая модель для названий разговоров и сжатия истории. Основная модель не тратится на служебные задачи."
        >
          <select
            className="field field-mono"
            value={settings.smallModelKey ?? ''}
            onChange={(event) => void patch({ smallModelKey: event.target.value || null })}
            aria-label="Служебная модель"
          >
            <option value="">самая дешёвая из подключённых</option>
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}
              </option>
            ))}
          </select>
        </Row>

        <Row
          name="Сжатие истории"
          hint="Когда история занимает эту долю окна контекста, ранние сообщения заменяются краткой сводкой. Ноль — не сжимать."
        >
          <Slider
            value={settings.autoCompactRatio}
            min={0}
            max={0.95}
            step={0.05}
            label="Порог сжатия истории"
            onChange={(next) => void patch({ autoCompactRatio: next })}
            format={(value) => (value === 0 ? 'выключено' : `${Math.round(value * 100)}%`)}
          />
        </Row>

        <Row name="Названия разговоров" hint="Служебная модель придумывает короткое название после первого ответа.">
          <Toggle
            on={settings.autoTitle}
            onChange={(next) => void patch({ autoTitle: next })}
            label="Придумывать названия автоматически"
          />
        </Row>

        <Row name="Свежесть каталога моделей" hint="Как часто перечитывать каталог models.dev с ценами и лимитами.">
          <NumberBox
            value={settings.catalogTtlHours}
            min={1}
            max={168}
            label="Часов до обновления каталога"
            onChange={(next) => void patch({ catalogTtlHours: next ?? 12 })}
          />
        </Row>
      </Section>

      <Section
        title="Поиск в интернете"
        note="Модель сама решает, когда искать: факты после даты обучения, версии, документация, цены, новости. В ответе она приводит ссылки."
      >
        <Row name="Поиск включён" hint="Инструменты web_search и web_read доступны модели в новых ходах.">
          <Toggle
            on={settings.webSearchEnabled}
            onChange={(next) => void patch({ webSearchEnabled: next })}
            label="Разрешить поиск в интернете"
          />
        </Row>

        <Row name="Источник" hint="Авто — сначала серверный поиск, затем открытые API из браузера.">
          <select
            className="field field-mono"
            value={settings.searchProvider}
            onChange={(event) => void patch({ searchProvider: event.target.value as SearchProviderId })}
            aria-label="Источник поиска"
          >
            {SEARCH_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </Row>

        <Row name="Ключ Brave" hint="Необязательно: без ключей работает DuckDuckGo и открытые API.">
          <input
            className="field field-mono"
            type="password"
            value={settings.braveApiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => void patch({ braveApiKey: event.target.value })}
            aria-label="Ключ Brave Search"
          />
        </Row>

        <Row name="Ключ Tavily">
          <input
            className="field field-mono"
            type="password"
            value={settings.tavilyApiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => void patch({ tavilyApiKey: event.target.value })}
            aria-label="Ключ Tavily"
          />
        </Row>

        <Row name="Ключ Serper">
          <input
            className="field field-mono"
            type="password"
            value={settings.serperApiKey}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => void patch({ serperApiKey: event.target.value })}
            aria-label="Ключ Serper"
          />
        </Row>

        <Row name="Свой SearXNG" hint="Адрес публичного или своего экземпляра SearXNG.">
          <input
            className="field field-mono"
            value={settings.searxngUrl}
            spellCheck={false}
            placeholder="https://searx.example.org"
            onChange={(event) => void patch({ searxngUrl: event.target.value })}
            aria-label="Адрес SearXNG"
          />
        </Row>
      </Section>

      <Section
        title="Серверные функции и деплой"
        note="Серверные функции убирают ограничения браузера: полный поиск, чтение любых страниц и прокси к провайдерам, которые не разрешают CORS."
      >
        <Row
          name="Состояние бэкенда"
          hint={
            backend.ready
              ? searchOn.length
                ? `доступен · поиск: ${searchOn.join(', ')}`
                : 'доступен · поиск без внешних ключей'
              : (backend.error ?? 'не проверен')
          }
        >
          <span className="row gap-2">
            <span className={backend.ready ? 'dot dot-live' : 'dot dot-dead'} />
            <button type="button" className="btn btn-quiet" disabled={checking} onClick={() => void check(true)}>
              {checking ? 'проверяем…' : 'проверить'}
            </button>
          </span>
        </Row>

        <Row name="Адрес бэкенда" hint="Пусто — тот же домен, на котором открыт сайт.">
          <input
            className="field field-mono"
            value={settings.backendUrl}
            spellCheck={false}
            placeholder="https://pult.vercel.app"
            onChange={(event) => void patch({ backendUrl: event.target.value })}
            aria-label="Адрес бэкенда"
          />
        </Row>

        <Row name="Маршрут запросов к провайдерам" hint="Авто — по настройке каждого подключения.">
          <Choice<'auto' | ProviderRoute>
            label="Маршрут запросов"
            value={settings.providerRoute}
            options={[
              { id: 'auto', label: 'авто' },
              { id: 'direct', label: 'напрямую' },
              { id: 'proxy', label: 'через сервер' },
            ]}
            onChange={(next) => void patch({ providerRoute: next })}
          />
        </Row>

        <div className="deploy">
          <div className="row-between">
            <div className="setting-copy">
              <span className="setting-name">Развернуть свой экземпляр</span>
              <p className="setting-hint">
                Один клик: Vercel скопирует репозиторий, соберёт сайт и поднимет серверные функции на
                бесплатном тарифе. Домен вида <span className="mono">имя.vercel.app</span> выдаётся сразу.
              </p>
            </div>

            <a className="btn btn-signal" href={VERCEL_DEPLOY_URL} target="_blank" rel="noreferrer">
              развернуть на Vercel
            </a>
          </div>

          <div className="row">
            <a className="btn btn-quiet" href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              репозиторий
            </a>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                void navigator.clipboard.writeText(VERCEL_DEPLOY_URL);
                pushNotice('Ссылка на деплой скопирована', 'info');
              }}
            >
              скопировать ссылку деплоя
            </button>
          </div>

          <ol className="deploy-steps">
            {DEPLOY_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <ul className="env-list">
            {DEPLOY_ENV_VARS.map((item) => (
              <li key={item.name}>
                <span className="mono">{item.name}</span>
                <span className="label">{item.note}</span>
              </li>
            ))}
          </ul>
        </div>

        <Row
          name="Исполнение кода"
          hint="Песочница WebContainer запускает node прямо в браузере, локальный режим считает в отдельном потоке. Отключить исполнение для разговора можно в его параметрах."
        >
          <Choice
            label="Режим исполнения"
            value={settings.runtimePreference}
            options={[
              { id: 'auto', label: 'авто' },
              { id: 'webcontainer', label: 'песочница' },
              { id: 'local', label: 'локальный js' },
            ]}
            onChange={(next) => void patch({ runtimePreference: next })}
          />
        </Row>
      </Section>

      <Section title="Провайдеры и модели" note={`Подключений: ${accounts.length} · моделей: ${models.length}`}>
        <div className="row">
          <button type="button" className="btn btn-wide" onClick={onOpenProviders}>
            подключения, модели, opencode.json
          </button>
        </div>

        <Row name="Автоподбор по способностям" hint="Если модель не принимает фото или не умеет инструменты, ход уходит на подходящую модель того же провайдера.">
          <Toggle
            on={settings.autoRouteByCapability}
            onChange={(next) => void patch({ autoRouteByCapability: next })}
            label="Автоподбор модели по способностям"
          />
        </Row>

        <Row name="Запасная модель" hint="Куда уводить ход, если основная не подошла и у провайдера нет замены.">
          <select
            className="field field-mono"
            value={settings.fallbackModelKey ?? ''}
            onChange={(event) => void patch({ fallbackModelKey: event.target.value || null })}
            aria-label="Запасная модель"
          >
            <option value="">не задана</option>
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title="Надёжность" note="Повторы при сбоях сети, лимитах провайдера и обрывах потока.">
        <Row name="Повторов на ход" hint="С повторным запросом и урезанием истории, если причина в размере контекста.">
          <NumberBox
            value={settings.maxRetries}
            min={0}
            max={8}
            label="Число повторов"
            onChange={(next) => void patch({ maxRetries: next ?? 0 })}
          />
        </Row>

        <Row name="Пауза между повторами" hint="База для нарастающей задержки; ответ 429 учитывает заголовок retry-after.">
          <Slider
            value={settings.retryBaseMs}
            min={300}
            max={8_000}
            step={100}
            label="Пауза между повторами"
            onChange={(next) => void patch({ retryBaseMs: next })}
            format={(value) => `${(value / 1000).toFixed(1)} с`}
          />
        </Row>

        <Row name="Контроль зависшего потока" hint="Сколько ждать silence в потоке, чтобы посчитать ход оборвавшимся.">
          <Slider
            value={settings.keepAlivePingMs}
            min={15_000}
            max={180_000}
            step={5_000}
            label="Порог молчания потока"
            onChange={(next) => void patch({ keepAlivePingMs: next })}
            format={(value) => `${Math.round(value / 1000)} с`}
          />
        </Row>

        <Row name="Сохранять сырые ответы" hint="Полные ответы провайдеров в метаданных сообщений — полезно для разбора ошибок, но растит объём базы.">
          <Toggle
            on={settings.persistRawResponses}
            onChange={(next) => void patch({ persistRawResponses: next })}
            label="Сохранять сырые ответы"
          />
        </Row>
      </Section>

      <Section title="Внешность и ввод">
        <Row name="Тема">
          <Choice
            label="Тема"
            value={settings.theme}
            options={[
              { id: 'light', label: 'светлая' },
              { id: 'dark', label: 'тёмная' },
            ]}
            onChange={(next) => void patch({ theme: next })}
          />
        </Row>

        <Row name="Плотность">
          <Choice
            label="Плотность"
            value={settings.density}
            options={[
              { id: 'compact', label: 'плотно' },
              { id: 'cozy', label: 'просторно' },
            ]}
            onChange={(next) => void patch({ density: next })}
          />
        </Row>

        <Row name="Отправка по Enter" hint="Иначе Enter переносит строку, а отправляет ctrl+enter.">
          <Toggle
            on={settings.sendOnEnter}
            onChange={(next) => void patch({ sendOnEnter: next })}
            label="Отправлять по Enter"
          />
        </Row>

        <Row name="Меньше движения" hint="Отключает анимации интерфейса.">
          <Toggle
            on={settings.reduceMotion}
            onChange={(next) => void patch({ reduceMotion: next })}
            label="Меньше движения"
          />
        </Row>

        <Row name="Отклик на касание" hint="Короткая вибрация на отправку и на запрос разрешения.">
          <Toggle
            on={settings.haptics}
            onChange={(next) => void patch({ haptics: next })}
            label="Вибрация"
          />
        </Row>

        <Row name="Язык интерфейса">
          <span className="label mono">русский</span>
        </Row>
      </Section>

      <Section title="Данные" note="Всё хранится в этом браузере: IndexedDB для разговоров и файлов, localStorage для настроек.">
        <div className="row">
          <button type="button" className="btn btn-wide" onClick={() => void exportAll()}>
            резервная копия всего
          </button>

          <input
            ref={restorePicker}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';

              if (file) void file.text().then((text) => restoreAll(text));
            }}
          />

          <button type="button" className="btn btn-quiet" onClick={() => restorePicker.current?.click()}>
            восстановить
          </button>
        </div>

        <div className="row-between">
          <span className="label">
            {sessions.length} {plural(sessions.length, 'разговор', 'разговора', 'разговоров')} ·{' '}
            {models.length} {plural(models.length, 'модель', 'модели', 'моделей')}
          </span>

          {confirmWipe ? (
            <span className="row gap-2">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  void wipe();
                  setConfirmWipe(false);
                }}
              >
                стереть всё
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmWipe(false)}>
                отмена
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-quiet danger" onClick={() => setConfirmWipe(true)}>
              стереть всё
            </button>
          )}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              void reset();
              pushNotice('Настройки возвращены к исходным', 'info');
            }}
          >
            сбросить настройки
          </button>
        </div>
      </Section>
    </div>
  );
}
