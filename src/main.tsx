import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useSettings } from './store/settings-store';
import './styles/base.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Не найден контейнер #root');
}

void useSettings.getState().boot();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
