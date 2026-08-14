import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { translations, type Locale } from './translations';

const STORAGE_KEY = 'hik-mgr:locale';

/**
 * Hebrew is the app's default locale (and therefore RTL by default) per
 * the product requirement — English is available as an explicit opt-in
 * via the switcher in the top bar. A previously chosen locale (persisted
 * in localStorage) always wins over that default on later visits.
 */
function detectDefaultLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'he' || stored === 'en') return stored;
  } catch {
    // localStorage unavailable (private browsing, disabled storage, etc.)
    // — fall through to the default below rather than throwing.
  }
  return 'he';
}

interface LocaleContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  setLocale: (locale: Locale) => void;
  /**
   * Looks up `key` in the current locale's dictionary and substitutes any
   * `{name}` placeholders from `vars`. Falls back to the English string
   * (then to the raw key itself) if the current locale is missing an
   * entry, so a translation gap degrades gracefully instead of crashing.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectDefaultLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal — the choice just won't persist across reloads.
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const template = translations[locale][key] ?? translations.en[key] ?? key;
      if (!vars) return template;
      return Object.entries(vars).reduce(
        (str, [name, value]) => str.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
        template
      );
    },
    [locale]
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: locale === 'he' ? 'rtl' : 'ltr', setLocale, t }),
    [locale, setLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}
