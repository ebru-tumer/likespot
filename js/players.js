// İki ses kaynağı:
//  - PreviewPlayer: iTunes'un 30 sn'lik önizlemesi, Web Audio ile milisaniye hassasiyetinde çalar.
//  - SpotifyPlayer: Spotify Web Playback SDK ile şarkının tamamından çalar (Premium gerekir).
import { getAccessToken } from './auth.js';
import { api } from './library.js';

export function normalize(text) {
  return (text || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Şarkı (feat. X) - Remastered 2011" -> "şarkı"
export function cleanTitle(title) {
  return (title || '')
    .replace(/\s*[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .trim() || title;
}

let audioCtx;
function ctx() {
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export class PreviewPlayer {
  constructor() {
    this.cache = new Map();
    this.source = null;
    this.volume = 0.9;
  }

  static async search(term, country) {
    const params = new URLSearchParams({ term, entity: 'song', limit: '15', country });
    const res = await fetch(`https://itunes.apple.com/search?${params}`);
    if (!res.ok) return [];
    return (await res.json()).results || [];
  }

  static score(result, track) {
    const want = normalize(cleanTitle(track.name));
    const got = normalize(cleanTitle(result.trackName));
    let title = 0;
    if (want === got) title = 3;
    else if (want && got && (got.startsWith(want) || want.startsWith(got))) title = 1;
    const artistName = normalize(result.artistName);
    const artist = track.artists.some(a => {
      const n = normalize(a);
      return n && (artistName.includes(n) || n.includes(artistName));
    }) ? 2 : 0;
    if (!title || !artist) return 0;
    // Remix, canlı, karaoke vb. sürümler istenmediyse orijinali tercih et.
    const variant = /\b(remix|live|acoustic|instrumental|karaoke|cover|sped up|slowed|mix)\b/;
    const penalty = variant.test(normalize(result.trackName)) && !variant.test(normalize(track.name)) ? 2 : 0;
    const exact = normalize(result.trackName) === normalize(track.name) ? 1 : 0;
    return Math.max(0.5, title + artist + exact - penalty);
  }

  async findPreview(track) {
    const term = `${track.artists[0]} ${cleanTitle(track.name)}`;
    for (const country of ['TR', 'US']) {
      const results = await PreviewPlayer.search(term, country);
      let best = null;
      let bestScore = 0;
      for (const r of results) {
        if (!r.previewUrl) continue;
        const s = PreviewPlayer.score(r, track);
        if (s > bestScore) { best = r; bestScore = s; }
      }
      if (best) return best;
    }
    return null;
  }

  // Şarkının önizlemesini indirip çözer. Bulunamazsa null döner.
  load(track) {
    const key = track.id;
    if (!this.cache.has(key)) {
      this.cache.set(key, (async () => {
        // Oyun müziklerinde önizleme adresi zaten bilinir; aramaya gerek yok.
        const match = track.preview ? { previewUrl: track.preview } : await this.findPreview(track);
        if (!match) return null;
        const res = await fetch(match.previewUrl);
        const buffer = await ctx().decodeAudioData(await res.arrayBuffer());
        return { buffer, match };
      })().catch(() => null));
    }
    return this.cache.get(key);
  }

  // Önizleme 30 sn: "start" önizlemenin başı, "random" içinden rastgele bir yer.
  async pickOffset(track, mode, maxClip) {
    const loaded = await this.load(track);
    if (!loaded || mode !== 'random') return 0;
    const room = Math.max(0, loaded.buffer.duration - maxClip - 0.5);
    return Math.random() * room;
  }

  async play(track, offset, seconds) {
    this.stop();
    const loaded = await this.load(track);
    if (!loaded) throw new Error('Önizleme bulunamadı.');
    const c = ctx();
    const gain = c.createGain();
    const src = c.createBufferSource();
    src.buffer = loaded.buffer;
    src.connect(gain).connect(c.destination);
    const t = c.currentTime + 0.02;
    const fade = Math.min(0.008, seconds / 4);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(this.volume, t + fade);
    gain.gain.setValueAtTime(this.volume, t + seconds - fade);
    gain.gain.linearRampToValueAtTime(0, t + seconds);
    src.start(t, offset, seconds);
    this.source = src;
    return new Promise(resolve => { src.onended = resolve; });
  }

  stop() {
    try { this.source?.stop(); } catch { /* zaten durmuş */ }
    this.source = null;
  }

  forget(track) {
    this.cache.delete(track.id);
  }
}

function loadSdk() {
  if (window.Spotify) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => reject(new Error('Spotify SDK yüklenemedi.'));
    document.head.appendChild(s);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class SpotifyPlayer {
  constructor() {
    this.player = null;
    this.deviceId = null;
    this.volume = 0.9;
    this.prepared = null; // { id, position }
    this.timer = null;
  }

  async init() {
    if (this.deviceId) return;
    await loadSdk();
    this.player = new window.Spotify.Player({
      name: 'LikeSpot',
      getOAuthToken: cb => getAccessToken().then(cb),
      volume: 0,
    });
    const ready = new Promise((resolve, reject) => {
      this.player.addListener('ready', ({ device_id }) => resolve(device_id));
      this.player.addListener('initialization_error', ({ message }) => reject(new Error(message)));
      this.player.addListener('authentication_error', ({ message }) => reject(new Error(message)));
      this.player.addListener('account_error', () => reject(new Error('Spotify Premium gerekiyor.')));
      setTimeout(() => reject(new Error('Spotify oynatıcısı zamanında hazır olmadı.')), 15000);
    });
    if (!(await this.player.connect())) throw new Error('Spotify oynatıcısına bağlanılamadı.');
    this.deviceId = await ready;
  }

  // Tarayıcının otomatik oynatma kısıtı için bir kullanıcı tıklamasında çağrılmalı.
  activate() {
    this.player?.activateElement?.();
  }

  async waitFor(check, timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const state = await this.player.getCurrentState();
      if (state && check(state)) return state;
      await sleep(120);
    }
    throw new Error('Spotify oynatıcısı yanıt vermedi.');
  }

  pickOffset(track, mode, maxClip) {
    const d = track.duration;
    if (mode === 'random') return Math.floor(d * 0.1 + Math.random() * Math.max(0, d * 0.75 - maxClip * 1000));
    return Math.floor(Math.min(d * 0.3, 60000));
  }

  // Şarkıyı sessizce yükleyip istenen konumda bekletir.
  async prepare(track, position) {
    await this.init();
    clearTimeout(this.timer);
    await this.player.setVolume(0);
    await api(`/me/player/play?device_id=${this.deviceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [track.uri], position_ms: position }),
    });
    await this.waitFor(s => !s.paused && s.track_window.current_track?.id && s.position > 0);
    await this.player.pause();
    await this.player.seek(position);
    this.prepared = { id: track.id, position };
  }

  async play(track, position, seconds) {
    if (this.prepared?.id !== track.id || this.prepared.position !== position) {
      await this.prepare(track, position);
    }
    clearTimeout(this.timer);
    await this.player.seek(position);
    await this.player.setVolume(this.volume);
    await this.player.resume();
    await new Promise(resolve => {
      this.endClip = resolve;
      this.timer = setTimeout(resolve, seconds * 1000);
    });
    await this.player.pause();
    await this.player.setVolume(0);
    await this.player.seek(position);
  }

  stop() {
    clearTimeout(this.timer);
    this.endClip?.();
  }
}
