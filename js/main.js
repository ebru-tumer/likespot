import * as auth from './auth.js';
import {
  loadCachedLibrary, fetchLikedSongs, clearLibrary, hasLibrary, mergeLibraries,
  fetchSpotifyPlaylists, fetchSpotifyPlaylistTracks,
} from './library.js';
import * as yt from './youtube.js';
import { PreviewPlayer, SpotifyPlayer, normalize } from './players.js';
import {
  DIFFICULTIES, Picker, isCorrect, points, makeChoices, buildIndex, suggest, rankItems, loadStats, saveStats,
} from './game.js';
import { DEMO_TRACKS } from './demo.js';
import { tagLanguages, fetchArtistGenres } from './language.js';
import { searchCatalog } from './catalog.js';
import { tagPopularity, fetchPopularity } from './popularity.js';
import * as sources from './sources.js';
import * as ost from './ost.js';
import * as charts from './charts.js';

const $ = id => document.getElementById(id);
const KEY_SETTINGS = 'ls.settings';
const KEY_PROVIDER = 'ls.provider';

const preview = new PreviewPlayer();
const spotify = new SpotifyPlayer();
const picker = new Picker();

const settings = {
  difficulty: 'expert', question: 'title', era: 'all', lang: 'all', source: 'preview', volume: 90, volumeCurve: 3,
};
try {
  const saved = JSON.parse(localStorage.getItem(KEY_SETTINGS));
  // Önceki sürüm oyun müziklerine ilk girişte soruyu kalıcı olarak "Oyun"a (artist) çeviriyordu; geri al.
  if (saved && localStorage.getItem('ls.ost.started')) {
    if (saved.question === 'artist') saved.question = 'title';
    localStorage.removeItem('ls.ost.started');
  }
  // Eski sürümde ses düzeyi doğrusal uygulanıyordu; aynı yükseklikte kalsın diye yeni (küp) ölçeğe çevrilir.
  if (saved && !saved.volumeCurve && typeof saved.volume === 'number') {
    saved.volume = Math.round(Math.cbrt(saved.volume / 100) * 100);
  }
  Object.assign(settings, saved, { volumeCurve: 3 });
  if (saved) localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
} catch { /* varsayılanlar */ }

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
  $('btn-charts').onclick = () => startCharts().catch(err => {
    show('setup');
    showError('setup-error', err);
  });
  $('btn-ost').onclick = () => startOst().catch(err => {
    show('setup');
    showError('setup-error', err);
  });
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
  const cached = !force && loadCachedLibrary('spotify');
  // Eski önbellekte sanatçı kimlikleri yok; dil tespiti için yeniden çekilir.
  if (cached?.tracks?.length && cached.tracks[0].artistIds) return cached;
  show('loading');
  $('loading-text').textContent = 'Beğenilen şarkılar yükleniyor…';
  $('loading-bar').style.width = '0%';
  return fetchLikedSongs((done, total) => {
    $('loading-text').textContent = `Beğenilen şarkılar yükleniyor… ${done} / ${total}`;
    $('loading-bar').style.width = `${total ? (done / total) * 100 : 100}%`;
  });
}

// ---------- Hesaplar arası geçiş ----------

const PROVIDERS = { spotify: 'Spotify', youtube: 'YouTube Music', playlist: 'Çalma listesi' };
const OST_LABEL = 'Oyun müzikleri';

function renderProviders() {
  const sel = $('opt-provider');
  sel.innerHTML = '';
  for (const [key, label] of Object.entries(PROVIDERS)) {
    const connected = hasLibrary(key);
    // Çalma listesi ancak daha önce bir liste yüklendiyse seçilebilir.
    if (key === 'playlist' && !connected && state.provider !== 'playlist') continue;
    const opt = new Option(connected || key === state.provider ? label : `${label} (bağlan)`, key);
    sel.add(opt);
  }
  // İki hesap da bağlıysa ikisinden ortak soru sorulabilir.
  if (hasLibrary('spotify') && hasLibrary('youtube')) sel.add(new Option('İkisi birden', 'both'));
  // Oyun müzikleri her zaman seçilebilir; hesap gerekmez.
  sel.add(new Option(CHARTS_LABEL, 'charts'));
  sel.add(new Option(OST_LABEL, 'ost'));
  if (state.provider === 'demo') sel.add(new Option('Demo', 'demo'));
  sel.value = state.provider;
}

