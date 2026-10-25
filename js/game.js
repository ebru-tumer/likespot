// Oyun kuralları: zorluklar, şarkı seçimi, cevap kontrolü ve istatistikler.
import { normalize, cleanTitle } from './players.js';

// Her zorlukta klipler aynı ve cevap hep yazılarak verilir.
// Zorluk; şarkının popülerliği (bkz. Picker.tierSlice), klibin yeri ve klibin her adımda
// yer değiştirmesiyle artar.
const CLIPS = [0.1, 0.5, 2, 8, 15];

export const DIFFICULTIES = {
  easy:       { label: 'Kolay',    clips: CLIPS, mode: 'type', offset: 'start',  mult: 1,
                color: '#22c55e', on: '#06210f', hint: 'En bilinen şarkıların · tanıdık yerden' },
  medium:     { label: 'Orta',     clips: CLIPS, mode: 'type', offset: 'random', mult: 2,
                color: '#facc15', on: '#2a2104', hint: 'Bilinen şarkıların · rastgele yerden' },
  hard:       { label: 'Zor',      clips: CLIPS, mode: 'type', offset: 'start',  mult: 3,
                color: '#fb923c', on: '#2b1406', hint: 'Orta popülerlikte şarkılar · tanıdık yerden' },
  expert:     { label: 'Uzman',    clips: CLIPS, mode: 'type', offset: 'random', mult: 4,
                color: '#f87171', on: '#2b0b0b', hint: 'Az bilinen şarkılar · rastgele yerden' },
  impossible: { label: 'İmkânsız', clips: CLIPS, mode: 'type', offset: 'random', mult: 5,
                reshuffle: true,
                color: '#a855f7', on: '#ffffff', hint: 'En az bilinen şarkıların · her adımda başka bir yer' },
};

export const ERAS = {
  all: () => true,
  classic: y => y && y < 2000,
  '2000s': y => y >= 2000 && y < 2010,
  '2010s': y => y >= 2010 && y < 2020,
  '2020s': y => y >= 2020,
};

export function sameTitle(a, b) {
  return normalize(cleanTitle(a)) === normalize(cleanTitle(b));
}

export function isCorrect(question, track, guess) {
  if (question === 'artist') {
    const g = normalize(guess);
    return track.artists.some(a => normalize(a) === g);
  }
  return sameTitle(track.name, guess);
}

export function points(difficulty, step) {
  const d = DIFFICULTIES[difficulty];
  return (d.clips.length - step) * d.mult;
}

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function makeChoices(question, track, tracks, count = 4) {
  const correct = question === 'artist' ? track.artists[0] : cleanTitle(track.name);
  const seen = new Set([normalize(correct)]);
  const options = [correct];
  for (const t of shuffle(tracks)) {
    if (options.length >= count) break;
    const label = question === 'artist' ? t.artists[0] : cleanTitle(t.name);
    const key = normalize(label);
    if (!key || seen.has(key)) continue;
    if (question === 'artist' && track.artists.some(a => normalize(a) === key)) continue;
    seen.add(key);
    options.push(label);
  }
  return shuffle(options);
}

