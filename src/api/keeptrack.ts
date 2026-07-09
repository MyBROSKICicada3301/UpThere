/**
 * KeepTrack v4 API client.
 *
 * All live positions are computed client-side with SGP4; the API is only
 * used to fetch the catalog's orbital elements in bulk (one request,
 * cached in IndexedDB). The rate-limited position/pass calculation
 * endpoints are never called.
 */

import { idbGet, idbSet } from '../data/idb';

const BASE = 'https://api.keeptrack.space/v4';
const KEY_STORAGE = 'kt-api-key';
const CATALOG_TTL_MS = 3 * 60 * 60 * 1000;

export interface BriefSat {
  tle1: string;
  tle2: string;
  name?: string;
  /** 1 = payload, 2 = rocket body, 3 = debris, undefined = analyst object */
  type?: number;
  country?: string;
  launchDate?: string;
  purpose?: string;
  rcs?: string;
  source?: string;
}

interface CachedCatalog {
  fetchedAt: number;
  sats: BriefSat[];
}

/** Build-time key (web) or key entered at first launch (desktop). */
export function getApiKey(): string | undefined {
  const envKey = import.meta.env.VITE_KT_API_KEY as string | undefined;
  if (envKey) return envKey;
  try {
    return localStorage.getItem(KEY_STORAGE) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('No KeepTrack API key configured');
    this.name = 'MissingApiKeyError';
  }
}

async function fetchBriefCatalog(): Promise<BriefSat[]> {
  const key = getApiKey();
  if (!key) throw new MissingApiKeyError();
  const res = await fetch(`${BASE}/sats/brief`, { headers: { 'X-API-Key': key } });
  if (!res.ok) throw new Error(`KeepTrack /sats/brief failed: HTTP ${res.status}`);
  return (await res.json()) as BriefSat[];
}

/**
 * Returns the catalog from IndexedDB when fresh, from the network otherwise.
 * Falls back to a stale cache if the network request fails.
 */
export async function loadCatalog(
  onStatus: (msg: string) => void,
): Promise<{ sats: BriefSat[]; fetchedAt: number }> {
  const cached = await idbGet<CachedCatalog>('catalog-brief');
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) {
    onStatus(`catalog from cache (${cached.sats.length} objects)`);
    return { sats: cached.sats, fetchedAt: cached.fetchedAt };
  }
  try {
    onStatus('downloading catalog…');
    const sats = await fetchBriefCatalog();
    const fetchedAt = Date.now();
    void idbSet('catalog-brief', { fetchedAt, sats } satisfies CachedCatalog);
    return { sats, fetchedAt };
  } catch (err) {
    if (cached && !(err instanceof MissingApiKeyError)) {
      onStatus('network failed, using stale cached catalog');
      return { sats: cached.sats, fetchedAt: cached.fetchedAt };
    }
    throw err;
  }
}
