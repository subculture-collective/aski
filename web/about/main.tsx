import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { families } from '../../shared/catalog.ts';
import { MastheadArt, Specimens } from './Specimens.tsx';
import './about.css';
// The page text is static HTML; only the lettering is drawn here, by the studio's own preview worker.
for (const element of document.querySelectorAll('[data-family-count]')) element.textContent = String(families.length);
createRoot(document.getElementById('mast-art')!).render(<StrictMode><MastheadArt /></StrictMode>);
createRoot(document.getElementById('specimens')!).render(<StrictMode><Specimens /></StrictMode>);
