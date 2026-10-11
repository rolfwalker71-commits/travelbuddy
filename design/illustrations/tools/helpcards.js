'use strict';
// Texte der Hilfekarten (Deutsch, Schweizer Rechtschreibung). Werden nach shared/illustrations/help-cards.json geschrieben.
// `label` entspricht dem Schild an der Station im Bild; `marker` der Nummernmarke.
module.exports = [
  {
    id: 'help-share',
    title: 'So kommt ein PDF in die Reise',
    summary: 'Buchungsbestätigungen als PDF teilen oder hochladen. Der Server liest sie aus und schlägt Ereignisse vor, die du bestätigst.',
    steps: [
      { marker: 1, label: 'TEILEN', title: 'Teilen', text: 'Teile das PDF aus Mail oder Dateien mit TravelBuddy, oder ziehe es im Web in die Reise.' },
      { marker: 2, label: 'AUSWERTEN', title: 'Auswerten', text: 'Der Server liest Text und Daten aus dem Dokument. Das Original bleibt als Anhang erhalten.' },
      { marker: 3, label: 'PRÜFEN', title: 'Prüfen', text: 'Erkannte Buchungen erscheinen als gestrichelte Vorschläge, getrennt von bestätigten Ereignissen. Prüfe die Felder.' },
      { marker: 4, label: 'ÜBERNOMMEN', title: 'Übernommen', text: 'Nach dem Bestätigen gilt das Ereignis in Plan und Heute und liegt in der Reisemappe.' },
    ],
  },
  {
    id: 'help-settle',
    title: 'So wird in der Reisekasse ausgeglichen',
    summary: 'Ausgaben erfassen, Salden ansehen, Zahlungen vorschlagen lassen und als beglichen markieren.',
    steps: [
      { marker: 1, label: 'ERFASSEN', title: 'Erfassen', text: 'Trage Betrag, Währung und Bezahlende ein, am besten mit Beleg.' },
      { marker: 2, label: 'SALDO', title: 'Saldo', text: 'Die Kasse rechnet alle gegeneinander auf: Plus bekommt Geld, Minus schuldet Geld.' },
      { marker: 3, label: 'AUSGLEICH', title: 'Ausgleich', text: 'TravelBuddy schlägt wenige direkte Zahlungen vor, damit alle Salden aufgehen.' },
      { marker: 4, label: 'BEGLICHEN', title: 'Beglichen', text: 'Markiere eine Zahlung als erledigt, sobald sie überwiesen ist. Danach steht die Kasse auf null.' },
    ],
  },
  {
    id: 'help-today',
    title: 'So funktioniert Heute',
    summary: 'Heute zeigt, was als Nächstes ansteht, den Tagesverlauf, offene Aufgaben und Fristen sowie neue Vorschläge.',
    steps: [
      { marker: 1, label: 'NÄCHSTES', title: 'Nächstes', text: 'Die dunkle Karte zeigt das nächste Ereignis mit Countdown und Ortszeit.' },
      { marker: 2, label: 'TAGESBAND', title: 'Tagesband', text: 'Das Band zeigt alle Ereignisse des Tages in zeitlicher Reihenfolge. Die Marke steht für jetzt.' },
      { marker: 3, label: 'FRISTEN', title: 'Fristen', text: 'Offene Aufgaben und anstehende Storno- oder Zahlungsfristen stehen direkt darunter.' },
      { marker: 4, label: 'PRÜFEN', title: 'Prüfen', text: 'Neue Vorschläge werden gezählt. Tippe darauf, um sie zu prüfen.' },
    ],
  },
  {
    id: 'help-timezones',
    title: 'Zeiten und Zeitzonen',
    summary: 'Zeiten gelten in der Zone des Ortes, an dem etwas stattfindet. Ohne Zusatz gilt die Zone der Reise.',
    steps: [
      { marker: 1, label: 'ABFLUG', title: 'Abflug', text: 'Die Abflugzeit gilt in der Zone des Abflughafens, zum Beispiel 14:05 Ortszeit Zürich.' },
      { marker: 2, label: 'ZEITVERSATZ', title: 'Zeitversatz', text: 'Bei Flügen über Zeitzonen rechnet TravelBuddy Dauer und Ankunft automatisch um, zum Beispiel -6 h.' },
      { marker: 3, label: 'ANKUNFT', title: 'Ankunft', text: 'Die Ankunft steht in der Ortszeit des Ziels, zum Beispiel 17:35 Ortszeit Miami.' },
      { marker: 4, label: 'ORTSZEIT', title: 'Ortszeit', text: 'Zeiten ohne Zusatz gelten in der Zone der Reise. Weicht sie ab, steht «Ortszeit» dabei.' },
    ],
  },
  {
    id: 'help-invite',
    title: 'Mitreisende einladen',
    summary: 'Mitreisende per Link oder mit Konto einladen. Alle Eingeladenen sehen die Reise und können in der Reisekasse mitrechnen.',
    steps: [
      { marker: 1, label: 'EINLADEN', title: 'Einladen', text: 'Öffne in der Reise «Mitreisende» und wähle Link oder Konto.' },
      { marker: 2, label: 'LINK', title: 'Link', text: 'Teile den Link oder den QR-Code. Wer ihn öffnet, sieht die Reise ohne eigenes Konto.' },
      { marker: 3, label: 'KONTO', title: 'Konto', text: 'Mitreisende mit eigenem Konto bleiben dauerhaft dabei und erhalten die Reise auf allen Geräten.' },
      { marker: 4, label: 'DABEI', title: 'Dabei', text: 'Eingeladene lassen sich Ereignissen und der Reisekasse zuordnen.' },
    ],
  },
  {
    id: 'help-review',
    title: 'Vorschläge prüfen',
    summary: 'Jeder Vorschlag nennt seine Herkunft. Von Hand gesetzte Felder bleiben gesperrt, bis du bestätigst oder ablehnst.',
    steps: [
      { marker: 1, label: 'FUNDSTELLE', title: 'Fundstelle', text: 'Zu jedem Vorschlag gehört das Dokument. Die markierten Zeilen zeigen, woher ein Wert stammt.' },
      { marker: 2, label: 'HERKUNFT', title: 'Herkunft', text: 'Gefüllter Punkt: aus dem Dokument gelesen. Ring: von Hand eingetragen.' },
      { marker: 3, label: 'GESPERRT', title: 'Gesperrt', text: 'Von Hand gesetzte Felder sind mit einem Schloss gesperrt und werden bei neuen Auswertungen nie überschrieben.' },
      { marker: 4, label: 'BESTÄTIGT', title: 'Bestätigt', text: 'Mit «Bestätigen» wird der Vorschlag zum Ereignis. «Ablehnen» entfernt ihn.' },
    ],
  },
];
