import * as auth from './auth.js';
import { loadCachedLibrary, fetchLikedSongs, clearLibrary } from './library.js';
import * as yt from './youtube.js';
import { PreviewPlayer, SpotifyPlayer } from './players.js';
import {
  DIFFICULTIES, Picker, isCorrect, points, makeChoices, buildIndex, suggest, loadStats, saveStats,
} from './game.js';
import { DEMO_TRACKS } from './demo.js';
import { tagLanguages, fetchArtistGenres } from './language.js';

const $ = id => document.getElementById(id);
const KEY_SETTINGS = 'ls.settings';
const KEY_PROVIDER = 'ls.provider';

const preview = new PreviewPlayer();
const spotify = new SpotifyPlayer();
const picker = new Picker();

const settings = {
  difficulty: 'expert', question: 'title', era: 'all', lang: 'all', source: 'preview', search: true, volume: 90,
};
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY_SETTINGS))); } catch { /* varsayılanlar */ }

const state = {
  tracks: [],
  provider: 'demo', // 'spotify' | 'youtube' | 'demo'
  round: null,
  queued: null,
  playing: false,
  index: { title: null, artist: null },
  suggestions: [],
  active: -1,
  stats: loadStats(),
};

function show(screen) {
  for (const s of ['setup', 'loading', 'game']) $(`screen-${s}`).hidden = s !== screen;
  $('side-left').hidden = $('side-right').hidden = screen !== 'game';
}

function showError(el, err) {
  console.error(err);
  $(el).textContent = err?.message || String(err);
  $(el).hidden = false;
}

