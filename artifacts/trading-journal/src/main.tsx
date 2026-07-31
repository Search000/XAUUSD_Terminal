import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';

// The journal is deployed separately from the API on Render. Keep the
// environment variable override for other environments, but make the
// production deployment work even when Render does not inject it at build time.
const apiBaseUrl =
  import.meta.env.VITE_API_URL || 'https://xauusd-terminal-api-uq6u.onrender.com';

setBaseUrl(apiBaseUrl);

createRoot(document.getElementById('root')!).render(<App />);
