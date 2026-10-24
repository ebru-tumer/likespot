// Oyun kuralları: zorluklar, şarkı seçimi, cevap kontrolü ve istatistikler.
import { normalize, cleanTitle } from './players.js';

// Her zorlukta klipler aynı; zorluk cevap şekli, klibin yeri ve öneri kutusuyla artar.
const CLIPS = [0.1, 0.5, 2, 8, 15];

export const DIFFICULTIES = {
  easy:       { label: 'Kolay',    clips: CLIPS, mode: 'choice', offset: 'start',  mult: 1,
                color: '#22c55e', on: '#06210f', hint: '4 şık · klip şarkının tanıdık yerinden' },
  medium:     { label: 'Orta',     clips: CLIPS, mode: 'choice', offset: 'random', mult: 2,
                color: '#facc15', on: '#2a2104', hint: '4 şık · klip şarkının rastgele bir yerinden' },
  hard:       { label: 'Zor',      clips: CLIPS, mode: 'type',   offset: 'start',  mult: 3,
                color: '#fb923c', on: '#2b1406', hint: 'Yazarak cevapla · tanıdık yerden' },
  expert:     { label: 'Uzman',    clips: CLIPS, mode: 'type',   offset: 'random', mult: 4,
                color: '#f87171', on: '#2b0b0b', hint: 'Yazarak cevapla · rastgele yerden' },
  impossible: { label: 'İmkânsız', clips: CLIPS, mode: 'type',   offset: 'random', mult: 5, noSearch: true,
                color: '#a855f7', on: '#ffffff', hint: 'Öneri yok, tam adını yaz · rastgele yerden' },
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

export function suggest(index, text, limit = 8) {
  const words = normalize(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const item of index) {
    if (words.every(w => item.search.includes(w))) {
      hits.push(item);
      if (hits.length >= 60) break;
    }
  }
  const first = words[0];
  hits.sort((a, b) => Number(!a.search.startsWith(first)) - Number(!b.search.startsWith(first)));
  return hits.slice(0, limit);
}

// Son çalınanları tekrar etmeden rastgele şarkı seçer.
export class Picker {
  constructor() {
    this.recent = [];
    this.bad = new Set();
  }

  pool(tracks, era) {
    const test = ERAS[era] || ERAS.all;
    const filtered = tracks.filter(t => !this.bad.has(t.id) && test(t.year));
    return filtered.length ? filtered : tracks.filter(t => !this.bad.has(t.id));
  }

  next(tracks, era) {
    const pool = this.pool(tracks, era);
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