// Seçilen hesaba geçer: listesi kayıtlıysa hemen, değilse önce bağlanır.
function bothTracks() {
  return mergeLibraries(loadCachedLibrary('spotify')?.tracks || [], loadCachedLibrary('youtube')?.tracks || []);
}

async function switchProvider(p) {
  if (p === state.provider) return;
  stopAudio();
  $('game-error').hidden = true;
  try {
    if (p === 'both') return startGame(bothTracks(), 'both');
    if (p === 'ost') return await startOst();
    if (p === 'charts') return await startCharts();
    if (p === 'spotify') {
      if (!auth.isLoggedIn()) {
        localStorage.setItem(KEY_PROVIDER, 'spotify');
        await auth.login(); // Spotify'a yönlendirir, dönünce liste yüklenir.
        return;
      }
      const lib = await loadLibrary();
      return startGame(lib.tracks, 'spotify');
    }
    if (p === 'youtube') {
      const cached = loadCachedLibrary('youtube');
      if (cached?.tracks?.length) return startGame(cached.tracks, 'youtube');
      await yt.login();
      const lib = await loadYoutubeLibrary();
      return startGame(lib.tracks, 'youtube');
    }
    const cached = loadCachedLibrary(p);
    if (cached?.tracks?.length) return startGame(cached.tracks, p);
  } catch (err) {
    show('game');
    renderProviders();
    showError('game-error', err);
  }
}

// ---------- Çalma listesi seçimi ----------

const listTried = new Set();

function sourceProviders() {
  if (state.provider === 'both') return ['spotify', 'youtube'];
  return state.provider === 'spotify' || state.provider === 'youtube' ? [state.provider] : [];
}

function renderSources() {
  const box = $('sources');
  box.innerHTML = '';
  if (state.provider === 'ost') {
    $('sources-label').textContent = 'Oyunlar';
    $('sources-group').hidden = false;
    renderOstGames(box);
    return;
  }
  if (state.provider === 'charts') {
    $('sources-label').textContent = 'Şarkılar';
    $('sources-group').hidden = false;
    renderChartsPicker(box);
    return;
  }
  $('sources-label').textContent = 'Şarkılar';
  const providers = sourceProviders();
  $('sources-group').hidden = !providers.length;
  for (const p of providers) {
    if (providers.length > 1) {
      const h = document.createElement('p');
      h.className = 'sources-head';
      h.textContent = PROVIDERS[p];
      box.appendChild(h);
    }
    const sel = sources.getSelection(p);
    const liked = loadCachedLibrary(p)?.tracks?.length ?? 0;
    box.appendChild(sourceRow(p, sources.LIKED, 'Beğenilen şarkılar', liked, sel.includes(sources.LIKED)));
    const lists = sources.getPlaylists(p);
    if (lists) {
      for (const l of lists) {
        const count = sources.getPlaylistTracks(p, l.id)?.length ?? l.count;
        box.appendChild(sourceRow(p, l.id, l.name, count, sel.includes(l.id)));
      }
      if (!lists.length) box.appendChild(sourceNote('Çalma listen yok.'));
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'side-link';
      b.textContent = 'Çalma listelerini göster';
      b.onclick = () => loadPlaylistList(p, true);
      box.appendChild(b);
      // Giriş geçerliyse listeleri sormadan getir.
      if (!listTried.has(p)) {
        listTried.add(p);
        loadPlaylistList(p, false);
      }
    }
  }
}

function sourceNote(text) {
  const n = document.createElement('p');
  n.className = 'sources-note';
  n.textContent = text;
  return n;
}

