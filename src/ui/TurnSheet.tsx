import type { PersonaId, TurnSettings, Verbosity } from '../core/types';
import { ECONOMY_PRESETS, applyEconomy, presetById } from '../core/economy';
import { describeSettings } from '../engine/model-options';
import { personas } from '../agent/instructions';
import { useAccounts } from '../store/accounts-store';
import { useChatStore } from '../store/chat-store';
import { Choice, NumberBox, Row, Section, Slider, Toggle } from './controls';
import { usd } from './format';

const personaList = Object.entries(personas) as Array<[PersonaId, { title: string; rules: string }]>;

type Effort = NonNullable<TurnSettings['reasoningEffort']>;

const EFFORTS: Array<{ id: Effort; label: string; title: string }> = [
  { id: 'off', label: 'выкл', title: 'Рассуждения не запрашиваем — быстрее и дешевле' },
  { id: 'low', label: 'мало', title: 'Короткие рассуждения, примерно 2 000 токенов' },
  { id: 'medium', label: 'средне', title: 'Умеренные рассуждения, примерно 6 000 токенов' },
  { id: 'high', label: 'глубоко', title: 'Глубокие рассуждения, примерно 16 000 токенов' },
];

const VERBOSITY: Array<{ id: Verbosity; label: string }> = [
  { id: 'low', label: 'кратко' },
  { id: 'medium', label: 'обычно' },
  { id: 'high', label: 'подробно' },
];

