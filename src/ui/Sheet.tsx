import { useEffect, useRef, type ReactNode } from 'react';

export interface SheetProps {
  title: string;
  hint?: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Sheet({ title, hint, onClose, children, footer }: SheetProps) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', onKey);

    const focusable = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть" onClick={onClose} tabIndex={-1} />

      <section className="sheet sheet-bottom" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="sheet-grip" aria-hidden="true" />

        <header className="sheet-head">
          <div>
            <h2 className="sheet-title">{title}</h2>
            {hint && <p className="setting-hint">{hint}</p>}
          </div>

          <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} aria-label="Закрыть">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="sheet-body">{children}</div>

        {footer && <footer className="sheet-foot">{footer}</footer>}
      </section>
    </>
  );
}