function sourceRow(provider, id, name, count, checked) {
  const label = document.createElement('label');
  label.className = 'source';
  label.innerHTML = '<input type="checkbox"><span></span><small></small>';
  const box = label.firstChild;
  box.checked = checked;
  label.children[1].textContent = name;
  label.children[2].textContent = count ?? '';
  label.title = name;
  box.onchange = () => toggleSource(provider, id, box.checked, label);
  return label;
}

// interactive: bir tıklamadan geldiyse gerekirse giriş penceresi açılabilir.
async function loadPlaylistList(p, interactive) {
  try {
    if (p === 'spotify') {
      if (!auth.hasPlaylistScope()) {
        if (!interactive) return;
        // Eski girişte çalma listesi izni yok: Spotify'a yeniden bağlan, dönünce listeler gelir.
        await auth.login();
        return;
      }
      sources.savePlaylists(p, await fetchSpotifyPlaylists());
    } else {
      if (!yt.hasValidToken()) {
        if (!interactive) return;
        await yt.login();
      }
      sources.savePlaylists(p, await yt.fetchMyPlaylists());
    }
    renderSources();
  } catch (err) {
    if (interactive) showError('game-error', err);
  }
}

async function toggleSource(provider, id, checked, row) {
  const sel = sources.getSelection(provider).filter(x => x !== id);
  if (checked) sel.push(id);
  if (!sel.length) {
    row.firstChild.checked = true;
    return showError('game-error', new Error('En az bir liste seçili olmalı.'));
  }
  $('game-error').hidden = true;
  try {
    if (checked && id !== sources.LIKED && !sources.getPlaylistTracks(provider, id)) {
      row.classList.add('loading');
      let tracks;
      if (provider === 'spotify') {
        tracks = await fetchSpotifyPlaylistTracks(id);
      } else {
        if (!yt.hasValidToken()) await yt.login();
        tracks = await yt.fetchMyPlaylistTracks(id);
      }
      if (!tracks.length) throw new Error('Bu çalma listesinden şarkı okunamadı.');
      sources.savePlaylistTracks(provider, id, tracks);
    }
    sources.setSelection(provider, sel);
    startGame(state.tracks, state.provider);
  } catch (err) {
    renderSources();
    showError('game-error', err);
  }
}

// ---------- Hit şarkılar modu (hesapsız, tür + dönem) ----------

const CHARTS_LABEL = 'Hit şarkılar';

async function startCharts() {
  stopAudio();
  show('loading');
  $('loading-text').textContent = 'Şarkılar yükleniyor…';
  $('loading-bar').style.width = '60%';
  const tracks = await charts.loadSelectedTracks();
  if (!tracks.length) throw new Error('Şarkılar yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.');
  startGame(tracks, 'charts');
}

function renderChartsPicker(box) {
  const sel = charts.getSelection();
  const heading = text => {
    const h = document.createElement('p');
    h.className = 'sources-head';
    h.textContent = text;
    box.appendChild(h);
  };
  heading('Tür');
  for (const g of charts.GENRES) {
    const row = sourceRow('charts', g.id, g.name, null, sel.genres.includes(g.id));
    row.querySelector('input').onchange = e => toggleCharts('genres', g.id, e.target.checked, row);
    box.appendChild(row);
  }
  heading('Dönem');
  for (const era of charts.ERAS) {
    const row = sourceRow('charts', era.id, era.name, null, sel.eras.includes(era.id));
    row.querySelector('input').onchange = e => toggleCharts('eras', era.id, e.target.checked, row);
    box.appendChild(row);
  }
}

async function toggleCharts(kind, id, checked, row) {
  const sel = { ...charts.getSelection() };
  sel[kind] = sel[kind].filter(x => x !== id);
  if (checked) sel[kind].push(id);
  if (!sel[kind].length) {
    row.querySelector('input').checked = true;
    return showError('game-error', new Error(kind === 'genres' ? 'En az bir tür seçili olmalı.' : 'En az bir dönem seçili olmalı.'));
  }
  $('game-error').hidden = true;
  row.classList.add('loading');
  try {
    const tracks = await charts.loadSelectedTracks(sel);
    if (!tracks.length) throw new Error('Bu tür ve dönem seçiminde şarkı bulunamadı.');
    charts.setSelection(sel);
    useTracks(tracks);
    newRound();
  } catch (err) {
    renderSources();
    showError('game-error', err);
  }
}

