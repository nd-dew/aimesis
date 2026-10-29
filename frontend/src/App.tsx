import React from 'react';
import { MobileCompanionPage } from './components/MobileCompanionPage';
import { PatientView } from './components/PatientView';
import { Tooltip } from './components/Tooltip';

// Routes: /m/:token (or #/m/:token) is the parent page; everything else is the single-patient view
// (/?patient=pt-noah picks another patient; there is no patient selector yet).
export const App: React.FC = () => {
  const path = window.location.pathname;
  const hash = window.location.hash;
  let companionToken: string | null = null;
  if (path.startsWith('/m/')) {
    companionToken = path.replace('/m/', '').split('/')[0];
  } else if (hash.startsWith('#/m/')) {
    companionToken = hash.replace('#/m/', '').split('/')[0];
  }

  if (companionToken) return <MobileCompanionPage token={companionToken} />;
  return (
    <>
      <PatientView />
      <Tooltip />
    </>
  );
};
