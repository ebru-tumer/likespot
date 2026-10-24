// Beğenilen şarkıları Spotify'dan çeker ve tarayıcıda önbelleğe alır.
import { getAccessToken, refresh } from './auth.js';
import { normalize, cleanTitle } from './players.js';

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

// Her kaynağın (spotify, youtube, playlist) listesi ayrı saklanır; aralarında geçiş yapılabilir.
const keyFor = provider => `${KEY_LIBRARY}.${provider}`;

// Eski sürümde tek bir liste vardı; onu kendi kaynağının anahtarına taşır.
function migrate() {
  const old = localStorage.getItem(KEY_LIBRARY);
  if (!old) return;
  try {
    const lib = JSON.parse(old);
    const key = keyFor(lib.provider || 'spotify');
    if (!localStorage.getItem(key)) localStorage.setItem(key, old);
  } catch { /* bozuk kayıt */ }
  localStorage.removeItem(KEY_LIBRARY);
}

export function loadCachedLibrary(provider) {
  migrate();
  try { return JSON.parse(localStorage.getItem(keyFor(provider))); } catch { return null; }
}

export function hasLibrary(provider) {
  return !!loadCachedLibrary(provider)?.tracks?.length;
}

// Spotify ve YouTube Music listelerini birleştirir; iki tarafta da olan şarkı bir kez alınır
// (Spotify'daki kaydı tercih edilir, çünkü albüm ve yıl bilgisi daha zengin).
export function mergeLibraries(spotifyTracks, youtubeTracks) {
  const key = t => `${normalize(cleanTitle(t.name))}|${normalize(t.artists[0])}`;
  const seen = new Set(spotifyTracks.map(key));
  return [...spotifyTracks, ...youtubeTracks.filter(t => !seen.has(key(t)))];
}

export function clearLibrary(provider) {
  localStorage.removeItem(keyFor(provider));
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

// provider: 'spotify' | 'youtube' | 'playlist'
export function saveLibrary(provider, tracks) {
  const library = { provider, fetchedAt: Date.now(), tracks };
  try {
    localStorage.setItem(keyFor(provider), JSON.stringify(library));
  } catch {
    // Çok büyük kütüphanelerde depolama dolabilir; oyun yine de çalışır.
  }
  return library;
}

// Kullanıcının kendi (ve ortak) çalma listeleri. Spotify geliştirici modunda başkasının
// listesinin şarkıları okunamadığı için sadece sahibi olunan ya da ortak listeler döner.
export async function fetchSpotifyPlaylists() {
  let me = null;
  try { me = (await api('/me')).id; } catch { /* profil okunamazsa hepsini göster */ }
  const lists = [];
  let next = '/me/playlists?limit=50';
  while (next) {
    const page = await api(next);
    for (const p of page.items || []) {
      if (!p) continue;
      if (me && p.owner?.id !== me && !p.collaborative) continue;
      lists.push({ id: p.id, name: p.name, count: (p.items || p.tracks)?.total ?? null });
    }
    next = page.next;
  }
  return lists;
}

export async function fetchSpotifyPlaylistTracks(id) {
  const tracks = [];
  let next = `/playlists/${id}/items?limit=50`;
  while (next) {
    const page = await api(next);
    for (const entry of page.items || []) {
      // Şubat 2026'dan beri alan adı "track" yerine "item".
      const track = entry.item || entry.track;
      if (track?.id && track.type === 'track') tracks.push(slimTrack({ added_at: entry.added_at, track }));
    }
    next = page.next;
  }
  return tracks;
}
