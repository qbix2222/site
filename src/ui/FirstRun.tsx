import { useState } from 'react';
import { hostOfUrl, sortedPresets, type AccountDraft } from '../core/providers';
import { VERCEL_DEPLOY_URL } from '../core/deploy';
import { pushNotice } from '../store/chat-store';
import { useAccounts } from '../store/accounts-store';
import { plural } from './format';

export function FirstRun({
  onOpenProviders,
  onOpenOpencode,
}: {
  onOpenProviders(): void;
  onOpenOpencode(): void;
}) {
  const addAccount = useAccounts((state) => state.addAccount);
  const modelsOf = useAccounts((state) => state.modelsOf);
  const presets = sortedPresets();
  const [presetId, setPresetId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  const preset = presets.find((item) => item.id === presetId) ?? null;

  async function connect(): Promise<void> {
    if (!preset) return;

    const key = apiKey.trim();

    if (!key && !preset.optionalKey) {
      pushNotice('Без ключа провайдер ответит отказом', 'warn');
      return;
    }

    setBusy(true);

    const draft: AccountDraft = {
      presetId: preset.id,
      label: preset.name,
      apiKey: key || preset.id,
      opencode: true,
    };

    try {
      const account = await addAccount(draft);
      const models = modelsOf(account.id);

      pushNotice(
        models.length
          ? `${account.label}: ${models.length} ${plural(models.length, 'модель доступна', 'модели доступны', 'моделей доступно')}`
          : `${account.label}: подключение добавлено, но моделей не видно — проверьте ключ`,
        models.length ? 'info' : 'warn',
      );

      setApiKey('');
      setPresetId(null);
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : 'Не удалось подключить провайдера', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="first-run">
      <p className="label">шаг первый</p>

      <h2 className="first-run-title">Подключите модель</h2>

      <p className="first-run-lede">
        Пульт говорит с провайдерами напрямую вашим ключом. Разговоры, файлы и настройки остаются в
        этом браузере: на сервер уходит только то, что вы сами туда отправляете.
      </p>

      <ul className="preset-list">
        {presets.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="preset-line"
              data-on={presetId === item.id}
              aria-pressed={presetId === item.id}
              onClick={() => setPresetId(presetId === item.id ? null : item.id)}
            >
              <span className="preset-dot" style={{ backgroundColor: item.accent }} aria-hidden="true" />
              <span className="preset-name">{item.name}</span>
              <span className="label mono preset-host">{hostOfUrl(item.baseUrl)}</span>
            </button>

            {presetId === item.id && (
              <div className="preset-form">
                <input
                  className="field field-mono"
                  type="password"
                  value={apiKey}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={item.keyHint ?? 'ключ провайдера'}
                  onChange={(event) => setApiKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connect();
                  }}
                  aria-label={`Ключ ${item.name}`}
                />

                <button type="button" className="btn btn-signal" disabled={busy} onClick={() => void connect()}>
                  {busy ? 'подключаем…' : 'подключить'}
                </button>

                <a className="btn btn-quiet" href={item.keysUrl} target="_blank" rel="noreferrer">
                  где взять ключ
                </a>

                <p className="setting-hint">
                  {item.browserNote ?? 'Ключ хранится только в этом браузере и уходит напрямую провайдеру.'}{' '}
                  <a href={item.docsUrl} target="_blank" rel="noreferrer">
                    документация провайдера
                  </a>
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="first-run-alt">
        <p className="label">или</p>
        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={onOpenOpencode}>
            импортировать opencode.json
          </button>
          <button type="button" className="btn btn-quiet" onClick={onOpenProviders}>
            свой провайдер
          </button>
          <a className="btn btn-quiet" href={VERCEL_DEPLOY_URL} target="_blank" rel="noreferrer">
            развернуть свой экземпляр
          </a>
        </div>
      </div>
    </div>
  );
}
