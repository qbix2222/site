import { useEffect } from 'react';
import { useChatStore, type Notice } from '../store/chat-store';

const LIFETIME_MS = 7_000;

function Toast({ notice, onClose }: { notice: Notice; onClose(): void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [notice.id, onClose]);

  return (
    <div className={`toast toast-${notice.tone}`} role="status">
      <span
        className={
          notice.tone === 'danger' ? 'dot dot-dead' : notice.tone === 'warn' ? 'dot dot-busy' : 'dot dot-live'
        }
      />
      <span className="toast-text">{notice.text}</span>
      <button type="button" className="btn btn-quiet btn-icon toast-close" onClick={onClose} aria-label="Скрыть">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function Notices() {
  const notices = useChatStore((state) => state.notices);
  const dismiss = useChatStore((state) => state.dismiss);

  if (!notices.length) return null;

  return (
    <div className="toasts">
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} onClose={() => dismiss(notice.id)} />
      ))}
    </div>
  );
}
