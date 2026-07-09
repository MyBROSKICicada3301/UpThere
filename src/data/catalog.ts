// Catalog model: parses TLEs into per-object metadata used for search,
// filters, coloring and the detail panel. Heavy SGP4 math happens in the
// workers; here we only read numbers straight out of the TLE text columns.

import type { BriefSat } from '../api/keeptrack';

export const OBJ_TYPES = {
  PAYLOAD: 1,
  ROCKET_BODY: 2,
  DEBRIS: 3,
  UNKNOWN: 0,
} as const;

export type Regime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'OTHER';

export interface SatMeta {
  index: number; // position in every parallel array / GPU buffer
  noradId: string; // display id (alpha-5 kept as-is, e.g. "T0449")
  name: string;
  nameLower: string; // pre-lowered for search
  type: number; // OBJ_TYPES
  country: string;
  launchDate?: string;
  // orbital elements straight from TLE line 2
  inclinationDeg: number;
  eccentricity: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanMotion: number; // rev/day
  periodMin: number;
  apogeeKm: number; // altitude above surface
  perigeeKm: number;
  regime: Regime;
}

export interface Catalog {
  sats: SatMeta[];
  tles: string[]; // flat [l1,l2, l1,l2, ...] handed to workers
  countries: string[]; // distinct, sorted, for the filter dropdown
}

const EARTH_RADIUS_KM = 6378.137;
const MU = 398600.4418; // km^3/s^2

// The catalog mixes ISO codes, Space-Track owner codes, vehicle-registration
// letters and full names for the same country (e.g. F / FR / France).
// Normalize to one display name so the filter groups them correctly.
const COUNTRY_NAMES: Record<string, string> = {
  '??': 'Unknown',
  TBD: 'Unknown',
  AE: 'United Arab Emirates', UAE: 'United Arab Emirates',
  ALG: 'Algeria', DZ: 'Algeria',
  AO: 'Angola',
  AR: 'Argentina', ARGN: 'Argentina',
  AT: 'Austria',
  AU: 'Australia', AUS: 'Australia',
  AZ: 'Azerbaijan',
  B: 'Belgium', BEL: 'Belgium',
  BD: 'Bangladesh',
  BG: 'Bulgaria', BGR: 'Bulgaria', BGN: 'Bulgaria',
  BH: 'Bahrain',
  BM: 'Bermuda',
  BO: 'Bolivia',
  BR: 'Brazil', BRAZ: 'Brazil',
  BW: 'Botswana',
  BY: 'Belarus',
  CA: 'Canada',
  CH: 'Switzerland',
  CIS: 'CIS (former USSR)', SU: 'Soviet Union',
  CL: 'Chile',
  CN: 'China', PRC: 'China',
  CO: 'Colombia',
  CSFR: 'Czechoslovakia', CSSR: 'Czechoslovakia',
  CYM: 'Cayman Islands',
  CZ: 'Czechia',
  D: 'Germany', GER: 'Germany', DE: 'Germany',
  DEN: 'Denmark', DK: 'Denmark',
  DJ: 'Djibouti',
  E: 'Spain', ES: 'Spain', SPN: 'Spain', Spain: 'Spain',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  ESA: 'ESA', 'I-ESA': 'ESA',
  'ESA/JAXA': 'ESA / JAXA',
  ET: 'Ethiopia',
  F: 'France', FR: 'France', France: 'France',
  FI: 'Finland', FIN: 'Finland',
  GR: 'Greece', GREC: 'Greece',
  HK: 'Hong Kong', HKUK: 'Hong Kong (UK)',
  HR: 'Croatia',
  HU: 'Hungary', HUN: 'Hungary',
  I: 'Italy', IT: 'Italy',
  'I-ARAB': 'Arabsat',
  'I-EU': 'European Union',
  'I-EUM': 'EUMETSAT',
  'I-EUT': 'Eutelsat',
  'I-INM': 'Inmarsat',
  'I-INT': 'Intelsat',
  'I-NATO': 'NATO',
  'I-RASC': 'RascomStar',
  ID: 'Indonesia', INDO: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IN: 'India', IND: 'India',
  IR: 'Iran', IRAN: 'Iran',
  J: 'Japan', JP: 'Japan', JPN: 'Japan', Japan: 'Japan',
  JO: 'Jordan',
  KP: 'North Korea',
  KR: 'South Korea', SKOR: 'South Korea',
  KW: 'Kuwait',
  KZ: 'Kazakhstan',
  L: 'Luxembourg', LUXE: 'Luxembourg',
  LA: 'Laos',
  LT: 'Lithuania',
  MA: 'Morocco',
  MC: 'Monaco',
  MEX: 'Mexico', MX: 'Mexico',
  MN: 'Mongolia',
  MU: 'Mauritius',
  MY: 'Malaysia',
  N: 'Norway', NO: 'Norway', NOR: 'Norway',
  NETH: 'Netherlands', NL: 'Netherlands',
  NG: 'Nigeria',
  NZ: 'New Zealand', 'New Zealand': 'New Zealand',
  OM: 'Oman',
  P: 'Portugal', POR: 'Portugal',
  PE: 'Peru',
  PG: 'Papua New Guinea',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland', POL: 'Poland',
  QA: 'Qatar',
  ROM: 'Romania',
  RU: 'Russia', Russia: 'Russia',
  RWA: 'Rwanda',
  S: 'Sweden', SWED: 'Sweden',
  SA: 'Saudi Arabia', SAUD: 'Saudi Arabia',
  SB: 'Solomon Islands',
  SG: 'Singapore', SING: 'Singapore',
  SI: 'Slovenia',
  SK: 'Slovakia',
  T: 'Thailand', THAI: 'Thailand',
  TR: 'Türkiye', TURK: 'Türkiye',
  TW: 'Taiwan', TWN: 'Taiwan',
  UA: 'Ukraine',
  UK: 'United Kingdom', GB: 'United Kingdom',
  US: 'United States', USA: 'United States',
  UY: 'Uruguay',
  VE: 'Venezuela',
  VN: 'Vietnam',
  ZA: 'South Africa',
};

