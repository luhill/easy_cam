import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from './App';

const app = <App />;

createRoot(document.getElementById('root')!).render(
  import.meta.env.DEV ? app : <StrictMode>{app}</StrictMode>
);