// ---------- Oyun müzikleri modu ----------

// Sol paneldeki düğme: hesaplı moddan oyun müziklerine, oradan da son hesaba geçer.
// Sol paneldeki mod düğmeleri: hesaplı moddan oyun müziklerine ya da hit şarkılara geçer,
// o moddayken de son kullanılan hesaba döner.
const MODE_BUTTONS = { ost: ['btn-ost-toggle', 'Oyun müzikleri'], charts: ['btn-charts-toggle', 'Hit şarkılar'] };

function renderOstToggle() {
  const back = localStorage.getItem('ls.lastProvider');
  for (const [mode, [id, label]] of Object.entries(MODE_BUTTONS)) {
    const active = state.provider === mode;
    $(id).hidden = active && !back;
    $(id).querySelector('span').textContent = active ? '← Kendi şarkılarım' : label;
    $(id).onclick = () => switchProvider(active && back ? back : mode);
  }
}

// Hesap gerekmez: seçili oyunların soundtrack'lerinden soru gelir. İlk girişte soru "Oyun" olur.
async function startOst() {
  stopAudio();
  show('loading');
  $('loading-text').textContent = 'Oyun müzikleri yükleniyor…';
  $('loading-bar').style.width = '60%';
  const tracks = await ost.loadSelectedTracks();
  if (!tracks.length) throw new Error('Oyun müzikleri yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.');
  startGame(tracks, 'ost');
}

function renderOstGames(box) {
  const selected = ost.getSelectedGames();
  for (const g of ost.GAMES) {
    const count = ost.cachedGameTracks(g.id)?.length;
    const row = sourceRow('ost', g.id, g.name, count, selected.includes(g.id));
    row.querySelector('input').onchange = e => toggleGame(g, e.target.checked, row);
    box.appendChild(row);
  }
}

async function toggleGame(game, checked, row) {
  const selected = ost.getSelectedGames().filter(id => id !== game.id);
  if (checked) selected.push(game.id);
  if (!selected.length) {
    row.querySelector('input').checked = true;
    return showError('game-error', new Error('En az bir oyun seçili olmalı.'));
  }
  $('game-error').hidden = true;
  try {
    if (checked) {
      row.classList.add('loading');
      const tracks = await ost.fetchGameTracks(game);
      if (!tracks.length) throw new Error(`${game.name} müzikleri bulunamadı.`);
    }
    ost.setSelectedGames(selected);
    useTracks(await ost.loadSelectedTracks());
    newRound();
  } catch (err) {
    renderSources();
    showError('game-error', err);
  }
}

// ---------- Oyun ----------

// Hesabın seçili kaynakları (beğenilenler + çalma listeleri); seçimden şarkı çıkmazsa verilen liste.
function selectedTracks(provider, fallback) {
  let tracks = [];
  if (provider === 'spotify' || provider === 'youtube') tracks = sources.tracksFor(provider);
  if (provider === 'both') tracks = mergeLibraries(sources.tracksFor('spotify'), sources.tracksFor('youtube'));
  return tracks.length ? tracks : fallback;
}

// Arka plan taramaları üst üste binmesin diye sıraya alınır.
let genresRun = Promise.resolve();
let popularityRun = Promise.resolve();

