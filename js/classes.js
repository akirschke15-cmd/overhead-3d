// Aircraft classes: which of the seven models an aircraft gets, in both the 3D view and
// ceiling mode. Kept free of three.js and the DOM so either page can import it.

/** @typedef {'light'|'turboprop'|'bizjet'|'narrow'|'wide'|'heavy4'|'heli'} AircraftClass */

export const CLASS_LABELS = {
  light: 'Light single',
  turboprop: 'Turboprop',
  bizjet: 'Business jet',
  narrow: 'Narrowbody',
  wide: 'Widebody',
  heavy4: 'Four-engine heavy',
  heli: 'Helicopter',
};

// Size relative to the narrowbody. Models are far larger than life so they read at 50 mi;
// this keeps a Cessna visibly smaller than a 747.
export const CLASS_SCALE = { light: 0.55, turboprop: 0.72, bizjet: 0.7, narrow: 1, wide: 1.3, heavy4: 1.5, heli: 0.6 };

const set = (s) => new Set(s.split(' '));
const EXACT = [
  ['heli', set('R22 R44 R66 B06 B407 B412 B429 B430 B505 B212 B222 B230 BK17 S76 S92 S61 S70 H60 H47 H64 H500 UH1 UH60 UH72 A109 A119 A139 A169 A189 EXPL V22 MD52 MD60 G2CA')],
  ['heavy4', set('B741 B742 B743 B744 B748 B74S B74R BLCF A342 A343 A345 A346 A388 IL96 IL76 C5M C17 K35R K35E E3TF E3CF E6 B52 A124 A400')],
  ['wide', set('B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X A306 A30B A310 A332 A333 A338 A339 A359 A35K MD11 DC10 KC10 K46')],
  ['bizjet', set('CL30 CL35 CL60 GLF2 GLF3 GLF4 GLF5 GLF6 GL5T GL7T GLEX G150 G280 GA5C GA6C GALX ASTR F2TH F900 FA50 FA7X FA8X FA6X E50P E55P E545 E550 E35L H25A H25B H25C HA4T PC24 BE40 PRM1 HDJT SF50 EA50 C25A C25B C25C C25M C500 C501 C510 C525 C550 C551 C560 C56X C650 C680 C68A C700 C750 LJ24 LJ31 LJ35 LJ40 LJ45 LJ55 LJ60 LJ70 LJ75')],
  ['turboprop', set('DH8A DH8B DH8C DH8D AT43 AT45 AT46 AT72 AT73 AT75 AT76 B190 B350 BE20 BE30 BE9L BE9T BE99 C208 C212 PC12 PC6T TBM7 TBM8 TBM9 SF34 E120 E121 SW3 SW4 P180 C130 C30J C2 E2 P3 P8 DHC6 DHC7 M600 P46T PAY1 PAY2 PAY3 PAY4 C441 C425 MU2 JS31 JS32 JS41 D328 KODI EPIC TEX2 V10')],
  ['narrow', set('B712 B721 B722 B731 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM B752 B753 A318 A319 A320 A321 A19N A20N A21N BCS1 BCS3 E170 E75L E75S E190 E195 E290 E295 E135 E145 E45X CRJ1 CRJ2 CRJ7 CRJ9 CRJX MD81 MD82 MD83 MD87 MD88 MD90 DC93 DC95 F100 F70 RJ85 RJ1H B461 B462 B463')],
  ['light', set('C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C195 C206 C207 C210 C72R C82R C77R P28A P28B P28R P28T P32R P32T PA18 PA22 PA24 PA28 PA32 PA34 PA44 PA46 SR20 SR22 S22T BE33 BE35 BE36 BE55 BE58 BE76 DA20 DA40 DA42 DA62 M20P M20T AA5 GLAS RV6 RV7 RV8 RV9 RV10 RV12 RV14 DV20 C310 C340 C414 C421 CH7A BL8 TAMP TOBA TRIN')],
];
// Families the exact lists miss (new variants, military designators).
const PATTERNS = [
  ['heli', /^(EC\d\d|H1\d\d|AS\d\d|UH\d|AH\d|MH\d|CH\d|S\d\d$)/],
  ['heavy4', /^(B74|A34|A38)/],
  ['wide', /^(B76|B77|B78|A30|A33|A35)/],
  ['narrow', /^(B73|B3\dM|B75|A31|A32|A2\dN|E17|E19|E29|CRJ|MD8|BCS)/],
  ['bizjet', /^(GLF|GL\dT|LJ\d|C5\d\d|C6\d\d|C7\d\d|C25|FA\d|F9|F2T|H25|E5\d)/],
  ['turboprop', /^(DH8|AT\d|TBM|PAY|PC12|BE[239]\d?[0L]$|B350|C130)/],
  ['light', /^(C1\d\d|P28|PA\d|SR2|RV\d|DA\d|M20|BE[35]\d)/],
];
// ADS-B emitter category. A2 spans regional turboprops and bizjets; bizjet is the more
// common A2 in this airspace. A4 (high vortex) is the 757.
const BY_CATEGORY = { A1: 'light', A2: 'bizjet', A3: 'narrow', A4: 'narrow', A5: 'wide', A6: 'bizjet', A7: 'heli' };

