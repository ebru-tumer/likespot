// Listendeki her şarkının Deezer popülerlik puanını bulur; zorluklar buna göre şarkı seçer
// (Kolay en popüler beşte bir, İmkânsız en az bilinen beşte bir). Sonuçlar tarayıcıda saklanır.
import { jsonp } from './catalog.js';
import { normalize, cleanTitle } from './players.js';

const KEY = 'ls.popularity';
// Deezer sınırı 5 saniyede 50 istek; 3 paralel işçi ve aralarda bekleme ile altında kalınır.
const WORKERS = 3;
const DELAY_MS = 350;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

function save(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* depolama dolu */ }
}

const keyOf = t => `${normalize(t.artists[0])}|${normalize(cleanTitle(t.name))}`;

// Önbellekteki puanları şarkılara yazar: t.pop = puan (bulunamadıysa 0), hiç taranmadıysa undefined.
export function tagPopularity(tracks, map = load()) {
  for (const t of tracks) {
    const v = map[keyOf(t)];
    if (v !== undefined) t.pop = v;
  }
}

async function lookup(track) {
  const title = cleanTitle(track.name);
  // Oyun müziklerinde "sanatçı" oyunun adı; Deezer'da besteciyle aranır, albüm adıyla doğrulanır.
  const artist = track.composer || track.artists[0];
  const game = track.composer ? normalize(track.artists[0]) : '';
  // Deezer'ın artist:"…" track:"…" biçimi sonuç vermiyor; düz arama yapıp sonuçları eşleştiriyoruz.
  const q = encodeURIComponent(`${artist} ${title}`);
  let data = await jsonp(`https://api.deezer.com/search?q=${q}&limit=10`);
  if (data.error) {
    // Kota aşıldıysa biraz bekleyip bir kez daha dene.
    await sleep(5000);
    data = await jsonp(`https://api.deezer.com/search?q=${q}&limit=10`);
  }
  const results = data.data || [];
  const wantTitle = normalize(title);
  const wantArtist = normalize(artist);
  const titleOf = r => normalize(cleanTitle(r.title_short || r.title));
  // "Louis.F" ile "LouisF" gibi farklar için boşluksuz karşılaştırılır.
  const squash = s => s.replace(/ /g, '');
  const artistOk = r => {
    const a = squash(normalize(r.artist?.name));
    const w = squash(wantArtist);
    return (a && (a.includes(w) || w.includes(a))) || (game && normalize(r.album?.title).includes(game));
  };
  const best = results.find(r => artistOk(r) && titleOf(r) === wantTitle)
    || results.find(r => artistOk(r) && (titleOf(r).startsWith(wantTitle) || wantTitle.startsWith(titleOf(r))));
  return best?.rank || 0;
}

export async function fetchPopularity(tracks, onProgress) {
  const map = load();
  const todo = [];
  const seen = new Set();
  for (const t of tracks) {
    const k = keyOf(t);
    if (!(k in map) && !seen.has(k)) {
      seen.add(k);
      todo.push(t);
    }
  }
  if (!todo.length) return;
  let done = 0;
  const worker = async () => {
    while (todo.length) {
      const t = todo.shift();
      try {
        map[keyOf(t)] = await lookup(t);
      } catch {
        // Ağ hatası: bu şarkı sonraki açılışta yeniden denenir.
      }
      done++;
      if (done % 20 === 0 || !todo.length) {
        save(map);
        tagPopularity(tracks, map);
        onProgress?.(done, done + todo.length);
      }
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  save(map);
  tagPopularity(tracks, map);
  onProgress?.(done, done);
}