function saveSettings() {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

function player() {
  return settings.source === 'spotify' && state.provider === 'spotify' ? spotify : preview;
}

// ---------- Kurulum ----------

function initSetup() {
  $('redirect-uri').textContent = auth.redirectUri();
  $('client-id').value = auth.getClientId();
  $('google-client-id').value = yt.getGoogleClientId();
  $('client-id').onchange = () => auth.setClientId($('client-id').value);
  $('google-client-id').onchange = () => yt.setGoogleClientId($('google-client-id').value);
  $('copy-redirect').onclick = async () => {
    await navigator.clipboard.writeText(auth.redirectUri());
    $('copy-redirect').textContent = 'Kopyalandı';
  };
  $('btn-login').onclick = async () => {
    $('setup-error').hidden = true;
    try {
      auth.setClientId($('client-id').value);
      localStorage.setItem(KEY_PROVIDER, 'spotify');
      await auth.login();
    } catch (err) {
      showError('setup-error', err);
    }
  };
  $('btn-youtube').onclick = async () => {
    $('setup-error').hidden = true;
    try {
      yt.setGoogleClientId($('google-client-id').value);
      await yt.login();
      localStorage.setItem(KEY_PROVIDER, 'youtube');
      const lib = await loadYoutubeLibrary();
      startGame(lib.tracks, 'youtube');
    } catch (err) {
      show('setup');
      showError('setup-error', err);
    }
  };
  $('playlist-form').onsubmit = async e => {
    e.preventDefault();
    $('setup-error').hidden = true;
    const id = yt.playlistIdFrom($('playlist-url').value);
    if (!id) return showError('setup-error', new Error('Bu bir çalma listesi linkine benzemiyor. Linkte "list=" kısmı olmalı.'));
    try {
      const lib = await loadPlaylist(id);
      localStorage.setItem(KEY_PROVIDER, 'playlist');
      startGame(lib.tracks, 'playlist');
    } catch (err) {
      show('setup');
      showError('setup-error', err);
    }
  };
  $('btn-demo').onclick = () => startGame(DEMO_TRACKS, 'demo');
  yt.loadGoogle().catch(() => {});
}

async function loadPlaylist(id) {
  show('loading');
  $('loading-text').textContent = 'Çalma listesi yükleniyor…';
  $('loading-bar').style.width = '0%';
  const lib = await yt.fetchPlaylist(id, (scanned, total, songs) => {
    $('loading-text').textContent = `Çalma listesi yükleniyor… ${scanned} / ${total} (${songs} şarkı)`;
    $('loading-bar').style.width = `${total ? Math.min(100, (scanned / total) * 100) : 100}%`;
  });
  if (!lib.tracks.length) throw new Error('Bu çalma listesinde şarkı bulunamadı.');
  return lib;
}

async function loadYoutubeLibrary() {
  show('loading');
  $('loading-text').textContent = 'YouTube Music beğenileri yükleniyor…';
  $('loading-bar').style.width = '0%';
  const lib = await yt.fetchYoutubeLikes((scanned, total, songs) => {
    $('loading-text').textContent = `YouTube Music beğenileri yükleniyor… ${scanned} / ${total} video, ${songs} şarkı`;
    $('loading-bar').style.width = `${total ? Math.min(100, (scanned / total) * 100) : 100}%`;
  });
  if (!lib.tracks.length) {
    throw new Error('Beğenilen videolar arasında şarkı bulunamadı. YouTube Music\'te birkaç şarkıyı beğenip tekrar dene.');
  }
  return lib;
}

async function loadLibrary(force = false) {
  const cached = !force && loadCachedLibrary();
  // Eski önbellekte sanatçı kimlikleri yok; dil tespiti için yeniden çekilir.
  if (cached?.tracks?.length && (cached.provider || 'spotify') === 'spotify' && cached.tracks[0].artistIds) return cached;
  show('loading');
  $('loading-text').textContent = 'Beğenilen şarkılar yükleniyor…';
  $('loading-bar').style.width = '0%';
  return fetchLikedSongs((done, total) => {
    $('loading-text').textContent = `Beğenilen şarkılar yükleniyor… ${done} / ${total}`;
    $('loading-bar').style.width = `${total ? (done / total) * 100 : 100}%`;
  });
}

// ---------- Oyun ----------

function startGame(tracks, provider) {
  const demo = provider === 'demo';
  state.tracks = tracks;
  state.provider = provider;
  state.index = { title: buildIndex('title', tracks), artist: buildIndex('artist', tracks) };
  tagLanguages(tracks);
  show('game');

  $('btn-refresh').hidden = demo;
  $('btn-logout').textContent = demo ? 'Demodan çık' : 'Çıkış';
  renderLibInfo();
  if (provider === 'spotify') {
    fetchArtistGenres(tracks, (done, total, genres) => {
      tagLanguages(tracks, genres);
      renderLibInfo(done < total ? `dil taranıyor ${done}/${total}` : '');
    });
  }

  renderStats();
  renderOptions();
  newRound();
}

function renderLibInfo(note = '') {
  const t = state.tracks;
  const tr = t.filter(x => x.lang === 'tr').length;
  const base = state.provider === 'demo'
    ? `Demo · ${t.length} popüler şarkı`
    : state.provider === 'playlist'
      ? `Çalma listesi · ${t.length.toLocaleString('tr')} şarkı`
      : `${t.length.toLocaleString('tr')} beğenilen şarkı${state.provider === 'youtube' ? ' (YouTube Music)' : ''}`;
  $('lib-info').textContent = [base, `${tr.toLocaleString('tr')} Türkçe`, note].filter(Boolean).join(' · ');
}

function setDifficulty(key) {
  if (key === settings.difficulty) return;
  settings.difficulty = key;
  saveSettings();
  renderOptions();
  newRound();
}

function renderOptions() {
  const pills = $('difficulty');
  const list = $('difficulty-list');
  pills.innerHTML = '';
  list.innerHTML = '';
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    const active = key === settings.difficulty;
    for (const box of [pills, list]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = d.label;
      b.className = active ? 'active' : '';
      b.title = d.hint;
      b.style.setProperty('--c', d.color);
      b.style.setProperty('--on', d.on);
      if (box === pills) {
        b.role = 'tab';
        b.setAttribute('aria-selected', active);
      }
      b.onclick = () => setDifficulty(key);
      box.appendChild(b);
    }
  }

  document.documentElement.style.setProperty('--accent', DIFFICULTIES[settings.difficulty].color);

  $('opt-question').value = settings.question;
  $('opt-era').value = settings.era;
  $('opt-lang').value = settings.lang;
  for (const b of $('qtabs').children) b.classList.toggle('active', b.dataset.q === settings.question);

  const canSpotify = state.provider === 'spotify';
  const source = canSpotify ? settings.source : 'preview';
  for (const b of $('source-buttons').children) {
    b.classList.toggle('active', b.dataset.source === source);
    b.disabled = !canSpotify && b.dataset.source === 'spotify';
    b.title = b.disabled ? 'Sadece Spotify ile bağlanınca kullanılabilir' : '';
  }

  const noSearch = !!DIFFICULTIES[settings.difficulty].noSearch;
  $('opt-search').checked = settings.search && !noSearch;
  $('opt-search').disabled = noSearch;
  $('opt-search').parentElement.title = noSearch ? 'Bu zorlukta yazarken öneri çıkmaz' : '';
  $('opt-search').parentElement.classList.toggle('disabled', noSearch);
  $('opt-volume').value = settings.volume;
  applyVolume();
}

