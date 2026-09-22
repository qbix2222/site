import { useMemo, useRef, useState } from 'react';
import type { ModelRecord, ProviderAccount, TransportProtocol } from '../core/types';
import { acceptsAudio, acceptsImages, acceptsPdf } from '../core/capabilities';
import {
  CUSTOM_PROVIDER_ID,
  presetById,
  sortedPresets,
  type AccountDraft,
} from '../core/providers';
import { OPENCODE_FILE_NAME } from '../catalog/opencode';
import { describeSettings } from '../engine/model-options';
import { pushNotice, useChatStore } from '../store/chat-store';
import { useAccounts } from '../store/accounts-store';
import { useSettings } from '../store/settings-store';
import { saveText } from '../workspace/download';
import { formatBytes } from '../workspace/summary';
import { plural, tokens, usd } from './format';

export type ProvidersView = 'list' | 'add' | 'opencode';

const views: Array<{ id: ProvidersView; label: string }> = [
  { id: 'list', label: 'подключения' },
  { id: 'add', label: 'добавить' },
  { id: 'opencode', label: 'opencode' },
];

const PROTOCOLS: Array<{ id: TransportProtocol; label: string }> = [
  { id: 'openai-chat', label: 'openai · chat completions' },
  { id: 'openai-responses', label: 'openai · responses' },
  { id: 'anthropic', label: 'anthropic · messages' },
  { id: 'google', label: 'google · generative' },
];

const SOURCE_LABEL: Record<ModelRecord['source'], string> = {
  catalog: 'каталог',
  provider: 'от провайдера',
  manual: 'вручную',
  unknown: 'не проверено',
};

const capabilityChips = (record: ModelRecord): string[] => {
  const chips: string[] = [];

  if (acceptsImages(record.capabilities)) chips.push('зрение');
  if (acceptsPdf(record.capabilities)) chips.push('pdf');
  if (acceptsAudio(record.capabilities)) chips.push('аудио');
  if (record.capabilities.toolCall) chips.push('инструменты');
  if (record.capabilities.reasoning) chips.push('рассуждения');
  if (record.capabilities.structuredOutput) chips.push('схема вывода');
  if (!record.capabilities.temperature) chips.push('без температуры');
  if (!record.capabilities.streaming) chips.push('без потока');
  if (record.free) chips.push('бесплатно');

  return chips;
};

function ModelRow({ account, record }: { account: ProviderAccount; record: ModelRecord }) {
  const update = useChatStore((state) => state.update);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const session = sessions.find((item) => item.id === activeId) ?? null;
  const smallModelKey = useSettings((state) => state.smallModelKey);
  const patch = useSettings((state) => state.patch);
  const chips = capabilityChips(record);

  return (
    <li className="model-row">
      <div className="row-between">
        <span className="model-name">{record.name}</span>
        <span className="label mono" title="Окно контекста и цены за миллион токенов">
          {record.limits.context > 0 ? `${tokens(record.limits.context)} контекст` : 'контекст неизвестен'}
          {record.cost.input > 0 && ` · ${usd(record.cost.input)}/${usd(record.cost.output)}`}
        </span>
      </div>

      <div className="chip-row">
        <span className="chip chip-quiet">{SOURCE_LABEL[record.source]}</span>
        {record.deprecated && <span className="chip chip-danger">снят с поддержки</span>}
        {chips.map((chip) => (
          <span className="chip chip-quiet" key={chip}>
            {chip}
          </span>
        ))}
      </div>

      <div className="model-ops">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!session}
          onClick={() => session && void update(session.id, { modelKey: record.key })}
        >
          {session?.modelKey === record.key ? 'модель разговора' : 'в этот разговор'}
        </button>

        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => void patch({ smallModelKey: record.key })}
          title="Дешёвая модель для заголовков и сжатия истории"
        >
          {smallModelKey === record.key ? 'служебная модель' : 'сделать служебной'}
        </button>

        <span className="label mono">{record.id}</span>
        <span className="label" title="Провайдер этого подключения">
          {account.label}
        </span>
      </div>
    </li>
  );
}