export function TurnSheet() {
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const update = useChatStore((state) => state.update);
  const models = useAccounts((state) => state.models);

  const session = sessions.find((item) => item.id === activeId) ?? null;

  if (!session) {
    return <p className="rail-empty">Откройте разговор, чтобы настроить его параметры.</p>;
  }

  const settings = session.settings;

  const patchSettings = (changes: Partial<TurnSettings>): void =>
    void update(session.id, { settings: { ...settings, ...changes } });

  return (
    <div className="stack gap-5">
      <Section
        title="Роль и указания"
        note="Указания этого разговора добавляются к правилам роли и действуют только здесь."
      >
        <Row name="Роль" hint={personas[session.persona].rules}>
          <select
            className="field"
            value={session.persona}
            onChange={(event) => void update(session.id, { persona: event.target.value as PersonaId })}
            aria-label="Роль модели"
          >
            {personaList.map(([id, persona]) => (
              <option key={id} value={id}>
                {persona.title}
              </option>
            ))}
          </select>
        </Row>

        <label className="field-box">
          <span className="setting-name">Свои указания</span>
          <textarea
            className="composer-input code-area"
            rows={4}
            value={session.instructions}
            placeholder="Например: отвечай таблицами, код пиши на TypeScript, файлы сохраняй в папку draft."
            onChange={(event) => void update(session.id, { instructions: event.target.value })}
          />
        </label>

        <label className="field-box">
          <span className="setting-name">Метки</span>
          <input
            className="field"
            value={session.tags.join(', ')}
            placeholder="работа, идеи"
            onChange={(event) =>
              void update(session.id, {
                tags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      </Section>

      <Section title="Модель и расход" note={`Сейчас: ${describeSettings(settings)}`}>
        <Row name="Модель разговора" hint="Если модель не принимает фото или не умеет инструменты, ход уходит на подходящую модель того же провайдера.">
          <select
            className="field field-mono"
            value={session.modelKey ?? ''}
            onChange={(event) => void update(session.id, { modelKey: event.target.value || null })}
            aria-label="Модель разговора"
          >
            <option value="">не выбрана</option>
            {models.map((model) => (
              <option key={model.key} value={model.key}>
                {model.name}
              </option>
            ))}
          </select>
        </Row>

        <div className="row preset-row">
          {ECONOMY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn-quiet"
              title={preset.hint}
              onClick={() => void update(session.id, { settings: applyEconomy(settings, preset.id) })}
            >
              {preset.title.toLowerCase()}
            </button>
          ))}
        </div>

        <Row name="Доля окна контекста" hint="Сколько окна модели разрешено занять историей до урезания ранних сообщений.">
          <Slider
            value={session.tokenBudgetRatio}
            min={0.4}
            max={0.98}
            step={0.02}
            label="Доля окна контекста"
            onChange={(next) => void update(session.id, { tokenBudgetRatio: next })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        </Row>

        <Row name="Лимит расходов" hint="После исчерпания лимита ходы в этом разговоре останавливаются. Пусто — без лимита.">
          <span className="row gap-2">
            <NumberBox
              value={session.spendCapUsd}
              min={0.05}
              max={1_000}
              label="Лимит расходов, доллары"
              placeholder="без лимита"
              onChange={(next) => void update(session.id, { spendCapUsd: next })}
            />
            {session.spendCapUsd !== null && <span className="label">до {usd(session.spendCapUsd)}</span>}
          </span>
        </Row>
      </Section>

      <Section
        title="Думает ли модель"
        note="Рассуждения стоят токенов и времени. Ограничьте их здесь, а не ждите, пока модель «думает вечно»."
      >
        <Row name="Глубина рассуждений" hint={presetById('balanced').hint}>
          <Choice<Effort>
            label="Глубина рассуждений"
            value={settings.reasoningEffort ?? 'off'}
            options={EFFORTS}
            onChange={(next) => patchSettings({ reasoningEffort: next })}
          />
        </Row>

        <Row name="Бюджет размышлений" hint="Точное число токенов на рассуждения вместо пресета. Работает у Anthropic и Google.">
          <span className="row gap-2">
            <Toggle
              on={settings.thinkingBudget !== null}
              label="Свой бюджет размышлений"
              onChange={(on) => patchSettings({ thinkingBudget: on ? 4_096 : null })}
            />
            {settings.thinkingBudget !== null && (
              <NumberBox
                value={settings.thinkingBudget}
                min={512}
                max={32_000}
                label="Бюджет размышлений в токенах"
                onChange={(next) => patchSettings({ thinkingBudget: next })}
              />
            )}
          </span>
        </Row>

        <Row name="Подробность ответа" hint="Передаётся провайдерам OpenAI как textVerbosity.">
          <Choice<Verbosity>
            label="Подробность ответа"
            value={settings.verbosity}
            options={VERBOSITY}
            onChange={(next) => patchSettings({ verbosity: next })}
          />
        </Row>

        <Row name="Потолок ответа" hint="Максимум токенов в одном ответе. Пусто — решает провайдер.">
          <NumberBox
            value={settings.maxOutputTokens}
            min={128}
            max={128_000}
            label="Потолок ответа в токенах"
            placeholder="без потолка"
            onChange={(next) => patchSettings({ maxOutputTokens: next })}
          />
        </Row>

        <Row name="Температура" hint="Выключите, чтобы провайдер подставил свою.">
          <span className="row gap-2">
            <Toggle
              on={settings.temperature !== null}
              label="Своя температура"
              onChange={(on) => patchSettings({ temperature: on ? 0.7 : null })}
            />
            {settings.temperature !== null && (
              <Slider
                value={settings.temperature}
                min={0}
                max={2}
                step={0.05}
                label="Температура"
                onChange={(next) => patchSettings({ temperature: next })}
                format={(value) => value.toFixed(2)}
              />
            )}
          </span>
        </Row>

        <Row name="Top-p" hint="Отсечение по накопленной вероятности; редко нужно вместе с температурой.">
          <span className="row gap-2">
            <Toggle
              on={settings.topP !== null}
              label="Свой top-p"
              onChange={(on) => patchSettings({ topP: on ? 0.95 : null })}
            />
            {settings.topP !== null && (
              <Slider
                value={settings.topP}
                min={0.1}
                max={1}
                step={0.05}
                label="Top-p"
                onChange={(next) => patchSettings({ topP: next })}
                format={(value) => value.toFixed(2)}
              />
            )}
          </span>
        </Row>
      </Section>

      <Section title="Инструменты и среда" note="Каждый разговор хранит свои файлы; модель читает их, правит и добавляет свои.">
        <Row name="Шагов с инструментами" hint="Сколько вызовов инструментов разрешено за один ход. Меньше — дешевле и быстрее.">
          <Slider
            value={settings.maxToolRounds}
            min={1}
            max={24}
            step={1}
            label="Шагов с инструментами"
            onChange={(next) => patchSettings({ maxToolRounds: next })}
            format={(value) => `${value}`}
          />
        </Row>

        <Row name="Инструменты" hint="Чтение и правка файлов рабочей папки, поиск по ним, расчёты.">
          <Toggle on={settings.toolsEnabled} label="Инструменты" onChange={(next) => patchSettings({ toolsEnabled: next })} />
        </Row>

        <Row name="Рабочая папка" hint="Файлы разговора копируются в среду исполнения и доступны модели.">
          <Toggle
            on={settings.workspaceEnabled}
            label="Рабочая папка"
            disabled={!settings.toolsEnabled}
            onChange={(next) => patchSettings({ workspaceEnabled: next })}
          />
        </Row>

        <Row name="Исполнение кода" hint="Запуск JavaScript и, в песочнице WebContainer, команд node.">
          <Toggle
            on={settings.executionEnabled}
            label="Исполнение кода"
            disabled={!settings.toolsEnabled}
            onChange={(next) => patchSettings({ executionEnabled: next })}
          />
        </Row>

        <Row name="Поиск в интернете" hint="Инструменты web_search и web_read: модель сама решает, когда искать.">
          <Toggle
            on={settings.webEnabled}
            label="Поиск в интернете"
            disabled={!settings.toolsEnabled}
            onChange={(next) => patchSettings({ webEnabled: next })}
          />
        </Row>

        <Row name="Спрашивать разрешение" hint="Команды, меняющие окружение, и запись файлов ждут вашего подтверждения.">
          <Toggle
            on={settings.approvalRequired}
            label="Спрашивать разрешение"
            onChange={(next) => patchSettings({ approvalRequired: next })}
          />
        </Row>
      </Section>
    </div>
  );
}