function applyVolume() {
  const v = settings.volume / 100;
  preview.volume = v;
  spotify.volume = v;
  $('opt-volume').style.setProperty('--fill', `${settings.volume}%`);
}

function renderStats() {
  $('stat-score').textContent = state.stats.score.toLocaleString('tr');
  $('stat-streak').textContent = state.stats.streak;
  $('stat-best').textContent = state.stats.best;
}

function setBusy(busy) {
  $('btn-play').classList.toggle('busy', busy);
  $('btn-play').disabled = busy;
}

// Ön izlemesi olmayan şarkıları atlayarak oynanabilir bir şarkı bulur.
async function pickPlayable() {
  for (let i = 0; i < 12; i++) {
    let track = state.queued;
    state.queued = null;
    if (!track) track = picker.next(state.tracks, settings.era, settings.lang);
    if (!track) return null;
    if (player() !== preview) return track;
    const loaded = await preview.load(track);
    if (loaded) {
      enrich(track, loaded.match);
      return track;
    }
    picker.markBad(track);
  }
  return null;
}

// Demo şarkılarında eksik bilgileri iTunes sonucundan tamamlar.
function enrich(track, match) {
  if (!track.image && match.artworkUrl100) track.image = match.artworkUrl100.replace('100x100', '300x300');
  if (!track.album) track.album = match.collectionName || '';
  if (!track.year && match.releaseDate) track.year = parseInt(match.releaseDate, 10);
  if (!track.url) track.url = match.trackViewUrl || '';
}

function queueNext() {
  if (player() !== preview) return;
  const next = picker.next(state.tracks, settings.era, settings.lang);
  if (!next) return;
  state.queued = next;
  preview.load(next);
}

let roundId = 0;

async function newRound() {
  const id = ++roundId;
  stopAudio();
  $('game-error').hidden = true;
  const d = DIFFICULTIES[settings.difficulty];
  const qtype = settings.question === 'mixed' ? (Math.random() < 0.5 ? 'title' : 'artist') : settings.question;

  state.round = null;
  renderRound();
  setBusy(true);
  $('clip-note').textContent = 'Şarkı hazırlanıyor…';

  let track;
  try {
    track = await pickPlayable();
  } catch (err) {
    showError('game-error', err);
  }
  if (id !== roundId) return;
  setBusy(false);
  if (!track) {
    $('clip-note').textContent = 'Çalınabilir şarkı bulunamadı.';
    showError('game-error', new Error('Bu filtrelerle çalınabilir şarkı bulunamadı. Dil veya dönem filtresini değiştirmeyi dene.'));
    return;
  }

  const maxClip = d.clips[d.clips.length - 1];
  const offset = await player().pickOffset(track, d.offset, maxClip);
  if (id !== roundId) return;

  state.round = {
    track, qtype, offset,
    step: 0,
    guesses: [],
    wrongChoices: new Set(),
    choices: d.mode === 'choice' ? makeChoices(qtype, track, choicePool()) : null,
    done: false,
    won: false,
  };
  renderRound();
  queueNext();
}

// Şıklar da aynı dilden olsun ki tahmin kolaylaşmasın.
function choicePool() {
  const pool = picker.pool(state.tracks, 'all', settings.lang);
  return pool.length >= 8 ? pool : state.tracks;
}

function currentClip() {
  const r = state.round;
  const clips = DIFFICULTIES[settings.difficulty].clips;
  return r ? clips[Math.min(r.step, clips.length - 1)] : clips[0];
}

function fmt(sec) {
  return `${sec}s`;
}

