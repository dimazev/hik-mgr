import { useEffect } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import VideocamIcon from '@mui/icons-material/Videocam';
import LogoutIcon from '@mui/icons-material/Logout';
import DownloadIcon from '@mui/icons-material/Download';
import DevicesPage from './pages/DevicesPage';
import DeviceDetailPage from './pages/DeviceDetailPage';
import RecordingFilesPage from './pages/RecordingFilesPage';
import TasksPage from './pages/TasksPage';
import LoginPage from './pages/LoginPage';
import { api } from './api/client';
import { useLocale } from './i18n/LocaleContext';

/** EN/HE toggle in the top bar — switches LocaleContext, which drives both translated text and the RTL/LTR theme direction (see main.tsx). */
function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <ToggleButtonGroup
      value={locale}
      exclusive
      size="small"
      onChange={(_e, next) => next && setLocale(next)}
      sx={{ mx: 2, bgcolor: 'rgba(255,255,255,0.15)', '& .MuiToggleButton-root': { color: 'inherit', px: 1.25, py: 0.25 } }}
    >
      <ToggleButton value="he" aria-label="Hebrew">
        עב
      </ToggleButton>
      <ToggleButton value="en" aria-label="English">
        EN
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: api.auth.me, retry: false });

  // Any API call anywhere in the app that comes back 401 (session expired,
  // cookie cleared, etc.) dispatches this — drop back to the login page
  // instead of leaving pages stuck showing a generic fetch-error Alert.
  useEffect(() => {
    const handler = () => queryClient.setQueryData(['me'], null);
    window.addEventListener('hik-mgr:auth-expired', handler);
    return () => window.removeEventListener('hik-mgr:auth-expired', handler);
  }, [queryClient]);

  if (meQuery.isLoading) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!meQuery.data) {
    return <LoginPage onSuccess={() => queryClient.invalidateQueries({ queryKey: ['me'] })} />;
  }

  const handleLogout = async () => {
    await api.auth.logout();
    queryClient.setQueryData(['me'], null);
    // Clear out any device data cached while logged in, so a different
    // admin logging in afterward doesn't briefly see stale results.
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  };

  return (
    <>
      <AppBar position="static" color="primary" enableColorOnDark>
        <Toolbar>
          <VideocamIcon sx={{ mr: 1 }} />
          <Typography
            variant="h6"
            component={Link}
            to="/"
            sx={{ flexGrow: 1, textDecoration: 'none', color: 'inherit' }}
          >
            {t('app.title')}
          </Typography>
          <Button color="inherit" size="small" startIcon={<DownloadIcon />} component={Link} to="/tasks" sx={{ mr: 1 }}>
            {t('app.tasks')}
          </Button>
          <LanguageSwitcher />
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.85 }}>
            {meQuery.data.username}
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={handleLogout}>
            {t('app.logout')}
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg">
        <Box sx={{ py: 3 }}>
          <Routes>
            <Route path="/" element={<DevicesPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/devices/:id/recordings/files" element={<RecordingFilesPage />} />
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
          </Routes>
        </Box>
      </Container>
    </>
  );
}
