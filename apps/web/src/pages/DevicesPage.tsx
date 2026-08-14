import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import type { DeviceInput } from '@hik-mgr/shared';
import { api } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';

const emptyForm: DeviceInput = {
  name: '',
  host: '',
  port: 80,
  protocol: 'http',
  username: 'admin',
  password: '',
};

export default function DevicesPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: api.listDevices });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<DeviceInput>(emptyForm);

  const createMutation = useMutation({
    mutationFn: api.createDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setOpen(false);
      setForm(emptyForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteDevice,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('devices.title')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          {t('devices.addDevice')}
        </Button>
      </Stack>

      {devicesQuery.isError && (
        <Alert severity="error">{(devicesQuery.error as Error).message}</Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('devices.colName')}</TableCell>
              <TableCell>{t('devices.colHost')}</TableCell>
              <TableCell>{t('devices.colPort')}</TableCell>
              <TableCell>{t('devices.colProtocol')}</TableCell>
              <TableCell>{t('devices.colUsername')}</TableCell>
              <TableCell align="right">{t('devices.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(devicesQuery.data ?? []).map((d) => (
              <TableRow
                key={d.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/devices/${d.id}`)}
              >
                <TableCell>{d.name}</TableCell>
                <TableCell>{d.host}</TableCell>
                <TableCell>{d.port}</TableCell>
                <TableCell>{d.protocol}</TableCell>
                <TableCell>{d.username}</TableCell>
                <TableCell align="right">
                  <IconButton
                    aria-label={t('devices.deleteAria')}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(d.id);
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            {(devicesQuery.data ?? []).length === 0 && !devicesQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary">{t('devices.empty')}</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('devices.addDevice')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('devices.colName')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('devices.colHost')}
              placeholder="b22.kozow.com"
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              fullWidth
              required
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label={t('devices.colPort')}
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                fullWidth
              />
              <TextField
                label={t('devices.colProtocol')}
                select
                value={form.protocol}
                onChange={(e) => setForm({ ...form, protocol: e.target.value as 'http' | 'https' })}
                fullWidth
              >
                <MenuItem value="http">http</MenuItem>
                <MenuItem value="https">https</MenuItem>
              </TextField>
            </Stack>
            <TextField
              label={t('devices.colUsername')}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              fullWidth
            />
            <TextField
              label={t('devices.password')}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              fullWidth
              required
            />
            {createMutation.isError && (
              <Alert severity="error">{(createMutation.error as Error).message}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('devices.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!form.name || !form.host || !form.password || createMutation.isPending}
            onClick={() => createMutation.mutate(form)}
          >
            {t('devices.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
