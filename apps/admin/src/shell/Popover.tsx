import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Button + popover panel (notifications, account menu). Closes on Escape (focus returns to the button),
 * on a click outside and when an item inside runs `close`.
 */
export function Popover({
  trigger,
  label,
  children,
  className = '',
}: {
  trigger: (p: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const id = `pop-${label.replace(/\W+/g, '-').toLowerCase()}`;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      (wrap.current?.querySelector('[aria-controls]') as HTMLElement | null)?.focus();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    // Move focus to the first control inside the panel.
    requestAnimationFrame(() => (wrap.current?.querySelector(`#${id} button, #${id} a`) as HTMLElement | null)?.focus());
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, id]);

  return (
    <div ref={wrap} style={{ position: 'relative' }} className={className}>
      {trigger({ open, toggle: () => setOpen((o) => !o), id })}
      {open ? (
        <div className="popover" id={id} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
