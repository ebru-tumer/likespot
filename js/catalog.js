// Tahmin yazarken sadece kendi listendeki değil, tüm şarkılar arasından öneri çıkması için
// Deezer'ın herkese açık arama API'si kullanılır. Deezer CORS izin vermediği için JSONP ile çağrılır.
import { normalize, cleanTitle } from './players.js';

// Deezer popülerlik puanı (0-1.000.000). Altındakiler öneride gösterilmez; çok az bilinen
// aynı isimli şarkılar listeyi doldurmasın. Bilinen Türkçe klasikler ~300-450 bin civarında.
const MIN_TRACK_RANK = 300_000;
const MIN_ARTIST_FANS = 10_000;

const cache = new Map();
let counter = 0;

export function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__deezer${++counter}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Deezer zaman aşımı')); }, 5000);
    window[cb] = data => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('Deezer araması yapılamadı')); };
    script.src = `${url}&output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

function songItem(t) {
  const title = cleanTitle(t.title_short || t.title);
  const artist = t.artist?.name || '';
  return { label: title, sub: artist, value: title, search: normalize(`${title} ${artist}`) };
}

// question: 'title' -> şarkılar, 'artist' -> sanatçılar.
export async function searchCatalog(question, text) {
  const q = text.trim();
  const key = `${question}|${normalize(q)}`;
  if (cache.has(key)) return cache.get(key);
  const enc = encodeURIComponent(q);
  let items;
  if (question === 'artist') {
    const data = await jsonp(`https://api.deezer.com/search/artist?q=${enc}&limit=15`);
    items = (data.data || [])
      .filter(a => (a.nb_fan || 0) >= MIN_ARTIST_FANS)
      .map(a => ({ label: a.name, sub: '', value: a.name, search: normalize(a.name) }));
  } else {
    // Genel arama sanatçı adını da kapsar: "50 cent" yazınca 50 Cent'in şarkıları gelir.
    const general = await jsonp(`https://api.deezer.com/search?q=${enc}&limit=25`);
    items = (general.data || [])
      .filter(t => (t.rank || 0) >= MIN_TRACK_RANK)
      .map(songItem);
  }
  cache.set(key, items);
  return items;
}
