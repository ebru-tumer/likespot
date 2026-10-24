// Şarkıların Türkçe mi yabancı mı olduğunu tahmin eder.
// 1) Başlık/sanatçıdaki Türkçe harf ve kelimeler, 2) sanatçının Spotify türleri (turkish pop, arabesk…).
// Bir sanatçının bir şarkısı Türkçe çıkarsa diğer şarkıları da Türkçe sayılır.
import { api } from './library.js';

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const TR_WORDS = new Set(`
  ben sen o biz siz bana sana beni seni benim senin onu bizi ne bu şu bir ve ile de da mi mı mu mü
  gibi için ama hep hiç her yok var değil olmaz olur gel git kal aşk ask aşkım askim kalbim kalp gönül
  sevda sevgili yar yarim gece gün dünya güzel guzel gözler gozler canım canim bebeğim bebegim
  yine artık artik kadar sonra önce sakın sakin dur bak söyle soyle sevmek seviyorum özledim ozledim
  yalan yalnız yalniz hayat ölüm olum deli divane bitti gidiyorum gidersen ağla agla ağlama aglama
  hasret ayrılık ayrilik keşke keske belki şimdi simdi bugün bugun yarın yarin dün dun anne baba
  bambaşka bambaska unut unutma affet kader yollar sokak şehir sehir istanbul kuzu sana bensiz sensiz
`.split(/\s+/).filter(Boolean));
const TR_SUFFIX = /(?:iyor|ıyor|uyor|üyor)(?:um|sun|uz|lar|du|muş)?$|(?:sız|siz|suz|süz)$|(?:ımı|imi|umu|ümü)$|(?:dım|dim|dum|düm|tım|tim)$/;
const TR_GENRES = /turk|türk|arabesk|anadolu|istanbul|ankara|izmir/i;

const KEY_GENRES = 'ls.artistGenres';

function words(text) {
  return text.toLocaleLowerCase('tr').split(/[^\p{L}]+/u).filter(Boolean);
}

export function looksTurkish(track) {
  const text = `${track.name} ${track.artists.join(' ')}`;
  if (TR_CHARS.test(text)) return true;
  const ws = words(track.name);
  const hits = ws.filter(w => TR_WORDS.has(w) || (w.length > 4 && TR_SUFFIX.test(w))).length;
  return hits >= 1 && hits >= ws.length / 3;
}

function loadGenres() {
  try { return JSON.parse(localStorage.getItem(KEY_GENRES)) || {}; } catch { return {}; }
}

// Her şarkıya lang = 'tr' | 'en' yazar.
export function tagLanguages(tracks, genres = loadGenres()) {
  const trArtists = new Set();
  for (const t of tracks) {
    const g = genres[t.artistIds?.[0]];
    if (t.langHint === 'tr' || looksTurkish(t) || (g && g.some(x => TR_GENRES.test(x)))) trArtists.add(t.artists[0]);
  }
  for (const t of tracks) t.lang = trArtists.has(t.artists[0]) ? 'tr' : 'en';
}

// Ana sanatçıların türlerini Spotify'dan çeker (önbellekli). Hata olursa sessizce durur.
export async function fetchArtistGenres(tracks, onProgress) {
  const genres = loadGenres();
  const ids = [...new Set(tracks.map(t => t.artistIds?.[0]).filter(Boolean))].filter(id => !(id in genres));
  let done = 0;
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      const artist = await api(`/artists/${id}`);
      genres[id] = artist.genres || [];
      if (++done % 25 === 0) {
        localStorage.setItem(KEY_GENRES, JSON.stringify(genres));
        onProgress?.(done, ids.length, genres);
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (err) {
    console.warn('Sanatçı türleri alınamadı:', err);
  }
  localStorage.setItem(KEY_GENRES, JSON.stringify(genres));
  onProgress?.(done, ids.length, genres);
  return genres;
}
