import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';
import { API_BASE_URL } from './lib/apiConfig';
import App from './App';
import './index.css';

// The journal is deployed separately from the API on Render (see
// src/lib/apiConfig.ts). VITE_API_URL is required in production builds.
setBaseUrl(API_BASE_URL);

createRoot(document.getElementById('root')!).render(<App />);
