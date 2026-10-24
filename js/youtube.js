// YouTube Music desteği. YouTube Music'te beğenilen şarkılar YouTube hesabındaki
// "beğenilen videolar" listesine de düşer; bu listeyi YouTube Data API ile okuruz.
// Giriş Google Identity Services ile tarayıcıda yapılır, sunucu gerekmez.
import { GOOGLE_CLIENT_ID } from './config.js';
import { saveLibrary } from './library.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const KEY_CLIENT = 'ls.googleClientId';
const KEY_TOKEN = 'ls.ytToken';

export function getGoogleClientId() {
  return localStorage.getItem(KEY_CLIENT) || GOOGLE_CLIENT_ID;
}

export function setGoogleClientId(id) {
  id = id.trim();
  if (id && id !== GOOGLE_CLIENT_ID) localStorage.setItem(KEY_CLIENT, id);
  else localStorage.removeItem(KEY_CLIENT);
}

let gisPromise;
// Google'ın giriş kütüphanesini önceden yükler; açılır pencere tıklamayla açılabilsin diye.
export function loadGoogle() {
  gisPromise ||= new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Google giriş kütüphanesi yüklenemedi.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

function readToken() {
  try { return JSON.parse(localStorage.getItem(KEY_TOKEN)); } catch { return null; }
}

export function hasValidToken() {
  const t = readToken();
  return !!t && Date.now() < t.expires_at;
}

export function logout() {
  localStorage.removeItem(KEY_TOKEN);
}

// Bir tıklama içinde çağrılmalı (Google giriş penceresini açar).
export function login() {
  const clientId = getGoogleClientId();
  if (!clientId) {
    return Promise.reject(new Error('YouTube Music bağlantısı henüz ayarlanmadı (Google Client ID eksik).'));
  }
  if (!window.google?.accounts?.oauth2) {
    loadGoogle();
    return Promise.reject(new Error('Google girişi hâlâ yükleniyor, birkaç saniye sonra tekrar dene.'));
  }
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: resp => {
        if (resp.error) return reject(new Error(`Google girişi başarısız: ${resp.error_description || resp.error}`));
        localStorage.setItem(KEY_TOKEN, JSON.stringify({
          access_token: resp.access_token,
          expires_at: Date.now() + (Number(resp.expires_in) - 60) * 1000,
        }));
        resolve();
      },
      error_callback: err => reject(new Error(err.type === 'popup_closed'
        ? 'Google giriş penceresi kapatıldı.'
        : `Google girişi açılamadı: ${err.message || err.type}`)),
    });
    client.requestAccessToken();
  });
}

const NOISE = /\s*[([][^)\]]*\b(official|lyrics?|audio|video|visuali[sz]er|klip|clip|mv|hd|4k|remaster(ed)?|resmi|şarkı sözleri)\b[^)\]]*[)\]]/gi;

function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || [];
  return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
}

// Bir YouTube videosunu şarkıya çevirir; müzik değilse null.
export function parseVideo(v) {
  const s = v.snippet || {};
  const channel = s.channelTitle || '';
  const topic = /\s-\sTopic$/.test(channel);
  if (!topic && s.categoryId !== '10') return null;

  let name = s.title || '';
  let artist;
  if (topic) {
    artist = channel.replace(/\s-\sTopic$/, '');
  } else {
    const cleaned = name.replace(NOISE, '').trim();
    const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const pipe = cleaned.match(/^(.+?)\s+\|\s+(.+)$/);
    if (dash) {
      [, artist, name] = dash;
      name = name.replace(/\s*\|.*$/, '');
    } else if (pipe) {
      [, artist, name] = pipe;
    } else {
      artist = channel.replace(/VEVO$|\s*Official$|\s*Resmi$/i, '').trim();
      name = cleaned;
    }
  }
  // "Şarkı ft. X" -> şarkı adı "Şarkı", X sanatçılara eklenir.
  const feat = name.match(/^(.+?)\s+(?:feat\.?|ft\.?)\s+(.+)$/i);
  if (feat) {
    name = feat[1];
    artist = `${artist}, ${feat[2]}`;
  }
  const artists = artist.split(/\s*,\s*|\s+(?:feat\.?|ft\.?)\s+/i).filter(Boolean);
  if (!name || !artists.length) return null;

  const thumbs = s.thumbnails || {};
  return {
    id: `yt-${v.id}`,
    uri: '',
    name: name.trim(),
    artists,
    artistIds: [],
    album: '',
    year: null,
    image: (thumbs.medium || thumbs.high || thumbs.default)?.url || '',
    duration: parseDuration(v.contentDetails?.duration),
    url: `https://music.youtube.com/watch?v=${v.id}`,
  };
}

export async function fetchYoutubeLikes(onProgress) {
  const token = readToken();
  if (!token || Date.now() >= token.expires_at) throw new Error('YouTube oturumunun süresi doldu, tekrar bağlan.');
  const tracks = [];
  let scanned = 0;
  let pageToken = '';
  do {
    const params = new URLSearchParams({ part: 'snippet,contentDetails', myRating: 'like', maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (res.status === 401) throw new Error('YouTube oturumunun süresi doldu, tekrar bağlan.');
    if (!res.ok) throw new Error(`YouTube API hatası ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const v of data.items || []) {
      const t = parseVideo(v);
      if (t) tracks.push(t);
    }
    scanned += (data.items || []).length;
    onProgress?.(scanned, data.pageInfo?.totalResults || scanned, tracks.length);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return saveLibrary('youtube', tracks);
}
