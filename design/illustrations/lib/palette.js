'use strict';
// Palette strikt aus docs/DESIGN.md. Alle Zwischentöne entstehen durch Mischen dieser Werte.
const { mix } = require('./util');

const TYPE_LIGHT = {
  air: '#D8452B', ship: '#1F4E5F', stay: '#B48A2B', car: '#5B8C5A', rail: '#3C6E8F', transfer: '#7A5C99',
  activity: '#C46A2D', food: '#A8433F', ticket: '#8A6F9E', safety: '#3F7A8C', doc: '#6F675A', task: '#6F675A',
};
const LIGHT = {
  name: 'light', bg: '#ECE5D7', surface: '#FBF8F1', surface2: '#F1EBDD', line: '#D4C9B4', ink: '#1D1B18', mute: '#6F675A',
  accent: '#D8452B', onAccent: '#FFFFFF', positive: '#2F7D4F', negative: '#B3261E', type: TYPE_LIGHT,
};
const TYPE_DARK = {};
for (const k of Object.keys(TYPE_LIGHT)) TYPE_DARK[k] = mix(TYPE_LIGHT[k], '#FFFFFF', 0.12);
const DARK = {
  name: 'dark', bg: '#151412', surface: '#1F1D1A', surface2: '#2A2723', line: '#3A362F', ink: '#F1EBDD', mute: '#A59C8B',
  accent: '#F0653F', onAccent: '#1A0E0A', positive: '#6FCF97', negative: '#F28B82', type: TYPE_DARK,
};

/** Drei Töne je Körper: top (Licht), left (Front), right (Schatten) + line (Kontur). */
function tones(pal, base, o = {}) {
  if (pal.name === 'light') {
    return {
      top: mix(base, pal.surface, o.lift ?? 0.4), left: base, right: mix(base, pal.ink, o.shade ?? 0.34), line: o.line || pal.ink,
    };
  }
  return {
    top: mix(base, pal.ink, o.lift ?? 0.06), left: mix(base, pal.bg, o.lite ?? 0.3), right: mix(base, pal.bg, o.shade ?? 0.58), line: o.line || pal.bg,
  };
}

function materials(pal) {
  const L = pal.name === 'light';
  const m = {};
  const T = pal.type;
  m.paper = L
    ? { top: pal.surface, left: mix(pal.surface2, pal.line, 0.45), right: mix(pal.line, pal.mute, 0.28), line: pal.ink }
    : { top: mix(pal.line, pal.mute, 0.28), left: pal.line, right: pal.surface2, line: pal.bg };
  m.stone = L
    ? { top: mix(pal.surface2, pal.line, 0.3), left: mix(pal.line, pal.mute, 0.15), right: mix(pal.line, pal.mute, 0.5), line: pal.ink }
    : { top: mix(pal.line, pal.mute, 0.12), left: mix(pal.surface2, pal.line, 0.6), right: mix(pal.surface, pal.surface2, 0.5), line: pal.bg };
  m.ink = tones(pal, L ? mix(pal.ink, pal.mute, 0.18) : mix(pal.surface2, pal.line, 0.5));
  m.mute = tones(pal, pal.mute);
  m.accent = tones(pal, pal.accent);
  m.glass = L
    ? { top: mix(T.ship, pal.surface, 0.78), left: mix(T.ship, pal.surface, 0.58), right: mix(T.ship, pal.surface, 0.34), line: pal.ink }
    : { top: mix(T.ship, pal.bg, 0.4), left: mix(T.ship, pal.bg, 0.62), right: mix(T.ship, pal.bg, 0.78), line: pal.bg };
  m.lit = L
    ? { top: mix(T.stay, pal.surface, 0.6), left: mix(T.stay, pal.surface, 0.4), right: mix(T.stay, pal.surface, 0.1), line: pal.ink }
    : { top: mix(T.stay, pal.ink, 0.15), left: T.stay, right: mix(T.stay, pal.bg, 0.3), line: pal.bg };
  m.metal = L
    ? { top: pal.surface, left: mix(pal.surface2, pal.mute, 0.2), right: mix(pal.line, pal.mute, 0.5), line: pal.ink }
    : { top: mix(pal.mute, pal.line, 0.45), left: mix(pal.line, pal.mute, 0.3), right: mix(pal.surface2, pal.line, 0.4), line: pal.bg };
  m.white = L
    ? { top: '#FFFFFF', left: pal.surface, right: mix(pal.surface2, pal.line, 0.5), line: pal.ink }
    : { top: mix(pal.ink, pal.mute, 0.1), left: mix(pal.ink, pal.mute, 0.45), right: mix(pal.mute, pal.line, 0.45), line: pal.bg };
  // Karten und Blätter: hell «Papier weiss», dunkel «Nachtpapier» (Text bleibt in ink lesbar)
  m.card = L
    ? { top: '#FFFFFF', left: pal.surface, right: mix(pal.surface2, pal.line, 0.5), line: pal.ink }
    : { top: mix(pal.surface2, pal.line, 0.55), left: pal.surface2, right: mix(pal.surface, pal.bg, 0.4), line: pal.bg };
  m.ground = L
    ? { top: pal.bg, left: mix(pal.bg, pal.line, 0.6), right: mix(pal.line, pal.mute, 0.25), line: pal.ink }
    : { top: mix(pal.surface2, pal.line, 0.55), left: pal.surface2, right: mix(pal.surface, pal.bg, 0.3), line: pal.bg };
  m.asphalt = L
    ? { top: mix(pal.line, pal.mute, 0.38), left: mix(pal.line, pal.mute, 0.55), right: mix(pal.mute, pal.ink, 0.35), line: pal.ink }
    : { top: mix(pal.surface2, pal.line, 0.55), left: mix(pal.surface, pal.surface2, 0.5), right: pal.surface, line: pal.bg };
  m.water = L
    ? { top: mix(T.ship, pal.surface, 0.5), left: mix(T.ship, pal.surface, 0.3), right: mix(T.ship, pal.ink, 0.15), line: T.ship }
    : { top: mix(T.ship, pal.bg, 0.35), left: mix(T.ship, pal.bg, 0.55), right: mix(T.ship, pal.bg, 0.72), line: pal.bg };
  m.wood = tones(pal, L ? mix(T.activity, pal.surface2, 0.35) : mix(T.activity, pal.bg, 0.2));
  m.type = k => tones(pal, T[k]);
  m.soft = k => tones(pal, mix(T[k], L ? pal.surface : pal.bg, 0.45));
  m.green = tones(pal, L ? mix(T.car, pal.surface, 0.1) : T.car);
  m.green2 = tones(pal, L ? mix(T.car, pal.ink, 0.15) : mix(T.car, pal.bg, 0.15));
  return m;
}

module.exports = { LIGHT, DARK, tones, materials };
