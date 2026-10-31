import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pixform-theme';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** Follows the system theme until the user picks one; the choice is remembered. */
export function useTheme(): [Theme, () => void] {
  const [choice, setChoice] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(() => (media().matches ? 'dark' : 'light'));
  const theme = choice ?? system;

  useEffect(() => {
    const mq = media();
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setChoice(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable (private mode): the choice lasts for this session only */
    }
  }, [theme]);

  return [theme, toggle];
}