// Şarkı listesini oyuna yükler (yeni tur başlatmadan): öneri dizini, dil ve popülerlik.
function useTracks(tracks) {
  state.tracks = tracks;
  state.queued = null;
  state.index = { title: buildIndex('title', tracks), artist: buildIndex('artist', tracks) };
  if (state.provider === 'ost') {
    state.index.artist = ost.gameSuggestionIndex(normalize);
    // Parça adında oyunun kısaltmasıyla da aranabilsin ("pvz gras" → Grasswalk).
    for (const item of state.index.title) {
      const game = ost.GAMES.find(g => g.name === item.sub);
      if (game?.aliases) item.search += ` ${normalize(game.aliases.join(' '))}`;
    }
  }
  renderSources();
  renderLibInfo();
  // Oyun müziklerinde dil taraması yok ama popülerlik var (zorluk dilimleri için).
  if (state.provider === 'charts') return;
  if (state.provider !== 'ost') tagLanguages(tracks);
  tagPopularity(tracks);
  renderLibInfo();
  if (state.provider === 'spotify' || state.provider === 'both') {
    genresRun = genresRun.then(() => fetchArtistGenres(tracks, (done, total, genres) => {
      tagLanguages(tracks, genres);
      notes.lang = done < total ? `dil taranıyor ${done}/${total}` : '';
      renderLibInfo();
    }));
  }
  popularityRun = popularityRun.then(() => fetchPopularity(tracks, (done, total) => {
    if (state.tracks !== tracks) return;
    notes.pop = done < total ? `popülerlik taranıyor ${done}/${total}` : '';
    renderLibInfo();
  }));
}

function startGame(tracks, provider) {
  const demo = provider === 'demo';
  state.provider = provider;
  if (!demo) localStorage.setItem(KEY_PROVIDER, provider);
  // Oyun müziklerinden çıkınca dönülecek hesap.
  if (!demo && provider !== 'ost' && provider !== 'charts') localStorage.setItem('ls.lastProvider', provider);
  renderProviders();
  renderOstToggle();
  useTracks(selectedTracks(provider, tracks));
  show('game');

  $('btn-refresh').hidden = demo || provider === 'ost' || provider === 'charts';
  $('lang-group').hidden = provider === 'ost' || provider === 'charts';
  $('era-group').hidden = provider === 'charts' || provider === 'ost';
  $('btn-logout').textContent = {
    demo: 'Demodan çık', spotify: "Spotify'dan çık", youtube: "YouTube'dan çık", playlist: 'Listeyi kapat',
    ost: 'Moddan çık',
    charts: 'Moddan çık',
    both: 'Tek hesaba dön',
  }[provider];

  renderStats();
  renderOptions();
  newRound();
  autoSync();
}

// ---------- Güncelleme ----------

// Beğenilenler, çalma listesi adları ve seçili listelerin şarkıları bu süreden eskiyse
// site açılınca arka planda yenilenir.
const SYNC_MS = 60 * 60 * 1000;
const syncing = new Set();

const lastSync = p => Number(localStorage.getItem(`ls.synced.${p}`)) || loadCachedLibrary(p)?.fetchedAt || 0;

// interactive: tıklamayla başladıysa gerekirse giriş penceresi açılabilir.
async function syncProvider(p, interactive) {
  if (syncing.has(p)) return false;
  syncing.add(p);
  try {
    if (p === 'spotify') {
      if (!auth.isLoggedIn()) return false;
      await fetchLikedSongs();
      if (auth.hasPlaylistScope()) await syncPlaylists(p, fetchSpotifyPlaylists, fetchSpotifyPlaylistTracks);
    } else {
      if (!yt.hasValidToken()) {
        if (!interactive) return false;
        await yt.login();
      }
      await yt.fetchYoutubeLikes();
      await syncPlaylists(p, yt.fetchMyPlaylists, yt.fetchMyPlaylistTracks);
    }
    localStorage.setItem(`ls.synced.${p}`, String(Date.now()));
    return true;
  } finally {
    syncing.delete(p);
  }
}

