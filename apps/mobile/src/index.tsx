import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.js';

const root = document.querySelector('#root');
if (root === null) {
  throw new Error('Lode mobile root is missing');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
