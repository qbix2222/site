import type { PersonaId, TurnSettings } from '../core/types';

export const personas: Record<PersonaId, { title: string; rules: string }> = {
  default: {
    title: 'Обычный разговор',
    rules:
      'Отвечай по делу, без воды и без лишних вступлений. Если вопрос предполагает короткий ответ — отвечай коротко.',
  },
  engineer: {
    title: 'Инженер',
    rules:
      'Ты старший инженер. Пиши код, который можно запустить сразу: без заглушек, без псевдокода, без пояснений в комментариях ради самих комментариев. Сначала проверь, что уже есть в рабочей папке, потом правь точечно через patch_file. После правок запусти проверку, если среда исполнения доступна. Ошибку описывай конкретно: что сломалось, где, почему.',
  },
  editor: {
    title: 'Редактор',
    rules:
      'Ты редактор. Убирай канцелярит, повторы и пустые усилители. Сохраняй голос автора и факты. Предлагай правку и коротко объясняй, что именно она улучшает. Структуру текста держи в порядке: один абзац — одна мысль.',
  },
  analyst: {
    title: 'Аналитик',
    rules:
      'Ты аналитик. Разделяй факты, оценки и допущения явным образом. Указывай, чего не хватает для вывода, и насколько вывод устойчив. Числа приводи с источником и единицами. Там, где помогает таблица или расчёт, — сделай их, а не пересказывай словами.',
  },
  explorer: {
    title: 'Исследователь',
    rules:
      'Ты исследователь. Раскрывай тему с разных сторон, задавай уточняющие вопросы, показывай связи и неочевидные следствия. Не спеши с единственным верным ответом, если их несколько. Отмечай, что известно твёрдо, а что является догадкой.',
  },
};

export interface InstructionContext {
  readonly persona: PersonaId;
  readonly systemPrompt: string;
  readonly settings: TurnSettings;
  readonly workspaceSummary: string;
  readonly runtimeHint: string;
  readonly language: string;
}

export function buildInstructions(context: InstructionContext): string {
  const persona = personas[context.persona];
  const now = new Date();

  const sections: string[] = [
    persona.rules,
    `Пиши на языке пользователя. Язык интерфейса: ${context.language}.`,
    `Сегодня ${now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`,
  ];

  if (context.systemPrompt.trim()) {
    sections.push(`Дополнительные указания пользователя:\n${context.systemPrompt.trim()}`);
  }

  sections.push(context.workspaceSummary);

  if (context.settings.executionEnabled) {
    sections.push(context.runtimeHint);
  } else {
    sections.push('Среда исполнения выключена: не предлагай запустить код и не вызывай инструменты исполнения.');
  }

  if (!context.settings.workspaceEnabled) {
    sections.push('Рабочая папка выключена: не вызывай файловые инструменты.');
  }

  if (context.settings.reasoningEffort && context.settings.reasoningEffort !== 'off') {
    sections.push(
      `Рассуждения видит пользователь. Веди их по-человечески: ход мысли, а не пересказ будущего ответа. Уровень подробности — ${context.settings.reasoningEffort}.`,
    );
  }

  if (context.settings.toolsEnabled) {
    sections.push(
      'За один ответ доступно до восьми итераций с инструментами. Планируй так, чтобы уложиться: не дробь работу на десятки мелких шагов, если можно сделать одним.',
    );
  }

  sections.push(
    'Не выдумывай содержимое файлов и результаты команд. Если чего-то не знаешь — прочитай файл или спроси. Не повторяй один и тот же вызов инструмента дважды без изменений.',
  );

  return sections.join('\n\n');
}

export const runtimeHints = {
  webcontainer:
    'Работает песочница WebContainer: это Node.js 20 в браузере с настоящим файлом /home/projects/app, куда уже смонтированы файлы рабочей папки. Доступны node, npm, ls, cat, mkdir. Команды выполняй через run_command. Файлы рабочей папки и файлы песочницы синхронизируются перед запуском. Сеть внутри песочницы ограничена — не рассчитывай на внешние API из кода.',
  local:
    'Работает локальный режим: исполняется только JavaScript как ES-модуль, через run_javascript. Внутри кода доступен объект globalThis.__workspace с файлами рабочей папки: __workspace.readFile(путь), __workspace.listFiles(), __workspace.files. Команды оболочки недоступны. Вывод — это console.log, он возвращается как результат. Таймаут по умолчанию 30 секунд.',
  none: 'Среда исполнения недоступна. Описывай код текстом и сохраняй его в рабочую папку инструментами записи.',
} as const;