function AccountRow({ account }: { account: ProviderAccount }) {
  const modelsOf = useAccounts((state) => state.modelsOf);
  const probes = useAccounts((state) => state.probes);
  const discovering = useAccounts((state) => state.discovering);
  const check = useAccounts((state) => state.check);
  const discover = useAccounts((state) => state.discover);
  const remove = useAccounts((state) => state.removeAccount);
  const updateAccount = useAccounts((state) => state.updateAccount);
  const [expanded, setExpanded] = useState(false);

  const models = modelsOf(account.id);
  const probe = probes[account.id] ?? null;
  const busy = discovering[account.id] === true;

  const state = probe
    ? probe.outcome === 'ok'
      ? 'ok'
      : probe.outcome === 'denied'
        ? 'denied'
        : 'dead'
    : account.lastStatus === 'ok'
      ? 'ok'
      : account.lastStatus === 'denied'
        ? 'denied'
        : account.lastStatus === 'unreachable'
          ? 'dead'
          : 'unknown';

  const note = probe?.message ?? account.lastError ?? 'состояние не проверялось';

  return (
    <li className="panel account-card">
      <div className="account-head">
        <span
          className={state === 'ok' ? 'dot dot-live' : state === 'unknown' ? 'dot' : 'dot dot-dead'}
          title={note}
        />

        <div className="account-title">
          <span className="account-name">{account.label}</span>
          <span className="label mono account-url" title={account.baseUrl}>
            {account.baseUrl}
          </span>
        </div>

        <span className="chip chip-quiet">{models.length} {plural(models.length, 'модель', 'модели', 'моделей')}</span>
      </div>

      <p className="setting-hint" title={note}>
        {state === 'ok' && 'доступен'}
        {state === 'denied' && 'ключ отклонён'}
        {state === 'dead' && 'сервер недоступен'}
        {state === 'unknown' && 'не проверен'}
        {note && ` — ${note}`}
      </p>

      <div className="account-ops">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void check(account.id).then(() => pushNotice('Состояние подключения обновлено', 'info'))}
        >
          проверить
        </button>

        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() =>
            void discover(account.id)
              .then(() => pushNotice(`${account.label}: список моделей обновлён`, 'info'))
              .catch(() => pushNotice('Не удалось обновить список моделей', 'warn'))
          }
        >
          {busy ? 'обновляем…' : 'обновить модели'}
        </button>

        <button type="button" className="btn btn-quiet" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? 'скрыть модели' : 'показать модели'}
        </button>

        <label className="switch-row" title="Выгружать это подключение в opencode.json и принимать его оттуда">
          <span className="setting-name">профиль opencode</span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={account.opencode}
            aria-label="Профиль OpenCode для этого подключения"
            onClick={() => void updateAccount({ ...account, opencode: !account.opencode })}
          />
        </label>

        <label className="switch-row" title="Отключённое подключение не участвует в маршрутизации">
          <span className="setting-name">включено</span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={account.enabled}
            aria-label="Подключение активно"
            onClick={() => void updateAccount({ ...account, enabled: !account.enabled })}
          />
        </label>

        <button
          type="button"
          className="btn btn-quiet danger"
          onClick={() => {
            void remove(account.id);
            pushNotice(`${account.label}: подключение и его модели удалены`, 'info');
          }}
        >
          удалить
        </button>
      </div>

      {expanded && (
        <ul className="model-list">
          {models.length ? (
            models.map((record) => <ModelRow key={record.key} account={account} record={record} />)
          ) : (
            <li className="rail-empty">
              Моделей нет: нажмите «обновить модели» или добавьте их через opencode.json.
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

interface FormState {
  presetId: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  protocol: TransportProtocol;
  route: 'auto' | 'direct' | 'proxy';
  headers: Array<{ name: string; value: string }>;
  opencode: boolean;
}

const formFor = (presetId: string): FormState => {
  const preset = presetById(presetId);

  return {
    presetId,
    label: preset?.name ?? '',
    apiKey: preset?.optionalKey ? presetId : '',
    baseUrl: preset?.baseUrl ?? '',
    protocol: preset?.protocol ?? 'openai-chat',
    route: 'auto',
    headers: [],
    opencode: presetId !== CUSTOM_PROVIDER_ID,
  };
};

function AddProvider({ onDone }: { onDone(): void }) {
  const addAccount = useAccounts((state) => state.addAccount);
  const [form, setForm] = useState<FormState>(() => formFor('openrouter'));
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const preset = presetById(form.presetId) ?? null;

  const patch = (changes: Partial<FormState>): void =>
    setForm((current) => ({ ...current, ...changes }));

  async function submit(): Promise<void> {
    if (!form.baseUrl.trim()) {
      pushNotice('Укажите адрес сервера', 'warn');
      return;
    }

    setBusy(true);

    const draft: AccountDraft = {
      presetId: form.presetId,
      label: form.label.trim(),
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim(),
      protocol: form.protocol,
      route: form.route === 'auto' ? undefined : form.route,
      headers: Object.fromEntries(
        form.headers.filter((row) => row.name.trim()).map((row) => [row.name.trim(), row.value.trim()]),
      ),
      opencode: form.opencode,
    };

    try {
      const account = await addAccount(draft);
      const models = useAccounts.getState().modelsOf(account.id);

      pushNotice(
        models.length
          ? `${account.label}: подключено, ${models.length} ${plural(models.length, 'модель', 'модели', 'моделей')}`
          : `${account.label}: подключено, список моделей пуст — проверьте ключ и адрес`,
        models.length ? 'info' : 'warn',
      );

      onDone();
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : 'Не удалось добавить подключение', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-4">
      <div>
        <p className="setting-name">Провайдер</p>
        <div className="preset-grid">
          {sortedPresets().map((item) => (
            <button
              key={item.id}
              type="button"
              className="preset"
              data-on={form.presetId === item.id}
              aria-pressed={form.presetId === item.id}
              onClick={() => setForm(formFor(item.id))}
            >
              <span className="preset-dot" style={{ backgroundColor: item.accent }} aria-hidden="true" />
              <span className="preset-name">{item.name}</span>
            </button>
          ))}

          <button
            type="button"
            className="preset"
            data-on={form.presetId === CUSTOM_PROVIDER_ID}
            aria-pressed={form.presetId === CUSTOM_PROVIDER_ID}
            onClick={() => setForm(formFor(CUSTOM_PROVIDER_ID))}
          >
            <span className="preset-dot" aria-hidden="true" />
            <span className="preset-name">Свой провайдер</span>
          </button>
        </div>
      </div>

      <div className="field-grid">
        <label className="field-box">
          <span className="setting-name">Название</span>
          <input
            className="field"
            value={form.label}
            placeholder={preset?.name ?? 'Мой провайдер'}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </label>

        <label className="field-box">
          <span className="setting-name">Ключ</span>
          <span className="field-inline">
            <input
              className="field field-mono"
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={preset?.keyHint ?? 'sk-…'}
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
            <button type="button" className="btn btn-quiet" onClick={() => setShowKey((value) => !value)}>
              {showKey ? 'скрыть' : 'показать'}
            </button>
          </span>
        </label>

        <label className="field-box field-wide">
          <span className="setting-name">Адрес сервера</span>
          <input
            className="field field-mono"
            value={form.baseUrl}
            spellCheck={false}
            placeholder="https://api.example.com/v1"
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </label>

        <label className="field-box">
          <span className="setting-name">Протокол</span>
          <select
            className="field field-mono"
            value={form.protocol}
            onChange={(event) => patch({ protocol: event.target.value as TransportProtocol })}
          >
            {PROTOCOLS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field-box">
          <span className="setting-name">Маршрут запросов</span>
          <select
            className="field field-mono"
            value={form.route}
            onChange={(event) => patch({ route: event.target.value as FormState['route'] })}
          >
            <option value="auto">как решит приложение</option>
            <option value="direct">напрямую из браузера</option>
            <option value="proxy">через серверные функции</option>
          </select>
        </label>
      </div>

      <div>
        <div className="row-between">
          <span className="setting-name">Свои заголовки</span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => patch({ headers: [...form.headers, { name: '', value: '' }] })}
          >
            добавить
          </button>
        </div>

        {form.headers.map((header, index) => (
          <div className="header-row" key={index}>
            <input
              className="field field-mono"
              value={header.name}
              placeholder="X-Header"
              spellCheck={false}
              onChange={(event) => {
                const next = [...form.headers];
                next[index] = { ...header, name: event.target.value };
                patch({ headers: next });
              }}
              aria-label="Имя заголовка"
            />
            <input
              className="field field-mono"
              value={header.value}
              placeholder="значение"
              spellCheck={false}
              onChange={(event) => {
                const next = [...form.headers];
                next[index] = { ...header, value: event.target.value };
                patch({ headers: next });
              }}
              aria-label="Значение заголовка"
            />
            <button
              type="button"
              className="btn btn-quiet btn-icon"
              aria-label="Убрать заголовок"
              onClick={() => patch({ headers: form.headers.filter((_, position) => position !== index) })}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}

        {preset?.extraHeaders && (
          <p className="setting-hint">
            Заголовки пресета уже добавлены: {Object.keys(preset.extraHeaders).join(', ')}
          </p>
        )}
      </div>

      <div className="setting-row">
        <div>
          <span className="setting-name">Профиль OpenCode</span>
          <p className="setting-hint">
            Выгружать подключение в {OPENCODE_FILE_NAME} и принимать его оттуда — тот же профиль, что
            используют OpenCode IDE и CLI.
          </p>
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          aria-checked={form.opencode}
          aria-label="Профиль OpenCode"
          onClick={() => patch({ opencode: !form.opencode })}
        />
      </div>

      {preset && (
        <p className="setting-hint">
          {preset.browserNote ?? 'Запросы из браузера разрешены провайдером.'}{' '}
          <a href={preset.docsUrl} target="_blank" rel="noreferrer">
            документация
          </a>{' '}
          ·{' '}
          <a href={preset.keysUrl} target="_blank" rel="noreferrer">
            где взять ключ
          </a>
        </p>
      )}

      <div className="row">
        <button type="button" className="btn btn-signal" disabled={busy} onClick={() => void submit()}>
          {busy ? 'подключаем…' : 'подключить'}
        </button>
        <span className="label">после подключения список моделей подтянется автоматически</span>
      </div>
    </div>
  );
}

function OpencodePanel() {
  const importOpencode = useAccounts((state) => state.importOpencode);
  const exportOpencode = useAccounts((state) => state.exportOpencode);
  const accounts = useAccounts((state) => state.accounts);
  const models = useAccounts((state) => state.models);
  const session = useChatStore((state) => state.sessions.find((item) => item.id === state.activeId));
  const [text, setText] = useState('');
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const exported = useMemo(
    () => exportOpencode({ includeKeys, defaultModelKey: session?.modelKey ?? null }),
    [exportOpencode, includeKeys, session?.modelKey],
  );

  const marked = accounts.filter((account) => account.opencode);

  async function runImport(value: string): Promise<void> {
    if (!value.trim()) {
      pushNotice('Вставьте содержимое opencode.json', 'warn');
      return;
    }

    setBusy(true);

    try {
      const report = await importOpencode(value);

      for (const notice of report.notices) pushNotice(notice, 'warn');

      pushNotice(
        report.added.length
          ? `Из профиля OpenCode: ${report.added.join(', ')} — ${report.models} ${plural(report.models, 'модель', 'модели', 'моделей')}`
          : 'Из профиля OpenCode ничего не добавлено',
        report.added.length ? 'info' : 'warn',
      );

      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap-4">
      <section>
        <p className="setting-name">Импорт профиля</p>
        <p className="setting-hint">
          Вставьте содержимое opencode.json из проекта или из домашней папки (
          <span className="mono">~/.config/opencode/opencode.json</span>). Подключения, адреса,
          заголовки, списки моделей и их лимиты перенесутся сюда.
        </p>

        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';

            if (file) {
              void file.text().then((value) => {
                setText(value);
                void runImport(value);
              });
            }
          }}
        />

        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={() => picker.current?.click()}>
            выбрать файл
          </button>
          <button type="button" className="btn btn-signal" disabled={busy} onClick={() => void runImport(text)}>
            {busy ? 'импортируем…' : 'импортировать'}
          </button>
          <span className="label">{formatBytes(new Blob([text]).size)} в буфере</span>
        </div>

        <textarea
          className="composer-input code-area"
          rows={6}
          value={text}
          spellCheck={false}
          placeholder='{ "provider": { … } }'
          onChange={(event) => setText(event.target.value)}
          aria-label="Содержимое opencode.json"
        />
      </section>

      <section>
        <div className="row-between">
          <div>
            <p className="setting-name">Экспорт профиля</p>
            <p className="setting-hint">
              {marked.length
                ? `${marked.length} ${plural(marked.length, 'подключение', 'подключения', 'подключений')} с включённым профилем`
                : 'Включите профиль OpenCode у нужных подключений'}
              {models.length > 0 && ` · ${models.length} ${plural(models.length, 'модель', 'модели', 'моделей')}`}
            </p>
          </div>

          <button
            type="button"
            className="btn btn-quiet"
            disabled={!marked.length}
            onClick={() => {
              saveText(OPENCODE_FILE_NAME, exported);
              pushNotice(`${OPENCODE_FILE_NAME} сохранён`, 'info');
            }}
          >
            скачать
          </button>
        </div>

        <div className="setting-row">
          <div>
            <span className="setting-name">Ключи текстом</span>
            <p className="setting-hint">
              По умолчанию вместо ключей подставляются ссылки на переменные окружения — файл можно
              держать в репозитории.
            </p>
          </div>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={includeKeys}
            aria-label="Включать ключи в файл"
            onClick={() => setIncludeKeys((value) => !value)}
          />
        </div>

        <pre className="code-preview">
          <code>{exported}</code>
        </pre>
      </section>
    </div>
  );
}

export function Providers({ initialView = 'list' }: { initialView?: ProvidersView }) {
  const [view, setView] = useState<ProvidersView>(initialView);
  const accounts = useAccounts((state) => state.accounts);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const engine = useChatStore((state) => state.engine);
  const session = sessions.find((item) => item.id === activeId) ?? null;
  const runtime = engine?.runtimeInfo().kind ?? 'none';

  return (
    <div className="stack gap-4">
      <div className="segmented" role="group" aria-label="Раздел провайдеров">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            data-on={view === item.id}
            aria-pressed={view === item.id}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'list' && (
        <div className="stack gap-3">
          {accounts.length === 0 && (
            <p className="rail-empty">
              Подключений нет. Добавьте провайдера или импортируйте профиль OpenCode.
            </p>
          )}

          <ul className="account-list">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </ul>

          {session && (
            <p className="setting-hint">
              Разговор «{session.title}»: {describeSettings(session.settings)} ·{' '}
              {runtime === 'none' ? 'песочница не запускалась' : `исполнение: ${runtime}`}
            </p>
          )}

          <button type="button" className="btn btn-wide" onClick={() => setView('add')}>
            добавить подключение
          </button>
        </div>
      )}

      {view === 'add' && <AddProvider onDone={() => setView('list')} />}
      {view === 'opencode' && <OpencodePanel />}
    </div>
  );
}
