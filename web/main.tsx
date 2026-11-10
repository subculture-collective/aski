import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './style.css';
const confirmation = location.pathname === '/auth/confirm';
if (confirmation) history.replaceState(null, '', '/auth/confirm');
createRoot(document.getElementById('root')!).render(<StrictMode>{confirmation ? <main><h1>aski</h1><p>Sign-in confirmation is unavailable.</p><a href="/">Return to the studio</a></main> : <App />}</StrictMode>);
