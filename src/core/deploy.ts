export const APP_NAME = 'Пульт';

export const REPOSITORY_URL = 'https://github.com/qbix2222/site';

export const VERCEL_DEPLOY_URL =
  `https://vercel.com/new/clone?repository-url=${encodeURIComponent(REPOSITORY_URL)}` +
  '&project-name=pult&repository-name=pult';

export interface DeployEnvVar {
  name: string;
  note: string;
  required: boolean;
}

export const DEPLOY_ENV_VARS: DeployEnvVar[] = [
  { name: 'ALLOWED_ORIGIN', note: 'домен deployed сайта для CORS серверных функций', required: false },
  { name: 'BRAVE_API_KEY', note: 'поиск Brave, есть бесплатный тариф', required: false },
  { name: 'TAVILY_API_KEY', note: 'поиск Tavily, есть бесплатный тариф', required: false },
  { name: 'SERPER_API_KEY', note: 'выдача Google через Serper', required: false },
  { name: 'SEARXNG_URL', note: 'адрес своего экземпляра SearXNG', required: false },
  { name: 'PROXY_ALLOW_LOCAL', note: '«1» разрешает прокси на локальные адреса — только для разработки', required: false },
];

export const DEPLOY_STEPS: string[] = [
  'Нажмите «развернуть на Vercel» — репозиторий скопируется в ваш GitHub.',
  'Деплой соберёт сайт и поднимет серверные функции /api/search, /api/read, /api/provider.',
  'Скопируйте выданный домен в настройку «Адрес бэкенда», если открываете сайт с другого адреса.',
  'Переменные окружения не обязательны: без них поиск идёт через DuckDuckGo и открытые API.',
];
