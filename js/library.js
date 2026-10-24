// Beğenilen şarkıları Spotify'dan çeker ve tarayıcıda önbelleğe alır.
import { getAccessToken, refresh } from './auth.js';

const API = 'https://api.spotify.com/v1';
const KEY_LIBRARY = 'ls.library';

export async function api(path, options = {}, retried = false) {
  const url = path.startsWith('http') ? path : API + path;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${await getAccessToken()}`, ...options.headers },
  });
  if (res.status === 401 && !retried) {
    await refresh();
    return api(path, options, true);
  }
  if (res.status === 429) {
    const wait = Number(res.headers.get('Retry-After') || 2);
    await new Promise(r => setTimeout(r, wait * 1000));
    return api(path, options, retried);
  }
  if (res.status === 403) {
    throw new Error('Spotify bu hesaba izin vermiyor: site sahibinin seni Spotify uygulamasının kullanıcı listesine eklemesi gerekiyor (en fazla 5 kişi). Ekledikten sonra çıkış yapıp tekrar bağlan.');
  }
  if (!res.ok) throw new Error(`Spotify API hatası ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function slimTrack({ added_at, track }) {
  const images = track.album?.images || [];
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists.map(a => a.name),
    artistIds: track.artists.map(a => a.id),
    album: track.album?.name || '',
    year: parseInt(track.album?.release_date, 10) || null,
    image: (images[1] || images[0])?.url || '',
    duration: track.duration_ms,
    url: track.external_urls?.spotify || '',
    addedAt: added_at,
  };
}

export function loadCachedLibrary() {
  try { return JSON.parse(localStorage.getItem(KEY_LIBRARY)); } catch { return null; }
}

export function clearLibrary() {
  localStorage.removeItem(KEY_LIBRARY);
}

export async function fetchLikedSongs(onProgress) {
  const tracks = [];
  let next = '/me/tracks?limit=50';
  while (next) {
    const page = await api(next);
    for (const item of page.items) {
      if (item.track && item.track.id && item.track.type === 'track') tracks.push(slimTrack(item));
    }
    onProgress?.(tracks.length, page.total);
    next = page.next;
  }
  return saveLibrary('spotify', tracks);
}

// provider: 'spotify' | 'youtube'
export function saveLibrary(provider, tracks) {
  const library = { provider, fetchedAt: Date.now(), tracks };
  try {
    localStorage.setItem(KEY_LIBRARY, JSON.stringify(library));
  } catch {
    // Çok büyük kütüphanelerde depolama dolabilir; oyun yine de çalışır.
  }
  return library;
}