// Kısa kliplerin de görünmesi için zaman çizelgesi karekök ölçeğinde.
function timelinePos(sec) {
  const clips = DIFFICULTIES[settings.difficulty].clips;
  return Math.sqrt(sec / clips[clips.length - 1]) * 100;
}

function renderTimeline() {
  const r = state.round;
  const clips = DIFFICULTIES[settings.difficulty].clips;
  const sec = r?.done ? clips[clips.length - 1] : currentClip();
  const pos = timelinePos(sec);
  $('tl-unlocked').style.width = `${pos}%`;
  $('tl-marker').style.left = `${pos}%`;
  $('tl-label').textContent = fmt(sec);

  const ticks = $('tl-ticks');
  ticks.innerHTML = '';
  for (const c of clips.slice(0, -1)) {
    const tick = document.createElement('div');
    tick.className = 'tl-tick';
    tick.style.left = `${timelinePos(c)}%`;
    ticks.appendChild(tick);
  }
}

function renderRound() {
  const r = state.round;
  const d = DIFFICULTIES[settings.difficulty];
  const qtype = r?.qtype || (settings.question === 'artist' ? 'artist' : 'title');

  $('question').textContent = qtype === 'artist' ? 'Bu şarkıyı kim söylüyor?' : 'Bu şarkının adı ne?';
  $('guess-input').placeholder = qtype === 'artist' ? 'Sanatçıyı bil' : 'Şarkıyı bil';

  // Sağ paneldeki klip çipleri
  const ladder = $('ladder');
  ladder.innerHTML = '';
  d.clips.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'chip';
    if (r) {
      if (r.done && r.won && i === r.step) el.classList.add('won');
      else if (i < r.step || (r.done && !r.won)) el.classList.add('used');
      else if (i === r.step && !r.done) el.classList.add('current');
    } else if (i === 0) el.classList.add('current');
    el.textContent = fmt(c);
    ladder.appendChild(el);
  });

  renderTimeline();
  $('clip-length').textContent = fmt(r?.done ? 15 : currentClip());
  if (r) $('clip-note').textContent = r.done ? 'Şarkıdan biraz daha dinle' : `${d.hint} · boşluk tuşu çalar`;

  // Tahmin listesi
  const list = $('guesses');
  list.innerHTML = '';
  for (const [i, g] of (r?.guesses || []).entries()) {
    const li = document.createElement('li');
    li.className = g.ok ? 'ok' : g.skipped ? 'skipped' : 'wrong';
    li.textContent = g.skipped ? `Atlandı (${fmt(d.clips[i])})` : g.text;
    list.appendChild(li);
  }

  const playing = !!r && !r.done;
  $('answer-type').hidden = !playing || d.mode !== 'type';
  $('answer-choice').hidden = !playing || d.mode !== 'choice';
  $('reveal').hidden = !r?.done;
  $('btn-play').disabled = !r;

  if (playing && d.mode === 'choice') renderChoices();
  if (!playing) {
    $('guess-input').value = '';
    hideSuggestions();
  }
  if (r?.done) renderReveal();
}

function renderChoices() {
  const r = state.round;
  const box = $('choices');
  box.innerHTML = '';
  for (const label of r.choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.textContent = label;
    if (r.wrongChoices.has(label)) {
      b.classList.add('wrong');
      b.disabled = true;
    }
    b.onclick = () => {
      if (!isCorrect(r.qtype, r.track, label)) r.wrongChoices.add(label);
      submitGuess(label);
    };
    box.appendChild(b);
  }
}

function renderReveal() {
  const r = state.round;
  const t = r.track;
  $('verdict').textContent = r.won
    ? `Bildin! +${points(settings.difficulty, r.step)} puan`
    : 'Bu sefer olmadı';
  $('verdict').className = `verdict ${r.won ? 'ok' : 'bad'}`;
  $('reveal-img').src = t.image || '';
  $('reveal-img').hidden = !t.image;
  $('reveal-title').textContent = t.name;
  $('reveal-artist').textContent = t.artists.join(', ');
  $('reveal-album').textContent = [t.album, t.year].filter(Boolean).join(' · ');
  $('btn-open').href = t.url || '#';
  $('btn-open').hidden = !t.url;
  $('btn-open').textContent = t.url.includes('spotify') ? "Spotify'da aç"
    : t.url.includes('youtube') ? "YouTube Music'te aç" : "Apple Music'te aç";
  $('btn-next').focus();
}

