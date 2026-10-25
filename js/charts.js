// Hesapsız "Hit şarkılar" modu: tür ve dönem seçilir, şarkılar Deezer editörlerinin
// hazırladığı listelerden gelir. Her şarkının önizlemesi ve popülerlik puanı Deezer'dan gelir.
// Önizleme adresleri süreli imzalı olduğu için listeler her oturumda yeniden alınır.
import { jsonp } from './catalog.js';
import { cleanTitle } from './players.js';

export const ERAS = [
  { id: 'classic', name: 'Klasik (80-90lar)' },
  { id: '2000s', name: "2000'ler" },
  { id: '2010s', name: "2010'lar" },
  { id: '2020s', name: "2020'ler" },
];

// lists: dönem → Deezer çalma listesi kimlikleri. Olmayan dönem o türde seçilemez.
export const GENRES = [
  { id: 'pop', name: 'Pop', lists: {
    classic: [867825522, 878989033], '2000s': [8326097522], '2010s': [8282573142], '2020s': [13650203641, 13650084141] } },
  { id: 'hiphop', name: 'Hip-Hop / Rap', lists: {
    classic: [1724212365], '2000s': [4676818664], '2010s': [7662551722], '2020s': [12547421383] } },
  { id: 'rock', name: 'Rock', lists: {
    classic: [8621268482, 1728093421], '2000s': [1419215845], '2010s': [1057779131], '2020s': [13693489781] } },
  { id: 'rnb', name: 'R&B', lists: {
    classic: [5014738124], '2000s': [2021626162], '2010s': [5411628342], '2020s': [15150790963] } },
  { id: 'kpop', name: 'K-Pop', lists: {
    '2000s': [9001299402], '2010s': [9001527742], '2020s': [12244134951, 4096400722] } },
  { id: 'tr-pop', name: 'Türkçe Pop', lists: {
    classic: [9719829122, 15174541563], '2000s': [7000578864], '2010s': [7940129102], '2020s': [15458569781, 1249073201] } },
  { id: 'tr-rock', name: 'Türkçe Rock', lists: {
    classic: [11803374521], '2000s': [13989572561], '2010s': [1450482795], '2020s': [1450482795] } },
  { id: 'tr-rap', name: 'Türkçe Rap', lists: {
    classic: [8936871502], '2000s': [8936871502], '2010s': [9180741202], '2020s': [8717938602] } },
];

const KEY = 'ls.charts.selection';
const DEFAULT = { genres: ['pop'], eras: ERAS.map(e => e.id) };

export function getSelection() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.genres?.length && s?.eras?.length) return s;
  } catch { /* varsayılan */ }
  return DEFAULT;
}

export function setSelection(sel) {
  localStorage.setItem(KEY, JSON.stringify(sel));
}

const listCache = new Map();

async function fetchList(id) {
  if (!listCache.has(id)) {
    listCache.set(id, jsonp(`https://api.deezer.com/playlist/${id}/tracks?limit=400`).then(data => {
      if (data.error) throw new Error(data.error.message || 'Deezer listesi alınamadı');
      return (data.data || [])
        .filter(t => t.readable !== false && t.preview)
        .map(t => ({
          id: `dz-${t.id}`,
          uri: '',
          name: cleanTitle(t.title_short || t.title),
          artists: [t.artist?.name || ''],
          artistIds: [],
          album: t.album?.title || '',
          year: null,
          image: t.album?.cover_medium || '',
          duration: (t.duration || 0) * 1000,
          url: t.link || '',
          preview: t.preview,
          pop: t.rank || 0,
        }));
    }).catch(err => {
      listCache.delete(id);
      throw err;
    }));
  }
  return listCache.get(id);
}

// Seçili tür × dönem listelerinin şarkıları; aynı şarkı bir kez alınır.
export async function loadSelectedTracks(sel = getSelection()) {
  const ids = new Set();
  for (const g of GENRES) {
    if (!sel.genres.includes(g.id)) continue;
    for (const era of sel.eras) for (const id of g.lists[era] || []) ids.add(id);
  }
  const parts = await Promise.all([...ids].map(id => fetchList(id).catch(() => [])));
  const seen = new Set();
  const tracks = [];
  for (const t of parts.flat()) {
    const key = `${t.name.toLowerCase()}|${t.artists[0].toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(t);
  }
  return tracks;
}

export function describe(sel = getSelection()) {
  const g = GENRES.filter(x => sel.genres.includes(x.id)).map(x => x.name);
  const e = sel.eras.length === ERAS.length ? 'tüm dönemler'
    : ERAS.filter(x => sel.eras.includes(x.id)).map(x => x.name.replace(/ \(.*\)/, '')).join(', ');
  return `${g.join(', ')} · ${e}`;
}
