// Oyun müzikleri modu: hesap bağlamadan, seçilen oyunların resmi soundtrack albümlerinden soru gelir.
// Albümler iTunes'tan çekilir (her parçanın 30 sn önizlemesi var); "sanatçı" yerine oyunun adı tutulur,
// böylece "Oyun" sorusu "bu hangi oyunun müziği?" olur.
import { cleanTitle } from './players.js';

// albums: iTunes albüm (collection) kimlikleri.
// tracks: albümü olmayan oyunlar için tek tek parça kimlikleri (bestecilerin resmi yayınları);
// names: parçanın oyundaki adı farklıysa (ör. MDK'nın "Fingerbang"i oyunda "Fingerdash").
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
  {
    id: 'geometry-dash', name: 'Geometry Dash', aliases: ['gd'],
    tracks: [
      1276451230, // Stereo Madness — ForeverBound
      695745058, // Back on Track — DJVI
      715004621, // Dry Out — DJVI
      808865837, // Base After Base — DJVI
      795158067, // Can't Let Go — DJVI
      966976377, // Jumper — Waterflame
      525846513, // Time Machine — Waterflame
      794598147, // Cycles — DJVI
      1829740808, // xStep — DJVI
      699354354, // Clutterfunk — Waterflame
      6805992230, // Theory of Everything — dj-Nate
      966976361, // Electroman Adventures — Waterflame
      6805992252, // Clubstep — dj-Nate
      6805992248, // Electrodynamix — dj-Nate
      966977461, // Hexagon Force — Waterflame
      966976364, // Blast Processing — Waterflame
      6805992232, // Theory of Everything 2 — dj-Nate
      1035817358, // Geometrical Dominator — Waterflame
      1718898130, // Deadlocked — F-777
      931500978, // Fingerbang (oyunda Fingerdash) — MDK
    ],
    names: { 931500978: 'Fingerdash', 699354354: 'Clutterfunk' },
  },
];

const DEFAULT_GAMES = ['hollow-knight', 'silksong', 'balatro', 'pvz', 'jetpack', 'geometry-dash'];

const KEY_SELECTION = 'ls.ost.selection';
const keyTracks = id => `ls.ost.${id}`;

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

// Varsayılanlara sonradan eklenen oyunlar, kendi seçimini kaydetmiş olanlara da bir kez eklenir.
const ADDED_DEFAULTS = ['geometry-dash'];

export function getSelectedGames() {
  const sel = read(KEY_SELECTION);
  if (!Array.isArray(sel) || !sel.length) return DEFAULT_GAMES;
  const added = read('ls.ost.addedDefaults') || [];
  const missing = ADDED_DEFAULTS.filter(id => !added.includes(id));
  if (missing.length) {
    const next = [...new Set([...sel, ...missing])];
    localStorage.setItem(KEY_SELECTION, JSON.stringify(next));
    localStorage.setItem('ls.ost.addedDefaults', JSON.stringify([...added, ...missing]));
    return next;
  }
  return sel;
}

export function setSelectedGames(ids) {
  localStorage.setItem(KEY_SELECTION, JSON.stringify(ids.length ? ids : DEFAULT_GAMES));
}

export function cachedGameTracks(id) {
  return read(keyTracks(id));
}

export async function fetchGameTracks(game) {
  const cached = cachedGameTracks(game.id);
  // Eski önbellekte besteci yok; popülerlik araması için yeniden indirilir.
  if (cached?.length && cached[0].composer !== undefined) return cached;
  const params = game.tracks
    ? new URLSearchParams({ id: game.tracks.join(','), country: 'US' })
    : new URLSearchParams({ id: game.albums.join(','), entity: 'song', limit: '200', country: 'US' });
  const res = await fetch(`https://itunes.apple.com/lookup?${params}`);
  if (!res.ok) throw new Error(`${game.name} müzikleri alınamadı (${res.status}).`);
  const seen = new Set();
  const tracks = [];
  for (const r of (await res.json()).results || []) {
    if (r.wrapperType !== 'track' || !r.previewUrl) continue;
    const name = game.names?.[r.trackId] || cleanTitle(r.trackName);
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
      // Deezer'da parçalar oyunun değil bestecinin adıyla kayıtlı; popülerlik bununla aranır.
      composer: r.artistName || '',
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