// Liste adlarını yeniler, silinen listeleri seçimden çıkarır, seçili listelerin şarkılarını yeniden çeker.
// Seçili olmayan listelerin eski şarkıları silinir; tekrar seçilince güncel hâli indirilir.
async function syncPlaylists(p, fetchLists, fetchTracks) {
  const lists = await fetchLists();
  const ids = new Set(lists.map(l => l.id));
  for (const old of sources.getPlaylists(p) || []) {
    if (!ids.has(old.id)) sources.forgetPlaylistTracks(p, old.id);
  }
  sources.savePlaylists(p, lists);
  const selected = sources.getSelection(p).filter(id => id === sources.LIKED || ids.has(id));
  sources.setSelection(p, selected);
  for (const l of lists) {
    if (!selected.includes(l.id)) {
      sources.forgetPlaylistTracks(p, l.id);
      continue;
    }
    const tracks = await fetchTracks(l.id);
    if (tracks.length) sources.savePlaylistTracks(p, l.id, tracks);
  }
}

function autoSync() {
  const provider = state.provider;
  const due = sourceProviders().filter(p => Date.now() - lastSync(p) > SYNC_MS);
  if (!due.length) return;
  notes.sync = 'listeler güncelleniyor…';
  renderLibInfo();
  Promise.allSettled(due.map(p => syncProvider(p, false))).then(results => {
    notes.sync = '';
    if (state.provider !== provider) return;
    if (results.some(r => r.value === true)) useTracks(selectedTracks(provider, state.tracks));
    else renderLibInfo();
  });
}

const notes = { lang: '', pop: '', sync: '' };

function renderLibInfo() {
  const t = state.tracks;
  const tr = t.filter(x => x.lang === 'tr').length;
  if (state.provider === 'charts') {
    $('lib-info').textContent = `${CHARTS_LABEL} · ${t.length.toLocaleString('tr')} şarkı · ${charts.describe()}`;
    return;
  }
  if (state.provider === 'ost') {
    $('lib-info').textContent = [`${OST_LABEL} · ${t.length.toLocaleString('tr')} parça · ${ost.getSelectedGames().length} oyun`,
      notes.pop].filter(Boolean).join(' · ');
    return;
  }
  const base = state.provider === 'demo'
    ? `Demo · ${t.length} popüler şarkı`
    : state.provider === 'playlist'
      ? `Çalma listesi · ${t.length.toLocaleString('tr')} şarkı`
      : `${t.length.toLocaleString('tr')} şarkı · ${
        { spotify: 'Spotify', youtube: 'YouTube Music', both: 'Spotify + YouTube Music' }[state.provider]}`;
  $('lib-info').textContent = [base, `${tr.toLocaleString('tr')} Türkçe`, notes.sync, notes.lang, notes.pop]
    .filter(Boolean).join(' · ');
}

// Bilinen şarkıdan sonra bir üst zorluğa geçilir; İmkânsız'dan sonra Kolay'a dönülür.
// Bilinemediyse aynı zorlukta kalınır.
function nextSong() {
  if (!state.round?.won) return newRound();
  const keys = Object.keys(DIFFICULTIES);
  const next = keys[(keys.indexOf(settings.difficulty) + 1) % keys.length];
  setDifficulty(next);
}

function setDifficulty(key) {
  if (key === settings.difficulty) return;
  settings.difficulty = key;
  saveSettings();
  state.queued = null;
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
  // Oyun müziklerinde amaç parçanın adını bulmak; soru seçenekleri bu modda gizlenir.
  const isOst = state.provider === 'ost';
  $('qtabs').style.visibility = isOst ? 'hidden' : '';
  $('question-group').hidden = isOst;

  const canSpotify = state.provider === 'spotify';
  const source = canSpotify ? settings.source : 'preview';
  for (const b of $('source-buttons').children) {
    b.classList.toggle('active', b.dataset.source === source);
    // Spotify'dan çalma sadece Spotify ile bağlanınca anlamlı; diğerlerinde seçenek hiç görünmez.
    b.hidden = !canSpotify && b.dataset.source === 'spotify';
  }

  $('opt-volume').value = settings.volume;
  applyVolume();
}

