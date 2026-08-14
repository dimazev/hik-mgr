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
import VideocamIcon from '@mui/icons-material/Videocam';
import LogoutIcon from '@mui/icons-material/Logout';
import DownloadIcon from '@mui/icons-material/Download';
import DevicesPage from './pages/DevicesPage';
import DeviceDetailPage from './pages/DeviceDetailPage';
import RecordingFilesPage from './pages/RecordingFilesPage';
import TasksPage from './pages/TasksPage';
import LoginPage from './pages/LoginPage';
import { api } from './api/client';

export default function App() {
  const queryClient = useQueryClient();
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
            hik-mgr
          </Typography>
          <Button color="inherit" size="small" startIcon={<DownloadIcon />} component={Link} to="/tasks" sx={{ mr: 2 }}>
            Tasks
          </Button>
          <Typography variant="body2" sx={{ mr: 2, opacity: 0.85 }}>
            {meQuery.data.username}
          </Typography>
          <Button color="inherit" size="small" startIcon={<LogoutIcon />} onClick={handleLogout}>
            Logout
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
