// Spotify Authorization Code + PKCE akışı (sunucu gerektirmez).
import { SPOTIFY_CLIENT_ID } from './config.js';

const SCOPES = [
  'user-library-read',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

const KEY_CLIENT = 'ls.clientId';
const KEY_TOKEN = 'ls.token';
const KEY_VERIFIER = 'ls.verifier';

export function redirectUri() {
  return location.origin + location.pathname;
}

export function getClientId() {
  return localStorage.getItem(KEY_CLIENT) || SPOTIFY_CLIENT_ID;
}

export function setClientId(id) {
  id = id.trim();
  if (id && id !== SPOTIFY_CLIENT_ID) localStorage.setItem(KEY_CLIENT, id);
  else localStorage.removeItem(KEY_CLIENT);
}

function readToken() {
  try { return JSON.parse(localStorage.getItem(KEY_TOKEN)); } catch { return null; }
}

function saveToken(data, prev) {
  const token = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev?.refresh_token,
    scope: data.scope || prev?.scope || '',
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  localStorage.setItem(KEY_TOKEN, JSON.stringify(token));
  return token;
}

// Eski girişlerde çalma listesi izni yok; o durumda yeniden bağlanmak gerekir.
export function hasPlaylistScope() {
  return (readToken()?.scope || '').includes('playlist-read-private');
}

export function isLoggedIn() {
  return !!readToken()?.refresh_token;
}

export function logout() {
  localStorage.removeItem(KEY_TOKEN);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Önce Spotify Client ID gir.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(KEY_VERIFIER, verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    redirect_uri: redirectUri(),
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token hatası (${res.status}): ${await res.text()}`);
  return res.json();
}

// Spotify'dan ?code=... ile dönüldüyse token'a çevirir. Dönüş yoksa false.
export async function handleRedirect() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;
  history.replaceState(null, '', redirectUri());
  if (error) throw new Error(`Spotify girişi iptal edildi: ${error}`);
  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: getClientId(),
    code_verifier: localStorage.getItem(KEY_VERIFIER) || '',
  });
  localStorage.removeItem(KEY_VERIFIER);
  saveToken(data);
  return true;
}

export async function getAccessToken() {
  const token = readToken();
  if (!token) throw new Error('Spotify oturumu yok.');
  if (Date.now() < token.expires_at) return token.access_token;
  return refresh();
}

export async function refresh() {
  const token = readToken();
  const data = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    client_id: getClientId(),
  });
  return saveToken(data, token).access_token;
}
