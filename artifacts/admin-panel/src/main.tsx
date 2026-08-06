import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import './index.css';

setBaseUrl(import.meta.env.VITE_API_URL);

createRoot(document.getElementById('root')!).render(<App />);
