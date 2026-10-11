'use strict';
// Mitteilungsbilder 1200 x 600: ein grosses Hauptmotiv, ruhiger Grund, Sicherheitsrand links/rechts (je 140 px).
const P = require('../lib/props');
const O = require('../lib/objects');
const T = require('../lib/things');
const I = require('../lib/icons');
const { mix } = require('../lib/util');

const SAFE = [150, 70, 150, 60];
const bgOf = pal => (pal.name === 'light' ? pal.surface2 : pal.bg);
const def = (id, title, alt, usage, build, setup = {}) => ({ id, kind: 'notification', title, alt, usage, width: 1200, height: 600, build, setup: { pad: SAFE, bg: bgOf, ...setup } });
const lineOf = pal => (pal.name === 'light' ? pal.ink : pal.bg);

/** Ruhiger Sockel: flache Scheibe. */
function base(s, r) {
  s.add(s.cyl(0, 0, -0.9, r, 0.9, s.m.ground, { sw: 1.1, sh: 0 }), 'ground');
}
/** Sonne bzw. Mond als Bildschirmscheibe hinter dem Motiv (Pixelposition im Bild). */
function disc(s, x, y, r) {
  const pal = s.pal;
  let svg = '';
  if (pal.name === 'light') svg += s.circle(x, y, r * 1.28, { fill: pal.accent, op: 0.12, stroke: null }) + s.circle(x, y, r, { fill: pal.accent, stroke: null });
  else svg += s.circle(x, y, r * 1.28, { fill: pal.ink, op: 0.06, stroke: null }) + s.circle(x, y, r, { fill: pal.ink, op: 0.92, stroke: null }) + s.circle(x + r * 0.36, y - r * 0.16, r * 0.86, { fill: bgOf(pal), stroke: null });
  s.raw(svg, 'bg');
}
/** Stehendes Ticket mit Einkerbungen: Kopfband, Perforation, Strichcode. */
function bigTicket(s, pal, cx, y, z0, w, h, head, label, sub) {
  const L = lineOf(pal), m = s.m;
  const x0 = cx - w / 2, r = 0.9, pts = [];
  pts.push([x0, z0], [x0 + w, z0], [x0 + w, z0 + h / 2 - r]);
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 - (i / 8) * Math.PI; pts.push([x0 + w + Math.cos(a) * r, z0 + h / 2 + Math.sin(a) * r]); }
  pts.push([x0 + w, z0 + h], [x0, z0 + h], [x0, z0 + h / 2 + r]);
  for (let i = 0; i <= 8; i++) { const a = Math.PI / 2 - (i / 8) * Math.PI; pts.push([x0 + Math.cos(a) * r, z0 + h / 2 + Math.sin(a) * r]); }
  const t = T.cutout(s, pts, y, 0.5, m.card, { sw: 1.5, sh: 0.8 });
  const f = s.frame([0, y, 0], [1, 0, 0], [0, 0, 1], 1, 1);
  let r_ = s.fPoly(f, [[x0, z0 + h * 0.7], [x0 + w, z0 + h * 0.7], [x0 + w, z0 + h], [x0, z0 + h]], { fill: head, stroke: null });
  r_ += s.fText(f, label, x0 + w * 0.36, z0 + h * 0.8, h * 0.13, { align: 'center', stroke: pal.onAccent, sw: 2.2 });
  r_ += s.fLine(f, [[x0 + w * 0.72, z0 + 0.5], [x0 + w * 0.72, z0 + h * 0.68]], { stroke: pal.mute, sw: 1.6, dash: '4 4' });
  r_ += s.fText(f, sub, x0 + w * 0.36, z0 + h * 0.36, h * 0.2, { align: 'center', stroke: pal.ink, sw: 2.4 });
  for (let i = 0; i < 6; i++) r_ += s.fLine(f, [[x0 + w * (0.78 + i * 0.035), z0 + h * 0.18], [x0 + w * (0.78 + i * 0.035), z0 + h * 0.58]], { stroke: pal.ink, sw: i % 2 ? 1.6 : 3 });
  t.svg += r_;
  return t;
}

// Heute (Morgenbriefing 07:30)
function notifToday(s, pal) {
  const m = s.m;
  disc(s, 360, 300, 150);
  base(s, 6.4);
  const cw = 7.6, ch = 8.6, cx = -3.4, cy = -1.0;
  const cal = T.cutout(s, [[cx, 0.4], [cx + cw, 0.4], [cx + cw, 0.4 + ch], [cx, 0.4 + ch]], cy, 0.7, m.card, { sw: 1.5, sh: 1 });
  const f = s.frame([0, cy, 0.4], [1, 0, 0], [0, 0, 1], 1, 1);
  cal.svg += s.fPoly(f, [[cx, ch - 2.2], [cx + cw, ch - 2.2], [cx + cw, ch], [cx, ch]], { fill: pal.accent, stroke: null })
    + s.fText(f, 'HEUTE', cx + cw / 2, ch - 1.55, 0.85, { align: 'center', stroke: pal.onAccent, sw: 2.2 })
    + s.fText(f, '11', cx + cw / 2, 2.0, 3.6, { align: 'center', stroke: pal.ink, sw: 4 })
    + s.fText(f, '07:30', cx + cw / 2, 0.8, 0.8, { align: 'center', stroke: pal.mute, sw: 1.8 });
  s.add(cal);
  s.add(s.group([s.cyl(3.0, 2.8, 0, 1.3, 1.9, m.card, { sh: 0, sw: 1.3 }), s.cyl(3.0, 2.8, 1.9, 1.0, 0.12, m.ink, { sh: 0, sw: 1 })]));
}

