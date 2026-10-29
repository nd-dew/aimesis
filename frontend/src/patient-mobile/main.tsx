import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PatientMobileApp } from './PatientMobileApp';

const token = window.location.pathname.split('/')[2];
createRoot(document.getElementById('patient-root')!).render(
  <StrictMode><PatientMobileApp token={token} /></StrictMode>,
);