function normalizeCountry(raw: string | undefined): string {
  if (!raw) return 'Unknown';
  return COUNTRY_NAMES[raw] ?? raw; // unmapped codes shown as-is
}

export function classifyRegime(periodMin: number, ecc: number): Regime {
  if (ecc >= 0.25) return 'HEO';
  if (periodMin < 128) return 'LEO'; // apogee below ~2000 km
  if (periodMin >= 1300 && periodMin <= 1800) return 'GEO';
  if (periodMin < 1300) return 'MEO';
  return 'OTHER'; // super-synchronous / graveyard / deep space
}

/** Parse a brief-catalog record. Returns null if the TLE is malformed. */
function parseOne(sat: BriefSat, index: number): SatMeta | null {
  const l1 = sat.tle1;
  const l2 = sat.tle2;
  if (!l1 || !l2 || l1.length < 62 || l2.length < 63) return null;

  const inclinationDeg = parseFloat(l2.substring(8, 16));
  const raanDeg = parseFloat(l2.substring(17, 25));
  const eccentricity = parseFloat('0.' + l2.substring(26, 33).trim());
  const argPerigeeDeg = parseFloat(l2.substring(34, 42));
  const meanMotion = parseFloat(l2.substring(52, 63));
  if (!isFinite(meanMotion) || meanMotion <= 0) return null;

  const periodMin = 1440 / meanMotion;
  const periodSec = periodMin * 60;
  // semi-major axis from Kepler's third law
  const a = Math.cbrt((MU * periodSec * periodSec) / (4 * Math.PI * Math.PI));
  const apogeeKm = a * (1 + eccentricity) - EARTH_RADIUS_KM;
  const perigeeKm = a * (1 - eccentricity) - EARTH_RADIUS_KM;

  return {
    index,
    noradId: l1.substring(2, 7).trim(),
    name: sat.name || 'UNKNOWN',
    nameLower: (sat.name || 'unknown').toLowerCase(),
    type: sat.type ?? OBJ_TYPES.UNKNOWN,
    country: normalizeCountry(sat.country),
    launchDate: sat.launchDate,
    inclinationDeg,
    eccentricity,
    raanDeg,
    argPerigeeDeg,
    meanMotion,
    periodMin,
    apogeeKm,
    perigeeKm,
    regime: classifyRegime(periodMin, eccentricity),
  };
}

export function buildCatalog(raw: BriefSat[]): Catalog {
  const sats: SatMeta[] = [];
  const tles: string[] = [];
  const countrySet = new Set<string>();

  for (const r of raw) {
    const meta = parseOne(r, sats.length);
    if (!meta) continue;
    sats.push(meta);
    tles.push(r.tle1, r.tle2);
    countrySet.add(meta.country);
  }

  return { sats, tles, countries: [...countrySet].sort() };
}

/** Filter state → per-object visibility mask (1 = shown). O(n), run on change. */
export interface FilterState {
  types: Set<number>;
  regimes: Set<Regime>;
  country: string; // 'ALL' or a country code
  altMinKm: number;
  altMaxKm: number;
}

export const DEFAULT_FILTERS: FilterState = {
  types: new Set([1, 2, 3, 0]),
  regimes: new Set(['LEO', 'MEO', 'GEO', 'HEO', 'OTHER']),
  country: 'ALL',
  altMinKm: 0,
  altMaxKm: 500000,
};

export function computeVisibility(catalog: Catalog, f: FilterState): Uint8Array {
  const mask = new Uint8Array(catalog.sats.length);
  for (const s of catalog.sats) {
    mask[s.index] =
      f.types.has(s.type) &&
      f.regimes.has(s.regime) &&
      (f.country === 'ALL' || s.country === f.country) &&
      // orbit's altitude band [perigee, apogee] must overlap the filter band
      s.apogeeKm >= f.altMinKm &&
      s.perigeeKm <= f.altMaxKm
        ? 1
        : 0;
  }
  return mask;
}

export function searchCatalog(catalog: Catalog, query: string, limit = 20): SatMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SatMeta[] = [];
  // NORAD id exact/prefix match first
  for (const s of catalog.sats) {
    if (s.noradId.toLowerCase().startsWith(q)) {
      out.push(s);
      if (out.length >= limit) return out;
    }
  }
  for (const s of catalog.sats) {
    if (s.nameLower.includes(q) && !out.includes(s)) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}