// Abflug
function notifDepart(s, pal) {
  const m = s.m;
  disc(s, 900, 140, 85);
  base(s, 6.2);
  s.add(bigTicket(s, pal, -0.4, -0.8, 0.4, 12, 7.0, pal.accent, 'ABFLUG', '14:05'));
  s.add(I.toyPlane(s, 4.8, 3.6, 0.6, 1.6));
  s.add(P.suitcase(s, -6.4, 1.6, 0, 2.8, 1.6, 2.3, m.type('ship')));
}

// Unterkunft
function notifStay(s, pal) {
  const m = s.m;
  base(s, 6.4);
  s.add(bigTicket(s, pal, 0, -1.8, 0.4, 11, 6.6, m.type('stay').left, 'CHECK-IN', '15:00'));
  s.add(I.keyFlat(s, -4.4, 3.8, 0, 1.0));
}

// Abholung Mietwagen
function notifPickup(s, pal) {
  const m = s.m;
  base(s, 7.2);
  s.add(O.car(s, -4.2, -3.2, 0, { mat: m.accent, suv: true, rails: true, len: 7.8, wid: 3.3 }));
  s.add(I.keyFlat(s, -3.4, 4.2, 0, 0.9));
}

// Frist
function notifDeadline(s, pal) {
  const m = s.m;
  base(s, 7.2);
  s.add(s.box(-2.9, -2.4, 0, 1.0, 1.0, 3.4, m.metal, { sw: 1.2, sh: 0.4 }));
  s.add(T.clockFace(s, -2.4, -1.8, 7.2, 4.2, 11, 55));
  const hx = 3.6, hy = 2.8;
  const hg = [s.cyl(hx, hy, 0, 1.9, 0.4, m.wood, { sh: 0, sw: 1.1 }), s.tube('z', 0.4, 2.8, hx, hy, 1.5, 0.3, m.glass, { sh: 0, sw: 1.1, noCap: true }),
    s.tube('z', 2.8, 5.2, hx, hy, 0.3, 1.5, m.glass, { sh: 0, sw: 1.1 }), s.cyl(hx, hy, 5.2, 1.9, 0.4, m.wood, { sh: 0, sw: 1.1 }), s.tube('z', 0.45, 1.7, hx, hy, 1.2, 0.1, m.type('stay'), { sh: 0, sw: 0.8, noCap: true })];
  s.add(s.group(hg, [hx - 2, hy - 2, 0, hx + 2, hy + 2, 5.7]));
  s.add(I.upCard(s, -5.8, 3.4, 0, 3.4, 3.9, m.card, (f, sc, w, h) => sc.fRect(f, 0, h - 1.1, w, h, { fill: pal.accent, stroke: null }) + sc.fText(f, '25', w / 2, 0.7, 1.6, { align: 'center', stroke: pal.ink, sw: 2.6 }), { sh: 0.4 }));
}

// Vorschläge prüfen
function notifReview(s, pal) {
  const m = s.m;
  base(s, 7.2);
  s.add(T.ticketCard(s, -6.4, -4.0, 0, 9.4, 4.6, { dashed: true, head: m.type('air'), t: 0.3 }));
  s.add(T.ticketCard(s, -5.6, 0.8, 0.4, 9.4, 4.6, { dashed: true, head: m.type('stay'), t: 0.3 }));
  s.add(I.magnifier(s, 3.4, 4.0, 4.4, 3.0));
  s.add(I.checkBadge(s, 5.6, -1.2, 2.6, 2.2));
}

module.exports = [
  def('notif-today', 'Heute', 'Aufgehende Sonne hinter einem grossen Tageskalenderblatt mit Datum und Uhrzeit 07:30 und einer Kaffeetasse: Morgenbriefing für den heutigen Tag.', 'notification:trip.today', notifToday),
  def('notif-depart', 'Abflug', 'Grosse Bordkarte mit Vermerk Abflug und Uhrzeit, darüber ein Flugzeug und daneben ein Koffer: Erinnerung an den Abflug.', 'notification:trip.depart', notifDepart),
  def('notif-stay', 'Unterkunft', 'Grosse Schlüsselkarte mit Vermerk Check-in und Uhrzeit, davor ein Hotelbett mit Nachttisch: Check-in oder Check-out.', 'notification:trip.stay', notifStay),
  def('notif-pickup', 'Mietwagen', 'Roter Mietwagen mit Dachreling und ein grosser liegender Schlüssel: Abholung des Mietwagens.', 'notification:trip.pickup', notifPickup),
  def('notif-deadline', 'Frist', 'Grosse Standuhr kurz vor zwölf, eine Sanduhr und ein Kalenderblatt mit rotem Kopfband: Storno- oder Zahlungsfrist läuft ab.', 'notification:trip.deadline', notifDeadline),
  def('notif-review', 'Vorschläge prüfen', 'Drei gestrichelte Vorschlagskarten übereinander mit einer grossen Lupe und einem grünen Haken: neue Vorschläge zum Prüfen.', 'notification:trip.review', notifReview),
];
