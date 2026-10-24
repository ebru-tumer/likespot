// Hangi listelerden soru geleceği: beğenilen şarkılar ve/veya seçilen çalma listeleri.
// Seçim ve çalma listelerinin şarkıları her hesap için ayrı ayrı tarayıcıda saklanır.
import { loadCachedLibrary, mergeLibraries } from './library.js';

export const LIKED = 'liked';

const keySelection = p => `ls.sources.${p}`;
const keyLists = p => `ls.playlists.${p}`;
const keyTracks = (p, id) => `ls.pl.${p}.${id}`;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Tarayıcı depolama alanı doldu; daha az çalma listesi seçmeyi dene.');
  }
}

// Varsayılan: sadece beğenilen şarkılar.
export function getSelection(provider) {
  const sel = read(keySelection(provider));
  return Array.isArray(sel) && sel.length ? sel : [LIKED];
}

export function setSelection(provider, ids) {
  write(keySelection(provider), ids.length ? ids : [LIKED]);
}

// [{ id, name, count }] ya da hiç alınmadıysa null.
export function getPlaylists(provider) {
  return read(keyLists(provider));
}

export function savePlaylists(provider, lists) {
  write(keyLists(provider), lists);
}

export function getPlaylistTracks(provider, id) {
  return read(keyTracks(provider, id));
}

export function savePlaylistTracks(provider, id, tracks) {
  write(keyTracks(provider, id), tracks);
}

export function clearSources(provider) {
  for (const key of Object.keys(localStorage)) {
    if (key === keySelection(provider) || key === keyLists(provider) || key.startsWith(`ls.pl.${provider}.`)) {
      localStorage.removeItem(key);
    }
  }
}

// Seçili kaynakların şarkıları; aynı şarkı birden çok listede olsa da bir kez sayılır.
export function tracksFor(provider) {
  let tracks = [];
  for (const id of getSelection(provider)) {
    const part = id === LIKED ? loadCachedLibrary(provider)?.tracks : getPlaylistTracks(provider, id);
    if (part?.length) tracks = mergeLibraries(tracks, part);
  }
  return tracks;
}
