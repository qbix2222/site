import { useMemo } from 'react';
import { contextFillRatio } from '../core/economy';
import { endpointFor, routeLabel } from '../core/providers';
import { estimateMessageTokens } from '../core/tokens';
import { useAccounts } from '../store/accounts-store';
import { useBackend } from '../store/backend-store';
import { useChatStore } from '../store/chat-store';
import { useSettings } from '../store/settings-store';
import { duration, tokens, usd } from './format';

export function StatusStrip() {
  const messages = useChatStore((state) => state.messages);
  const usage = useChatStore((state) => state.usage);
  const status = useChatStore((state) => state.status);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const spend = useChatStore((state) => state.spendTotalUsd);
  const compact = useChatStore((state) => state.compact);
  const engine = useChatStore((state) => state.engine);
  const models = useAccounts((state) => state.models);
  const accounts = useAccounts((state) => state.accounts);
  const backend = useBackend((state) => state.status);
  const backendUrl = useSettings((state) => state.backendUrl);
  const providerRoute = useSettings((state) => state.providerRoute);

  const session = sessions.find((item) => item.id === activeId) ?? null;
  const model = models.find((item) => item.key === session?.modelKey) ?? null;
  const account = model ? accounts.find((item) => item.id === model.providerId) ?? null : null;

  const historyTokens = useMemo(
    () => messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0),
    [messages],
  );

  const context = model?.limits.context ?? 0;
  const fill = contextFillRatio(historyTokens, context);
  const cap = session?.spendCapUsd ?? null;
  const runtime = engine?.runtimeInfo().kind ?? 'none';

  const route = account
    ? routeLabel(endpointFor(account, { backendUrl, backendReady: backend.ready, route: providerRoute }))
    : 'нет подключения';

  return (
    <div className="status-strip">
      <span className="strip-item" title="Сколько токенов истории занимает окно контекста модели">
        контекст
        {context > 0 ? (
          <>
            <span className="meter" aria-hidden="true">
              <span className="meter-fill" data-warn={fill > 0.85} style={{ width: `${Math.round(fill * 100)}%` }} />
            </span>
            {tokens(historyTokens)}/{tokens(context)}
          </>
        ) : (
          '—'
        )}
      </span>

      {messages.length >= 10 && (
        <button
          type="button"
          className="btn btn-quiet strip-button"
          onClick={() => void compact()}
          disabled={status.phase !== 'idle'}
          title="Заменить раннюю историю краткой сводкой и освободить контекст"
        >
          сжать историю
        </button>
      )}

      <span className="strip-item">
        {usage ? (
          <>
            вход {tokens(usage.inputTokens)} · выход {tokens(usage.outputTokens)}
            {usage.cachedInputTokens > 0 && <> · кэш {tokens(usage.cachedInputTokens)}</>}
            {usage.reasoningTokens > 0 && <> · думы {tokens(usage.reasoningTokens)}</>}
            {usage.durationMs > 0 && <> · {duration(usage.durationMs)}</>}
            {usage.attempts > 1 && <> · попыток {usage.attempts}</>}
            <strong className="strip-cost">{usd(usage.costUsd)}</strong>
          </>
        ) : (
          'ход ещё не завершён'
        )}
      </span>

      <span className="strip-item strip-right" title="Потрачено по всем разговорам по ценам моделей">
        {cap !== null && cap > 0 ? `${usd(spend)} из ${usd(cap)}` : usd(spend)}
      </span>

      <span className="strip-item" title="Как ходят запросы к провайдеру">
        {route}
        {providerRoute !== 'direct' && !backend.ready && ' · бэкенд не отвечает'}
      </span>

      <span className="strip-item" title="Исполнение кода">
        {runtime === 'webcontainer' ? 'песочница node' : runtime === 'local' ? 'локальный js' : 'без исполнения'}
      </span>
    </div>
  );
}
