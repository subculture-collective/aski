import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { Confirm } from './Confirm.tsx';
import './style.css';
const confirmation = location.pathname === '/auth/confirm';
// Capture the sign-in token in memory, then remove the fragment before anything else runs.
const token = confirmation ? new URLSearchParams(location.hash.slice(1)).get('token') || '' : '';
if (confirmation) history.replaceState(null, '', '/auth/confirm');
createRoot(document.getElementById('root')!).render(<StrictMode>{confirmation ? <Confirm token={token} /> : <App />}</StrictMode>);