// ---------- Ses ----------

function animateBar(seconds) {
  const bar = $('clip-bar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  void bar.offsetWidth;
  bar.style.transition = `width ${seconds}s linear`;
  bar.style.width = `${timelinePos(Math.min(seconds, maxClip()))}%`;
}

function maxClip() {
  const clips = DIFFICULTIES[settings.difficulty].clips;
  return clips[clips.length - 1];
}

function stopAudio() {
  preview.stop();
  spotify.stop();
  state.playing = false;
  $('btn-play').classList.remove('playing');
  const bar = $('clip-bar');
  bar.style.transition = 'none';
  bar.style.width = '0%';
}

async function playClip(seconds) {
  const r = state.round;
  if (!r) return;
  if (state.playing) {
    stopAudio();
    return;
  }
  const p = player();
  state.playing = true;
  $('btn-play').classList.add('playing');
  try {
    if (p === spotify) {
      spotify.activate();
      if (spotify.prepared?.id !== r.track.id || spotify.prepared.position !== r.offset) {
        setBusy(true);
        await spotify.prepare(r.track, r.offset);
        setBusy(false);
      }
    }
    const offset = r.done && p === preview ? 0 : r.offset;
    animateBar(seconds);
    await p.play(r.track, offset, seconds);
  } catch (err) {
    setBusy(false);
    showError('game-error', p === spotify
      ? new Error(`Spotify ile çalınamadı: ${err.message}. Sağdaki "Ses" ayarından önizlemeye geçmeyi dene.`)
      : err);
  } finally {
    if (state.round === r) {
      state.playing = false;
      $('btn-play').classList.remove('playing');
    }
  }
}

// ---------- Tahmin ----------

function advance(entry) {
  const r = state.round;
  const d = DIFFICULTIES[settings.difficulty];
  r.guesses.push(entry);
  if (entry.ok) return finish(true);
  r.step++;
  if (r.step >= d.clips.length) return finish(false);
  stopAudio();
  renderRound();
  if (d.reshuffle) {
    const maxClip = d.clips[d.clips.length - 1];
    player().pickOffset(r.track, 'random', maxClip).then(offset => { r.offset = offset; });
  }
}

function submitGuess(text) {
  const r = state.round;
  if (!r || r.done || !text.trim()) return;
  advance({ text, ok: isCorrect(r.qtype, r.track, text) });
  $('guess-input').value = '';
  hideSuggestions();
  if (!r.done && DIFFICULTIES[settings.difficulty].mode === 'type') $('guess-input').focus();
}

function skip() {
  const r = state.round;
  if (!r || r.done) return;
  advance({ skipped: true });
}

function finish(won) {
  const r = state.round;
  r.done = true;
  r.won = won;
  if (won) r.step = r.guesses.length - 1;
  const s = state.stats;
  s.played++;
  if (won) {
    s.won++;
    s.streak++;
    s.score += points(settings.difficulty, r.step);
    s.best = Math.max(s.best, s.streak);
  } else {
    s.streak = 0;
  }
  saveStats(s);
  renderStats();
  stopAudio();
  renderRound();
}

// ---------- Öneri kutusu ----------

function hideSuggestions() {
  $('suggestions').hidden = true;
  state.suggestions = [];
  state.active = -1;
}

function renderSuggestions() {
  const ul = $('suggestions');
  ul.innerHTML = '';
  state.suggestions.forEach((s, i) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.className = i === state.active ? 'active' : '';
    li.innerHTML = '<span></span><small></small>';
    li.firstChild.textContent = s.label;
    li.lastChild.textContent = s.sub;
    li.onmousedown = e => {
      e.preventDefault();
      submitGuess(s.value);
    };
    ul.appendChild(li);
  });
  ul.hidden = !state.suggestions.length;
}

function onInput() {
  if (!settings.search || DIFFICULTIES[settings.difficulty].noSearch) return hideSuggestions();
  const qtype = state.round?.qtype || 'title';
  state.suggestions = suggest(state.index[qtype], $('guess-input').value);
  state.active = state.suggestions.length ? 0 : -1;
  renderSuggestions();
}