// Yazarak cevaplarken gösterilecek öneriler.
export function buildIndex(question, tracks) {
  const map = new Map();
  for (const t of tracks) {
    if (question === 'artist') {
      for (const a of t.artists) {
        const key = normalize(a);
        if (key && !map.has(key)) map.set(key, { label: a, sub: '', value: a, search: key });
      }
    } else {
      const title = cleanTitle(t.name);
      const key = normalize(title) + '|' + normalize(t.artists[0]);
      if (!map.has(key)) {
        map.set(key, { label: title, sub: t.artists.join(', '), value: title,
                       search: normalize(`${title} ${t.artists.join(' ')}`) });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'tr'));
}

// Tüm eşleşmeleri bulur, en iyi eşleşenler üstte olacak şekilde sıralar:
// adı yazılanla başlayanlar, sonra bir kelimesi yazılanla başlayanlar, sonra adında geçenler,
// en son sadece sanatçı adı eşleşenler.
export function suggest(index, text, limit = 8) {
  return rankItems(index, text, limit);
}

// Aynı şarkı (ad + ilk sanatçı) birden fazla kaynaktan gelirse bir kez gösterilir.
export function rankItems(items, text, limit = 8) {
  const query = normalize(text);
  const words = query.split(' ').filter(Boolean);
  if (!words.length) return [];
  const rank = item => {
    const label = normalize(item.label);
    if (label.startsWith(query)) return 0;
    if (item.sub && normalize(item.sub).startsWith(query)) return 1;
    if (label.split(' ').some(w => w.startsWith(words[0]))) return 2;
    if (label.includes(words[0])) return 3;
    return 4;
  };
  const seen = new Set();
  return items
    .filter(item => words.every(w => item.search.includes(w)))
    .filter(item => {
      const key = `${normalize(item.label)}|${normalize((item.sub || '').split(',')[0])}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item, i) => ({ item, r: rank(item), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(x => x.item);
}

// Son çalınanları tekrar etmeden rastgele şarkı seçer.
export class Picker {
  constructor() {
    this.recent = [];
    this.bad = new Set();
  }

  // Dil filtresi kesindir; dönem filtresi eşleşme yoksa (ör. yılı bilinmeyen demo şarkıları) gevşer.
  pool(tracks, era, lang = 'all') {
    const test = ERAS[era] || ERAS.all;
    const usable = tracks.filter(t => !this.bad.has(t.id) && (lang === 'all' || t.lang === lang));
    const filtered = usable.filter(t => test(t.year));
    return filtered.length ? filtered : usable;
  }

  // tier: 0 (en popüler beşte bir) ... 4 (en az bilinen beşte bir). Popülerlik henüz taranmadıysa
  // ya da liste çok küçükse tüm havuz kullanılır.
  static tierSlice(pool, tier) {
    if (tier == null || pool.length < 15) return pool;
    const known = pool.filter(t => t.pop != null).length;
    if (known < pool.length * 0.5) return pool;
    const sorted = [...pool].sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));
    const size = sorted.length / 5;
    return sorted.slice(Math.floor(tier * size), Math.floor((tier + 1) * size));
  }

  // byGroup: popülerlik her grubun (ör. her oyunun) kendi içinde sıralanır; böylece Kolay'da
  // her oyunun en bilinen parçaları gelir, az dinlenen bir oyun tamamen İmkânsız'a düşmez.
  static groupedTierSlice(pool, tier) {
    const groups = new Map();
    for (const t of pool) {
      const key = t.artists[0];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups.values()].flatMap(g => {
      if (g.length < 5 || g.filter(t => t.pop != null).length < g.length * 0.5) return g;
      const sorted = [...g].sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0));
      const size = sorted.length / 5;
      return sorted.slice(Math.floor(tier * size), Math.floor((tier + 1) * size));
    });
  }

  next(tracks, era, lang, tier, byGroup = false) {
    const all = this.pool(tracks, era, lang);
    const pool = byGroup && tier != null ? Picker.groupedTierSlice(all, tier) : Picker.tierSlice(all, tier);
    if (!pool.length) return null;
    const memory = Math.min(200, Math.floor(pool.length * 0.6));
    const fresh = pool.filter(t => !this.recent.includes(t.id));
    const list = fresh.length ? fresh : pool;
    const track = list[Math.floor(Math.random() * list.length)];
    this.recent.push(track.id);
    while (this.recent.length > memory) this.recent.shift();
    return track;
  }

  markBad(track) {
    this.bad.add(track.id);
  }
}

const KEY_STATS = 'ls.stats';

export function loadStats() {
  try {
    return { score: 0, streak: 0, best: 0, played: 0, won: 0, ...JSON.parse(localStorage.getItem(KEY_STATS)) };
  } catch {
    return { score: 0, streak: 0, best: 0, played: 0, won: 0 };
  }
}

export function saveStats(stats) {
  localStorage.setItem(KEY_STATS, JSON.stringify(stats));
}