// Kulak sesi doğrusal duymadığı için kaydırıcı küpüyle uygulanır: yarıda ses gerçekten yarı
// yüksek gelir (~-18 dB), en düşük kademelerde de kısılmaya devam eder.
function applyVolume() {
  const v = (settings.volume / 100) ** 3;
  preview.setVolume(v);
  spotify.volume = v;
  if (state.playing && player() === spotify) spotify.player?.setVolume(v);
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

// Oyun müziklerinde dil filtresi anlamsız.
function langFilter() {
  return state.provider === 'ost' || state.provider === 'charts' ? 'all' : settings.lang;
}

// Hit şarkılarda dönem soldaki Şarkılar bölümünden seçilir; oyun müziklerinde dönem önemsiz.
function eraFilter() {
  return state.provider === 'charts' || state.provider === 'ost' ? 'all' : settings.era;
}

// Zorluğun sırası (0 = Kolay) aynı zamanda şarkının popülerlik dilimidir.
function tier() {
  return Object.keys(DIFFICULTIES).indexOf(settings.difficulty);
}

// Ön izlemesi olmayan şarkıları atlayarak oynanabilir bir şarkı bulur.
async function pickPlayable() {
  for (let i = 0; i < 12; i++) {
    let track = state.queued;
    state.queued = null;
    if (!track) track = picker.next(state.tracks, eraFilter(), langFilter(), tier(), state.provider === 'ost');
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
  const next = picker.next(state.tracks, eraFilter(), langFilter(), tier(), state.provider === 'ost');
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
  const qtype = state.provider === 'ost' ? 'title'
    : settings.question === 'mixed' ? (Math.random() < 0.5 ? 'title' : 'artist') : settings.question;

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
  const clipsLeft = r && !r.done && r.step < DIFFICULTIES[settings.difficulty].clips.length - 1;
  $('timeline').classList.toggle('locked', !clipsLeft);
  $('timeline').title = clipsLeft ? 'Bir sonraki süreyi aç' : '';
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
  const qtype = r?.qtype || (settings.question === 'artist' && state.provider !== 'ost' ? 'artist' : 'title');

  const isOst = state.provider === 'ost';
  $('question').textContent = qtype === 'artist'
    ? (isOst ? 'Bu hangi oyunun müziği?' : 'Bu şarkıyı kim söylüyor?')
    : (isOst ? 'Bu parçanın adı ne?' : 'Bu şarkının adı ne?');
  $('guess-input').placeholder = qtype === 'artist'
    ? (isOst ? 'Oyunu bil' : 'Sanatçıyı bil')
    : (isOst ? 'Parçayı bil' : 'Şarkıyı bil');

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
  if (state.provider === 'ost') {
    // Oyun müziklerinde parçanın YouTube'daki aramasına gidilir (tam video için API kotası harcanmaz).
    const q = `${t.artists[0]} ${t.name} OST`;
    $('btn-open').href = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    $('btn-open').hidden = false;
    $('btn-open').textContent = "YouTube'da dinle";
  } else {
    $('btn-open').href = t.url || '#';
    $('btn-open').hidden = !t.url;
    $('btn-open').textContent = t.url.includes('spotify') ? "Spotify'da aç"
      : t.url.includes('youtube') ? "YouTube Music'te aç"
      : t.url.includes('deezer') ? "Deezer'da aç" : "Apple Music'te aç";
  }
  const keys = Object.keys(DIFFICULTIES);
  const nextKey = keys[(keys.indexOf(settings.difficulty) + 1) % keys.length];
  $('btn-next').textContent = !r.won ? 'Sonraki ⏎'
    : nextKey === keys[0] ? `Baştan: ${DIFFICULTIES[nextKey].label} ⏎`
    : `Sonraki: ${DIFFICULTIES[nextKey].label} ⏎`;
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
  clearTimeout(suggestTimer);
  suggestId++;
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

let suggestTimer;
let suggestId = 0;

// Öneriler tüm şarkılardan (Deezer kataloğu) gelir; kendi listendeki eşleşmeler de araya karışır,
// böylece listede olmak doğru cevabı ele vermez. Katalog yanıt vermezse sadece kendi listen gösterilir.
function onInput() {
  clearTimeout(suggestTimer);
  const text = $('guess-input').value;
  if (!text.trim()) return hideSuggestions();
  const qtype = state.round?.qtype || 'title';
  const id = ++suggestId;
  suggestTimer = setTimeout(async () => {
    const ostMode = state.provider === 'ost';
    // Oyun müziklerinde öneriler sadece seçili oyunların parçalarından/adlarından gelir.
    const local = suggest(state.index[qtype], text, ostMode ? 8 : 4);
    let catalog = [];
    if (!ostMode) {
      try {
        catalog = await searchCatalog(qtype, text);
      } catch {
        // Katalog yoksa yerel öneriler yeter.
      }
    }
    if (id !== suggestId) return;
    state.suggestions = rankItems([...catalog, ...local], text);
    state.active = state.suggestions.length ? 0 : -1;
    renderSuggestions();
  }, 250);
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
  // Süre çubuğuna tıklamak da bir sonraki süreyi açar (Atla ile aynı).
  // Son süredeyken tıklamak turu bitirmez.
  $('timeline').onclick = () => {
    if (!$('timeline').classList.contains('locked')) skip();
  };
  $('btn-skip-choice').onclick = skip;
  $('btn-next').onclick = nextSong;
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
      nextSong();
    }
  });

  $('btn-refresh').onclick = async () => {
    try {
      if (state.provider === 'playlist') {
        const lib = await loadPlaylist(localStorage.getItem('ls.playlistId'));
        startGame(lib.tracks, 'playlist');
        return;
      }
      // Beğenilenler + çalma listeleri; oynanan tur bozulmadan yeni şarkılar eklenir.
      const providers = sourceProviders();
      // Google giriş penceresi tıklamadan hemen sonra açılmalı, o yüzden önce o.
      if (providers.includes('youtube') && !yt.hasValidToken()) await yt.login();
      notes.sync = 'listeler güncelleniyor…';
      renderLibInfo();
      try {
        for (const p of providers) await syncProvider(p, true);
      } finally {
        notes.sync = '';
      }
      useTracks(selectedTracks(state.provider, state.tracks));
    } catch (err) {
      show('game');
      showError('game-error', err);
    }
  };
  $('opt-provider').onchange = () => switchProvider($('opt-provider').value);

  // Sadece şu anki hesaptan çıkar; bağlı başka bir hesap varsa ona geçer.
  $('btn-logout').onclick = () => {
    stopAudio();
    const p = state.provider;
    // "İkisi birden" modunda çıkış yerine tek hesaba (Spotify) dönülür.
    if (p === 'both') return switchProvider('spotify');
    if (p === 'ost' || p === 'charts') {
      const other = Object.keys(PROVIDERS).find(k => hasLibrary(k));
      if (other) return switchProvider(other);
      localStorage.removeItem(KEY_PROVIDER);
      return show('setup');
    }
    if (p === 'spotify') auth.logout();
    if (p === 'youtube') yt.logout();
    if (p === 'playlist') localStorage.removeItem('ls.playlistId');
    if (p !== 'demo') {
      clearLibrary(p);
      sources.clearSources(p);
    }
    const other = Object.keys(PROVIDERS).find(k => hasLibrary(k));
    if (other) return startGame(loadCachedLibrary(other).tracks, other);
    localStorage.removeItem(KEY_PROVIDER);
    show('setup');
  };
}

async function main() {
  initSetup();
  bindGame();
  try {
    if (await auth.handleRedirect()) localStorage.setItem(KEY_PROVIDER, 'spotify');
    const provider = localStorage.getItem(KEY_PROVIDER) || (auth.isLoggedIn() ? 'spotify' : '');
    if (provider === 'ost') return await startOst();
    if (provider === 'charts') return await startCharts();
    if (provider === 'both' && hasLibrary('spotify') && hasLibrary('youtube')) {
      return startGame(bothTracks(), 'both');
    }
    if (provider === 'youtube' || provider === 'playlist') {
      const cached = loadCachedLibrary(provider);
      if (cached?.tracks?.length) return startGame(cached.tracks, provider);
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
