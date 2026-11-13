import { useEffect, useState } from 'react';

/**
 * Admin appearance (D-069): Light (default), Dark or System. Stored per browser; a blocked store simply
 * falls back to Light. The choice is applied as `data-theme` on <html>, which switches the CSS tokens.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'gobye.admin.theme';
const listeners = new Set<(c: ThemeChoice) => void>();

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' || v === 'light' ? v : 'light';
  } catch {
    return 'light';
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  return choice === 'system' ? (systemDark() ? 'dark' : 'light') : choice;
}

export function applyTheme(choice: ThemeChoice = readTheme()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolveTheme(choice);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* storage blocked: the choice still applies for this visit */
  }
  applyTheme(choice);
  listeners.forEach((l) => l(choice));
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    listeners.add(setChoice);
    let mq: MediaQueryList | undefined;
    const onChange = () => readTheme() === 'system' && applyTheme('system');
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', onChange);
    } catch {
      /* no media queries (tests) */
    }
    return () => {
      listeners.delete(setChoice);
      mq?.removeEventListener('change', onChange);
    };
  }, []);
  return [choice, setTheme];
}