function onInputKey(e) {
  if (!state.suggestions.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = state.suggestions.length;
    state.active = (state.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderSuggestions();
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
}

// ---------- Olaylar ----------

function changeSetting(key, value) {
  if (settings[key] === value) return;
  settings[key] = value;
  saveSettings();
  state.queued = null;
  renderOptions();
  newRound();
}

function bindGame() {
  $('opt-question').onchange = () => changeSetting('question', $('opt-question').value);
  $('opt-era').onchange = () => changeSetting('era', $('opt-era').value);
  $('opt-lang').onchange = () => changeSetting('lang', $('opt-lang').value);
  for (const b of $('qtabs').children) b.onclick = () => changeSetting('question', b.dataset.q);
  for (const b of $('source-buttons').children) b.onclick = () => changeSetting('source', b.dataset.source);
  $('btn-any-era').onclick = () => changeSetting('era', 'all');
  $('btn-reroll').onclick = newRound;
  $('btn-shuffle').onclick = newRound;

  $('opt-search').onchange = () => {
    settings.search = $('opt-search').checked;
    saveSettings();
    hideSuggestions();
  };
  $('opt-volume').oninput = () => {
    settings.volume = Number($('opt-volume').value);
    saveSettings();
    applyVolume();
  };

  $('btn-play').onclick = () => {
    const r = state.round;
    playClip(r?.done ? 15 : currentClip());
  };
  $('btn-skip').onclick = skip;
  $('btn-skip-choice').onclick = skip;
  $('btn-next').onclick = newRound;
  $('btn-listen').onclick = () => playClip(15);

  $('answer-type').onsubmit = e => {
    e.preventDefault();
    const pick = state.suggestions[state.active];
    submitGuess(pick ? pick.value : $('guess-input').value);
  };
  $('guess-input').oninput = onInput;
  $('guess-input').onkeydown = onInputKey;
  $('guess-input').onblur = () => setTimeout(hideSuggestions, 100);

  document.addEventListener('keydown', e => {
    if ($('screen-game').hidden) return;
    const typing = e.target.matches('input:not([type=range]):not([type=checkbox]), select, textarea');
    if (e.code === 'Space' && !typing) {
      e.preventDefault();
      $('btn-play').click();
    } else if (e.key === 'Enter' && state.round?.done && !typing && e.target.tagName !== 'BUTTON') {
      newRound();
    }
  });

  $('btn-refresh').onclick = async () => {
    try {
      if (state.provider === 'playlist') {
        const lib = await loadPlaylist(localStorage.getItem('ls.playlistId'));
        startGame(lib.tracks, 'playlist');
        return;
      }
      if (state.provider === 'youtube') {
        if (!yt.hasValidToken()) await yt.login();
        const lib = await loadYoutubeLibrary();
        startGame(lib.tracks, 'youtube');
        return;
      }
      const lib = await loadLibrary(true);
      startGame(lib.tracks, 'spotify');
    } catch (err) {
      show('game');
      showError('game-error', err);
    }
  };
  $('btn-logout').onclick = () => {
    stopAudio();
    if (state.provider !== 'demo') {
      auth.logout();
      yt.logout();
      clearLibrary();
      localStorage.removeItem(KEY_PROVIDER);
    }
    show('setup');
  };
}

async function main() {
  initSetup();
  bindGame();
  try {
    if (await auth.handleRedirect()) localStorage.setItem(KEY_PROVIDER, 'spotify');
    const provider = localStorage.getItem(KEY_PROVIDER) || (auth.isLoggedIn() ? 'spotify' : '');
    if (provider === 'youtube' || provider === 'playlist') {
      const cached = loadCachedLibrary();
      if (cached?.provider === provider && cached.tracks.length) return startGame(cached.tracks, provider);
      return show('setup');
    }
    if (!auth.isLoggedIn()) return show('setup');
    const lib = await loadLibrary();
    if (!lib.tracks.length) throw new Error('Spotify\'da beğenilen şarkın yok gibi görünüyor.');
    startGame(lib.tracks, 'spotify');
  } catch (err) {
    show('setup');
    showError('setup-error', err);
  }
}

main();