/**
 * ICAO type code first, then emitter category, then the narrowbody.
 * @param {string|null|undefined} typeCode
 * @param {string|null|undefined} category
 * @returns {AircraftClass}
 */
export function classOf(typeCode, category) {
  const t = (typeCode || '').toUpperCase();
  if (t) {
    for (const [cls, codes] of EXACT) if (codes.has(t)) return cls;
    for (const [cls, re] of PATTERNS) if (re.test(t)) return cls;
  }
  return BY_CATEGORY[category] || 'narrow';
}

/** True when the type code alone decided the class. For checking coverage against a real poll. */
export function typeIsKnown(typeCode) {
  const t = (typeCode || '').toUpperCase();
  return !!t && (EXACT.some(([, codes]) => codes.has(t)) || PATTERNS.some(([, re]) => re.test(t)));
}

// Plausible types per simulated route, so sim mode exercises every model.
export const SIM_TYPES = {
  dcaArr: ['B738', 'A319', 'A320', 'E75L', 'CRJ7', 'CRJ9', 'A321', 'B38M'],
  dcaDep: ['B738', 'A319', 'A320', 'E75L', 'CRJ7', 'CRJ9', 'A321', 'B38M'],
  iadArr: ['B772', 'B789', 'A333', 'A359', 'B744', 'A388', 'B738', 'A320', 'E75L', 'GLF5', 'C56X'],
  iadDep: ['B77W', 'B788', 'A332', 'A359', 'B748', 'A388', 'B739', 'A20N', 'CRJ7', 'CL35', 'DH8D'],
  bwi: ['B737', 'B738', 'B38M', 'A320', 'DH8D', 'AT76'],
  cruise: ['B738', 'A321', 'B763', 'B77L', 'B748', 'A359', 'MD11', 'GLF6', 'C750', 'B789'],
  hold: ['B739', 'A320', 'E75L', 'CRJ9', 'B772'],
  ga: ['C172', 'SR22', 'P28A', 'PC12', 'C208', 'BE36'],
  heli: ['EC35', 'B407', 'S76', 'H60', 'UH1'],
};

// Top-down silhouettes for ceiling mode: right half only, nose at -y, about 22 units of
// wingspan for the narrowbody. Each is mirrored to make the left half.
export const SILHOUETTES = {
  narrow: [[0, -11], [1.5, -7.5], [1.7, -1.8], [10.2, 3.2], [10.2, 4.6], [2, 4.3], [1.7, 6], [4.8, 9.4], [4.8, 10.3], [1, 9.3], [0.7, 10.4]],
  wide: [[0, -12], [2, -8], [2.2, -2.5], [4.2, -0.6], [4.4, 0.8], [11.5, 4.4], [11.5, 5.8], [2.5, 4.6], [2.1, 7], [5.4, 10.2], [5.4, 11.2], [1.2, 10.2], [0.8, 11.6]],
  heavy4: [[0, -12.5], [2.1, -8.5], [2.3, -3], [4, -1.4], [4.2, 0], [7.2, 1], [7.4, 2.4], [12, 5.2], [12, 6.6], [2.6, 4.8], [2.2, 7.4], [5.8, 10.6], [5.8, 11.6], [1.3, 10.6], [0.9, 12]],
  bizjet: [[0, -10], [1.1, -6.5], [1.3, 0.5], [8, 4.2], [8, 5.4], [1.5, 4.2], [1.5, 5.2], [2.9, 5.4], [2.9, 8], [1.4, 8], [1.2, 9], [4.2, 10.6], [4.2, 11.4], [0.6, 10.6]],
  turboprop: [[0, -10], [1.3, -7], [1.5, -1.6], [3.6, -1.6], [3.6, -4.2], [4.6, -4.2], [4.6, -1.6], [10.5, -1], [10.5, 0.6], [1.5, 1.2], [1.3, 7], [4.4, 8.6], [4.4, 9.8], [0.6, 10]],
  light: [[0, -8], [1, -6.6], [1.2, -3.2], [9.5, -3], [9.5, -0.8], [1.2, -0.4], [0.9, 5], [3.4, 5.6], [3.4, 7], [0.5, 7.2]],
  // helicopter: fuselage and tail boom only; the rotor disc is drawn as a circle
  heli: [[0, -7], [2, -5.5], [2.4, -1], [1.6, 2.5], [0.6, 3.5], [0.5, 9.5], [2.2, 9.8], [2.2, 10.8], [0, 11]],
};
