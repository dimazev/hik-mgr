import React, { useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';
import { LocaleProvider, useLocale } from './i18n/LocaleContext';

// Two emotion caches, one per writing direction — MUI/emotion needs the
// stylis RTL plugin active (flips left/right CSS properties like
// margin-left <-> margin-right) only when actually rendering RTL, so
// switching locale swaps which cache is active rather than trying to
// mutate one cache's plugin list at runtime.
const cacheLtr = createCache({ key: 'muiltr' });
const cacheRtl = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });

/**
 * Reads the active locale (Hebrew by default, see LocaleContext) and
 * builds the matching MUI theme direction + emotion cache, and keeps
 * <html dir/lang> in sync so native browser behavior (form field
 * alignment, scrollbars, etc.) follows suit too, not just MUI's own
 * components.
 */
function ThemedApp() {
  const { locale, dir } = useLocale();

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);

  const theme = useMemo(
    () =>
      createTheme({
        direction: dir,
        palette: {
          mode: 'light',
          primary: { main: '#1565c0' },
        },
      }),
    [dir]
  );

  return (
    <CacheProvider value={dir === 'rtl' ? cacheRtl : cacheLtr}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </CacheProvider>
  );
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ThemedApp />
      </LocaleProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
