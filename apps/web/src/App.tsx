import { Routes, Route, Link } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import Box from '@mui/material/Box';
import VideocamIcon from '@mui/icons-material/Videocam';
import DevicesPage from './pages/DevicesPage';
import DeviceDetailPage from './pages/DeviceDetailPage';

export default function App() {
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
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg">
        <Box sx={{ py: 3 }}>
          <Routes>
            <Route path="/" element={<DevicesPage />} />
            <Route path="/devices/:id" element={<DeviceDetailPage />} />
          </Routes>
        </Box>
      </Container>
    </>
  );
}
