import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Avatar from '@mui/material/Avatar';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useLocale();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: () => api.auth.login(username, password),
    onSuccess,
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    loginMutation.mutate();
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'grey.100',
        px: 2,
      }}
    >
      <Paper component="form" onSubmit={handleSubmit} elevation={3} sx={{ p: 4, width: '100%', maxWidth: 360 }}>
        <Stack spacing={2} alignItems="center">
          <Avatar sx={{ bgcolor: 'primary.main' }}>
            <LockOutlinedIcon />
          </Avatar>
          <Typography variant="h5">{t('app.title')}</Typography>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {t('login.subtitle')}
          </Typography>
          <TextField
            label={t('login.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            autoFocus
            required
            autoComplete="username"
          />
          <TextField
            label={t('login.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            autoComplete="current-password"
          />
          {loginMutation.isError && (
            <Alert severity="error" sx={{ width: '100%' }}>
              {(loginMutation.error as Error).message}
            </Alert>
          )}
          <Button type="submit" variant="contained" fullWidth disabled={loginMutation.isPending}>
            {loginMutation.isPending ? t('login.signingIn') : t('login.signIn')}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
