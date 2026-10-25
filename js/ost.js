// Oyun müzikleri modu: hesap bağlamadan, seçilen oyunların resmi soundtrack albümlerinden soru gelir.
// Albümler iTunes'tan çekilir (her parçanın 30 sn önizlemesi var); "sanatçı" yerine oyunun adı tutulur,
// böylece "Oyun" sorusu "bu hangi oyunun müziği?" olur.
import { cleanTitle } from './players.js';

// albums: iTunes albüm (collection) kimlikleri.
export const GAMES = [
  { id: 'hollow-knight', name: 'Hollow Knight', albums: [1263341718, 1425627253], aliases: ['hk'] },
  { id: 'silksong', name: 'Hollow Knight: Silksong', albums: [1838949732], aliases: ['hks', 'silk song'] },
  { id: 'balatro', name: 'Balatro', albums: [1793481100] },
  { id: 'pvz', name: 'Plants vs. Zombies', albums: [1489505171], aliases: ['pvz', 'plants vs zombies', 'bitkiler zombilere karsi'] },
  { id: 'jetpack', name: 'Jetpack Joyride', albums: [1717586125, 1174070639, 1722260968], aliases: ['jj'] },
  { id: 'celeste', name: 'Celeste', albums: [1544899658] },
  { id: 'undertale', name: 'Undertale', albums: [6813342945] },
  { id: 'deltarune', name: 'Deltarune', albums: [6813279267, 6813268822, 6813242328] },
  { id: 'stardew', name: 'Stardew Valley', albums: [1158129204] },
  { id: 'minecraft', name: 'Minecraft', albums: [1867885113, 1867890087] },
  { id: 'terraria', name: 'Terraria', albums: [478172081] },
  { id: 'hades', name: 'Hades', albums: [1531339044] },
  { id: 'hades2', name: 'Hades II', albums: [1852248640] },
  { id: 'cuphead', name: 'Cuphead', albums: [1305353572] },
  { id: 'ori', name: 'Ori and the Blind Forest', albums: [971519718], aliases: ['ori'] },
  { id: 'dead-cells', name: 'Dead Cells', albums: [1413811527] },
  { id: 'katana-zero', name: 'Katana Zero', albums: [1462456864] },
  { id: 'portal2', name: 'Portal 2', albums: [1891392601] },
  { id: 'fruit-ninja', name: 'Fruit Ninja', albums: [1596233785] },
  { id: 'angry-birds', name: 'Angry Birds', albums: [1530256320] },
];

const DEFAULT_GAMES = ['hollow-knight', 'silksong', 'balatro', 'pvz', 'jetpack'];

const KEY_SELECTION = 'ls.ost.selection';
const keyTracks = id => `ls.ost.${id}`;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function getSelectedGames() {
  const sel = read(KEY_SELECTION);
  return Array.isArray(sel) && sel.length ? sel : DEFAULT_GAMES;
}

export function setSelectedGames(ids) {
  localStorage.setItem(KEY_SELECTION, JSON.stringify(ids.length ? ids : DEFAULT_GAMES));
}

export function cachedGameTracks(id) {
  return read(keyTracks(id));
}

export async function fetchGameTracks(game) {
  const cached = cachedGameTracks(game.id);
  if (cached?.length) return cached;
  const params = new URLSearchParams({ id: game.albums.join(','), entity: 'song', limit: '200', country: 'US' });
  const res = await fetch(`https://itunes.apple.com/lookup?${params}`);
  if (!res.ok) throw new Error(`${game.name} müzikleri alınamadı (${res.status}).`);
  const seen = new Set();
  const tracks = [];
  for (const r of (await res.json()).results || []) {
    if (r.wrapperType !== 'track' || !r.previewUrl) continue;
    const name = cleanTitle(r.trackName);
    // Aynı parçanın farklı albümlerdeki tekrarı bir kez alınır.
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tracks.push({
      id: `ost-${r.trackId}`,
      uri: '',
      name,
      artists: [game.name],
      artistIds: [],
      album: r.collectionName || '',
      year: parseInt(r.releaseDate, 10) || null,
      image: (r.artworkUrl100 || '').replace('100x100', '300x300'),
      duration: r.trackTimeMillis || 0,
      url: r.trackViewUrl || '',
      preview: r.previewUrl,
      lang: 'ost',
    });
  }
  try {
    localStorage.setItem(keyTracks(game.id), JSON.stringify(tracks));
  } catch { /* depolama dolu; bir dahaki sefere yeniden indirilir */ }
  return tracks;
}

// "Hangi oyun" sorusunun önerileri: seçili olsun olmasın tüm oyunlar (kısaltmalarıyla aranabilir),
// böylece öneri listesi cevabı ele vermez.
export function gameSuggestionIndex(normalize) {
  return GAMES.map(g => ({
    label: g.name,
    sub: '',
    value: g.name,
    search: normalize([g.name, ...(g.aliases || [])].join(' ')),
  }));
}

// Seçili oyunların parçaları (indirilmemişse indirir).
export async function loadSelectedTracks() {
  const selected = GAMES.filter(g => getSelectedGames().includes(g.id));
  const parts = await Promise.all(selected.map(g => fetchGameTracks(g).catch(() => [])));
  return parts.flat();
}
