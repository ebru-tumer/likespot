// Tahmin yazarken sadece kendi listendeki değil, tüm şarkılar arasından öneri çıkması için
// Deezer'ın herkese açık arama API'si kullanılır. Deezer CORS izin vermediği için JSONP ile çağrılır.
import { normalize, cleanTitle } from './players.js';

const cache = new Map();
let counter = 0;

function jsonp(url) {
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
    items = (data.data || []).map(a => ({ label: a.name, sub: '', value: a.name, search: normalize(a.name) }));
  } else {
    // Hem genel arama hem de sanatçı araması: "50 cent" yazınca 50 Cent'in şarkıları da gelsin.
    const [general, byArtist] = await Promise.all([
      jsonp(`https://api.deezer.com/search?q=${enc}&limit=15`),
      jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(`artist:"${q}"`)}&limit=15`).catch(() => ({})),
    ]);
    items = [...(general.data || []), ...(byArtist.data || [])].map(songItem);
  }
  cache.set(key, items);
  return items;
}
