export type Lang = 'NL' | 'FR' | 'EN';

export interface CompanionStrings {
  loading: string;
  linkInvalidTitle: string;
  linkInvalidBody: string;
  loadFailed: string;
  companionLabel: string;
  loggedNausea: string;
  loggedVomiting: string;
  loggedAnxious: string;
  undo: string;
  btnNausea: string;
  btnVomiting: string;
  btnAnxious: string;
  takePhoto: string;
  photoOk: string;
  photoFail: string;
  todayTitle: string;
  redFlagFallback: string;
  recentTitle: string;
  noLogs: string;
  nausea: string;
  vomiting: string;
  anxious: string;
  offlineSaved: string;
  language: string;
}

export const COMPANION_STRINGS: Record<Lang, CompanionStrings> = {
  NL: {
    loading: 'Laden...',
    linkInvalidTitle: 'Link verlopen of ongeldig',
    linkInvalidBody: 'Vraag het zorgteam van het ziekenhuis om een nieuwe link of QR-code.',
    loadFailed: 'Kon de pagina niet laden',
    companionLabel: 'AImesis begeleiding',
    loggedNausea: 'Misselijkheid genoteerd!',
    loggedVomiting: 'Braken genoteerd!',
    loggedAnxious: 'Angst genoteerd!',
    undo: 'Ongedaan maken',
    btnNausea: '🤢 Misselijk',
    btnVomiting: '🤮 Braken',
    btnAnxious: '😟 Angstig voor de behandeling',
    takePhoto: 'Foto nemen van medicatie of blad',
    photoOk: 'Foto ontvangen.',
    photoFail: 'Foto uploaden mislukt.',
    todayTitle: 'Medicatie tegen misselijkheid vandaag',
    redFlagFallback: 'Wanneer onmiddellijk het ziekenhuis bellen:',
    recentTitle: 'Laatste meldingen (7 dagen)',
    noLogs: 'Geen meldingen de afgelopen 7 dagen.',
    nausea: '🤢 Misselijk',
    vomiting: '🤮 Braken',
    anxious: '😟 Angstig',
    offlineSaved: 'Geen verbinding: opgeslagen op deze telefoon, wordt automatisch verstuurd zodra u online bent.',
    language: 'Taal',
  },
  FR: {
    loading: 'Chargement...',
    linkInvalidTitle: 'Lien expiré ou invalide',
    linkInvalidBody: "Demandez à l'équipe soignante de l'hôpital un nouveau lien ou un nouveau code QR.",
    loadFailed: 'Impossible de charger la page',
    companionLabel: 'Compagnon AImesis',
    loggedNausea: 'Nausée enregistrée !',
    loggedVomiting: 'Vomissement enregistré !',
    loggedAnxious: 'Anxiété enregistrée !',
    undo: 'Annuler',
    btnNausea: '🤢 Nausée',
    btnVomiting: '🤮 Vomissement',
    btnAnxious: '😟 Anxieux avant le traitement',
    takePhoto: "Prendre une photo des médicaments ou de la feuille",
    photoOk: 'Photo reçue.',
    photoFail: "Échec de l'envoi de la photo.",
    todayTitle: "Médicaments contre les nausées aujourd'hui",
    redFlagFallback: "Quand contacter immédiatement l'hôpital :",
    recentTitle: 'Derniers signalements (7 jours)',
    noLogs: 'Aucun signalement ces 7 derniers jours.',
    nausea: '🤢 Nausée',
    vomiting: '🤮 Vomissement',
    anxious: '😟 Anxieux',
    offlineSaved: "Hors ligne : enregistré sur ce téléphone, sera envoyé automatiquement dès que vous serez en ligne.",
    language: 'Langue',
  },
  EN: {
    loading: 'Loading...',
    linkInvalidTitle: 'Link expired or invalid',
    linkInvalidBody: 'Please ask the care team at the hospital for a new link or QR code.',
    loadFailed: 'Could not load the page',
    companionLabel: 'AImesis Companion',
    loggedNausea: 'Nausea logged!',
    loggedVomiting: 'Vomiting logged!',
    loggedAnxious: 'Anxiety logged!',
    undo: 'Undo',
    btnNausea: '🤢 Nausea',
    btnVomiting: '🤮 Vomiting',
    btnAnxious: '😟 Anxious before treatment',
    takePhoto: 'Take a photo of the medication or sheet',
    photoOk: 'Photo received.',
    photoFail: 'Photo upload failed.',
    todayTitle: "Today's anti-nausea medication",
    redFlagFallback: 'When to call the hospital immediately:',
    recentTitle: 'Recent logs (last 7 days)',
    noLogs: 'Nothing logged in the last 7 days.',
    nausea: '🤢 Nausea',
    vomiting: '🤮 Vomiting',
    anxious: '😟 Anxious',
    offlineSaved: 'Offline: saved on this phone, will be sent automatically when you are back online.',
    language: 'Language',
  },
};

export const isLang = (v: string | undefined | null): v is Lang => v === 'NL' || v === 'FR' || v === 'EN';
