export type Lang = 'NL' | 'FR' | 'EN';

interface CompanionStrings {
  language: string;
  locale: string;
  diary: string;
  heading: string;
  invitation: string;
  levelsLabel: string;
  levels: readonly [string, string, string, string];
  hints: readonly [string, string, string, string];
  save: string;
  saving: string;
  needLevel: string;
  vomitingButton: string;
  vomiting: string;
  nauseaToday: string;
  vomitingToday: string;
  todayDiary: string;
  empty: string;
  saved: string;
  undo: string;
  undone: string;
  offlineSaved: string;
  saveFailed: string;
  undoFailed: string;
  loading: string;
  invalidTitle: string;
  invalidBody: string;
  loadFailed: string;
  retry: string;
}

export const COMPANION_STRINGS: Record<Lang, CompanionStrings> = {
  EN: {
    language: 'Language', locale: 'en-GB', diary: 'Nausea diary',
    heading: 'Your care team cares.',
    invitation: 'Let them know how {name} is feeling.',
    levelsLabel: 'How much nausea right now?',
    levels: ['Not nauseous', 'A little nauseous', 'Quite nauseous', 'Very nauseous'],
    hints: ['Tummy feels OK', 'A bit off, easy to forget', 'Hard to ignore', 'Hard to think about anything else'],
    save: 'Save', saving: 'Saving…', needLevel: 'Choose a nausea level first.',
    vomitingButton: '{name} vomited', vomiting: 'Vomited',
    nauseaToday: 'Nausea reports today', vomitingToday: 'Vomiting today', todayDiary: "Today's diary",
    empty: 'No check-ins today yet.', saved: 'Saved {time} · {symptom}',
    undo: 'Undo', undone: 'Last entry removed.',
    offlineSaved: 'Saved on this phone. It will be sent when the connection returns.',
    saveFailed: 'Could not save this report. Please try again.',
    undoFailed: 'Could not undo this report. Please try again.',
    loading: 'Loading your diary…', invalidTitle: 'This link is no longer available',
    invalidBody: 'Ask your care team for a new link or QR code.',
    loadFailed: 'Could not load your diary.', retry: 'Try again',
  },
  NL: {
    language: 'Taal', locale: 'nl-BE', diary: 'Dagboek misselijkheid',
    heading: 'Je zorgteam leeft met je mee.',
    invitation: 'Laat weten hoe {name} zich voelt.',
    levelsLabel: 'Hoe misselijk op dit moment?',
    levels: ['Niet misselijk', 'Een beetje misselijk', 'Best misselijk', 'Heel misselijk'],
    hints: ['Buik voelt oké', 'Een beetje naar, makkelijk te vergeten', 'Moeilijk te negeren', 'Moeilijk om aan iets anders te denken'],
    save: 'Opslaan', saving: 'Bezig met opslaan…', needLevel: 'Kies eerst een niveau van misselijkheid.',
    vomitingButton: '{name} heeft overgegeven', vomiting: 'Overgegeven',
    nauseaToday: 'Meldingen misselijkheid vandaag', vomitingToday: 'Overgeven vandaag', todayDiary: 'Dagboek vandaag',
    empty: 'Vandaag nog geen meldingen.', saved: 'Opgeslagen {time} · {symptom}',
    undo: 'Ongedaan', undone: 'Laatste melding verwijderd.',
    offlineSaved: 'Opgeslagen op deze telefoon. Wordt verstuurd zodra er weer verbinding is.',
    saveFailed: 'Kon deze melding niet opslaan. Probeer opnieuw.',
    undoFailed: 'Kon deze melding niet ongedaan maken. Probeer opnieuw.',
    loading: 'Dagboek laden…', invalidTitle: 'Deze link is niet meer beschikbaar',
    invalidBody: 'Vraag je zorgteam om een nieuwe link of QR-code.',
    loadFailed: 'Kon je dagboek niet laden.', retry: 'Opnieuw proberen',
  },
  FR: {
    language: 'Langue', locale: 'fr-BE', diary: 'Journal des nausées',
    heading: 'Votre équipe soignante est à vos côtés.',
    invitation: 'Dites-lui comment se sent {name}.',
    levelsLabel: 'Quel niveau de nausée maintenant ?',
    levels: ['Pas de nausée', 'Un peu de nausée', 'Pas mal de nausée', 'Très forte nausée'],
    hints: ['Le ventre va bien', 'Un peu désagréable, facile à oublier', 'Difficile à ignorer', 'Difficile de penser à autre chose'],
    save: 'Enregistrer', saving: 'Enregistrement…', needLevel: 'Choisissez d’abord un niveau de nausée.',
    vomitingButton: '{name} a vomi', vomiting: 'A vomi',
    nauseaToday: 'Signalements de nausée aujourd’hui', vomitingToday: 'Vomissements aujourd’hui', todayDiary: 'Journal d’aujourd’hui',
    empty: 'Aucun signalement aujourd’hui.', saved: 'Enregistré à {time} · {symptom}',
    undo: 'Annuler', undone: 'Dernière entrée supprimée.',
    offlineSaved: 'Enregistré sur ce téléphone. Sera envoyé au retour de la connexion.',
    saveFailed: 'Impossible d’enregistrer ce signalement. Réessayez.',
    undoFailed: 'Impossible d’annuler ce signalement. Réessayez.',
    loading: 'Chargement du journal…', invalidTitle: 'Ce lien n’est plus disponible',
    invalidBody: 'Demandez un nouveau lien ou code QR à votre équipe soignante.',
    loadFailed: 'Impossible de charger votre journal.', retry: 'Réessayer',
  },
};
