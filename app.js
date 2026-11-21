/* ============================================
   CONFIG
   ============================================ */
const DEFAULT_MEDIA = [
  { type: "website", url: "https://dimashrda.github.io/JadwalDokterRSUSYLVANI", name: "Jadwal Dokter", duration: 20 },
  { type: "website", url: "https://simrs.rsusylvani.net/tv/bed-info", name: "Info BAD", duration: 10 },
  { type: "website", url: "https://simrs.rsusylvani.net/tv/operation-schedule", name: "Jadwal Operasi", duration: 10 },
  { type: "website", url: "https://simrs.rsusylvani.net/antrol/display-antrol?mode=admisi", name: "Antian Admisi", duration: 10 },
  { type: "website", url: "https://simrs.rsusylvani.net/antrol/display-antrol?mode=poli", name: "Antian Poli", duration: 10 },
  { type: "website", url: "https://simrs.rsusylvani.net/antrol/display-antrol?mode=farmasi", name: "Antian Farmasi", duration: 10 },
];

const STORAGE_KEY = 'slideshow_media_v2';
const DB_NAME = 'slideshow_files_db';
const DB_STORE = 'mediaFiles';

/* ============================================
   STATE
   ============================================ */
let mediaList = loadFromStorage() || structuredClone(DEFAULT_MEDIA);
let defaultDuration = 10;
let currentIndex = 0;
let isPlaying = false;
let elapsedMs = 0;
let lastTick = 0;
let currentVideo = null;
let currentSlideDuration = 0;
let videoDurationKnown = false;
let hasInteracted = false;
const blobUrlCache = new Map();

/* ============================================
   DOM
   ============================================ */
const $ = (id) => document.getElementById(id);
const stageEl = $('stage');
const pagerEl = $('pager');
const progressBar = $('progressBar');
const playBtn = $('playBtn');
const mediaFileInput = $('mediaFileInput');
const adminPanel = $('adminPanel');
const adminBody = $('adminBody');
const overlay = $('overlay');

/* ============================================
   STORAGE
   ============================================ */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mediaList));
  } catch (e) {
    console.warn('Gagal simpan:', e);
  }
}

/* ============================================
   INDEXEDDB
   ============================================ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(blob, id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function removeBlob(id) {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = tx.onerror = () => { db.close(); resolve(); };
  });
}

async function hydrateBlobs() {
  for (const media of mediaList) {
    if (media.fileId && !blobUrlCache.has(media.fileId)) {
      try {
        const blob = await getBlob(media.fileId);
        if (blob) blobUrlCache.set(media.fileId, URL.createObjectURL(blob));
      } catch (err) {
        console.warn('File tidak terbaca:', err);
      }
    }
  }
}

function srcFor(media) {
  return media.fileId
    ? (blobUrlCache.get(media.fileId) || '')
    : (media.url || '');
}

/* ============================================
   HELPERS
   ============================================ */
function getDurationMs(index) {
  const media = mediaList[index] || {};
  const custom = Number(media.duration);
  if (media.duration !== '' && media.duration != null && Number.isFinite(custom) && custom > 0) {
    return custom * 1000;
  }
  return defaultDuration * 1000;
}

function pauseCurrentVideo() {
  if (currentVideo) {
    if (currentVideo.tagName === 'IFRAME') {
      // YouTube iframe handling (pause)
      currentVideo.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    } else {
      currentVideo.pause();
    }
    currentVideo = null;
  }
}

function isYouTube(url) {
  return /youtube\.com|youtu\.be/i.test(url);
}

function getYoutubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

/* ============================================
   RENDER — STAGE
   ============================================ */
function renderStage() {
  pauseCurrentVideo();
  stageEl.innerHTML = '';
  pagerEl.innerHTML = '';

  mediaList.forEach((media, i) => {
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.dataset.index = i;
    slide.dataset.type = media.type;

    if (media.type === 'website') {
      slide.appendChild(makeLoader('Memuat ' + (media.name || 'website') + '...'));
      const iframe = document.createElement('iframe');
      iframe.src = media.url || 'about:blank';
      iframe.loading = 'lazy';
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.addEventListener('load', () => clearLoader(slide));
      slide.appendChild(iframe);
    } else if (media.type === 'image') {
      slide.appendChild(makeLoader('Memuat foto...'));
      const img = document.createElement('img');
      img.src = srcFor(media);
      img.alt = media.name || 'Slide';
      img.onload = () => clearLoader(slide);
      img.onerror = () => showError(slide, 'Foto tidak dapat dimuat');
      slide.appendChild(img);
    } else if (media.type === 'video') {
      const src = srcFor(media);
      
      if (isYouTube(src)) {
        const ytId = getYoutubeId(src);
        if (ytId) {
          const iframe = document.createElement('iframe');
          // Hilangkan autoplay=1 di sini, agar tidak mutar otomatis saat dirender
          iframe.src = `https://www.youtube.com/embed/${ytId}?mute=0&controls=1&rel=0&modestbranding=1&enablejsapi=1`;
          iframe.allow = "autoplay; encrypted-media";
          iframe.setAttribute('allowfullscreen', 'true');
          slide.appendChild(iframe);
        } else {
          showError(slide, 'Format URL YouTube tidak valid');
        }
      } else {
        slide.appendChild(makeLoader('Memuat video...'));
        const video = document.createElement('video');
        video.src = src;
        
        // --- INI BAGIAN YANG DIPERBAIKI ---
        video.autoplay = false; // JANGAN autoplay saat dirender
        video.muted = false;
        video.playsInline = true;
        video.loop = false;
        video.preload = 'metadata'; // Hanya ambil info durasi, bukan langsung download
        
        video.addEventListener('loadeddata', () => clearLoader(slide));
        video.addEventListener('error', () => showError(slide, 'Video tidak dapat dimuat'));
        video.addEventListener('ended', () => {
          if (isPlaying && currentIndex === i && (media.duration == null || media.duration === '')) {
            nextSlide();
          }
        });
        slide.appendChild(video);
      }
    }

    stageEl.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = 'dot';
    dot.type = 'button';
    dot.dataset.type = media.type;
    dot.dataset.label = media.name || `Slide ${i + 1}`;
    dot.title = media.name || `Slide ${i + 1}`;
    dot.addEventListener('click', () => goToSlide(i));
    pagerEl.appendChild(dot);
  });

  if (mediaList.length) {
    currentIndex = Math.min(currentIndex, mediaList.length - 1);
    showSlide(currentIndex);
  } else {
    currentIndex = 0;
    progressBar.style.width = '0%';
  }
  updatePlayButton();
}

function makeLoader(text) {
  const el = document.createElement('div');
  el.className = 'slide-loading';
  el.innerHTML = `<div class="spinner"></div><span>${text}</span>`;
  return el;
}

function clearLoader(slide) {
  const loader = slide.querySelector('.slide-loading');
  if (loader) loader.remove();
}

function showError(slide, msg) {
  const loader = slide.querySelector('.slide-loading');
  if (loader) {
    loader.innerHTML = `<div class="slide-error">${msg}</div>`;
  }
}

/* ============================================
   NAVIGATION (Hanya putar video jika slide aktif)
   ============================================ */
function showSlide(index) {
  if (!mediaList.length) return;
  pauseCurrentVideo();

  const slides = stageEl.querySelectorAll('.slide');
  const dots = pagerEl.querySelectorAll('.dot');
  if (!slides.length) return;

  index = (index + slides.length) % slides.length;

  slides.forEach((s, i) => s.classList.toggle('is-active', i === index));
  dots.forEach((d, i) => d.classList.toggle('is-active', i === index));
  currentIndex = index;

  const media = mediaList[index];
  currentSlideDuration = getDurationMs(index);
  videoDurationKnown = false;
  elapsedMs = 0;
  lastTick = 0;
  progressBar.style.width = '0%';

  if (media.type === 'video') {
    const mediaEl = slides[index].querySelector('video, iframe');
    currentVideo = mediaEl;

    if (mediaEl) {
      if (mediaEl.tagName === 'VIDEO') {
        mediaEl.currentTime = 0;
        mediaEl.muted = !hasInteracted;
        
        mediaEl.onloadedmetadata = () => {
          videoDurationKnown = Number.isFinite(mediaEl.duration) && mediaEl.duration > 0;
          if (media.duration == null || media.duration === '') {
            currentSlideDuration = videoDurationKnown ? mediaEl.duration * 1000 : 0;
          } else {
            currentSlideDuration = getDurationMs(index);
          }
        };
        
        if (mediaEl.readyState >= 1) mediaEl.onloadedmetadata();
        
        // --- JIKA SLIDE INI AKTIF DAN LAGI PLAYING, BARU PUTAR VIDIONYA ---
        if (isPlaying) {
          mediaEl.play().catch(() => {});
        }
      } else if (mediaEl.tagName === 'IFRAME') {
        // Kirim perintah play ke YouTube API jika sedang playing
        if (isPlaying) {
          mediaEl.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        }
      }
    }
  }

  if (isPlaying) lastTick = performance.now();
}

function goToSlide(i) { showSlide(i); }
function nextSlide() { if (mediaList.length) showSlide((currentIndex + 1) % mediaList.length); }
function prevSlide() { if (mediaList.length) showSlide((currentIndex - 1 + mediaList.length) % mediaList.length); }

/* ============================================
   PLAYBACK TICK
   ============================================ */
function tick(now) {
  if (isPlaying && mediaList.length) {
    const media = mediaList[currentIndex];

    if (media.type === 'video' && currentVideo) {
      if (media.duration == null || media.duration === '') {
        if (currentVideo.tagName === 'VIDEO') {
          if (currentVideo.ended) nextSlide();
          const d = currentVideo.duration;
          if (Number.isFinite(d) && d > 0) {
            progressBar.style.width = Math.min(currentVideo.currentTime / d * 100, 100) + '%';
          } else {
            progressBar.style.width = '0%';
          }
        } else if (currentVideo.tagName === 'IFRAME') {
           if (lastTick) elapsedMs += Math.max(0, now - lastTick);
           lastTick = now;
           const total = currentSlideDuration || getDurationMs(currentIndex);
           progressBar.style.width = Math.min(elapsedMs / total * 100, 100) + '%';
           if (elapsedMs >= total) nextSlide();
        }
      } else {
        const total = currentSlideDuration || getDurationMs(currentIndex);
        let elapsed = 0;
        if (currentVideo.tagName === 'VIDEO') {
          elapsed = currentVideo.currentTime * 1000;
        } else {
          if (lastTick) elapsedMs += Math.max(0, now - lastTick);
          lastTick = now;
          elapsed = elapsedMs;
        }
        progressBar.style.width = Math.min(elapsed / total * 100, 100) + '%';
        if (elapsed >= total) nextSlide();
      }
    } else {
      if (lastTick) elapsedMs += Math.max(0, now - lastTick);
      lastTick = now;
      const total = currentSlideDuration || getDurationMs(currentIndex);
      progressBar.style.width = Math.min(elapsedMs / total * 100, 100) + '%';
      if (elapsedMs >= total) nextSlide();
    }
  } else {
    lastTick = 0;
  }
  requestAnimationFrame(tick);
}

/* ============================================
   PLAY / PAUSE
   ============================================ */
function updatePlayButton() {
  if (isPlaying) {
    playBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" rx="1"/>
        <rect x="14" y="4" width="4" height="16" rx="1"/>
      </svg>
      <span>Jeda</span>`;
    playBtn.classList.remove('btn-primary');
    playBtn.classList.add('is-playing');
  } else {
    playBtn.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      <span>Mulai</span>`;
    playBtn.classList.add('btn-primary');
    playBtn.classList.remove('is-playing');
  }
}

playBtn.addEventListener('click', () => {
  isPlaying = !isPlaying;
  updatePlayButton();
  if (isPlaying) {
    lastTick = performance.now();
    if (currentVideo) {
      if (currentVideo.tagName === 'VIDEO') {
        currentVideo.muted = false;
        currentVideo.play().catch(() => {});
      } else if (currentVideo.tagName === 'IFRAME') {
        currentVideo.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      }
    }
  } else {
    lastTick = 0;
    if (currentVideo && currentVideo.tagName === 'VIDEO') {
      currentVideo.pause();
    } else if (currentVideo && currentVideo.tagName === 'IFRAME') {
      currentVideo.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
  }
});

$('nextBtn').addEventListener('click', nextSlide);
$('prevBtn').addEventListener('click', prevSlide);

$('fullscreenBtn').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.warn('Fullscreen tidak tersedia:', err);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowRight') nextSlide();
  if (e.key === 'ArrowLeft') prevSlide();
  if (e.key === ' ') { e.preventDefault(); playBtn.click(); }
});

document.addEventListener('click', () => {
  hasInteracted = true;
  if (currentVideo && currentVideo.tagName === 'VIDEO' && isPlaying) {
    currentVideo.muted = false;
    currentVideo.play().catch(() => {});
  }
}, { once: true });

/* ============================================
   ADMIN DRAWER
   ============================================ */
$('adminBtn').addEventListener('click', () => {
  adminPanel.classList.add('is-open');
  overlay.classList.add('is-open');
  renderAdmin();
});

function closeAdmin() {
  adminPanel.classList.remove('is-open');
  overlay.classList.remove('is-open');
}

$('closeAdmin').addEventListener('click', closeAdmin);
overlay.addEventListener('click', closeAdmin);

/* ============================================
   RENDER — ADMIN
   ============================================ */
function renderAdmin() {
  adminBody.innerHTML = '';

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
    Perubahan tersimpan otomatis`;
  adminBody.appendChild(hint);

  if (!mediaList.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Belum ada slide. Klik tombol di bawah untuk memulai.';
    adminBody.appendChild(empty);
    return;
  }

  mediaList.forEach((media, i) => {
    const card = document.createElement('div');
    card.className = 'admin-card';

    const head = document.createElement('div');
    head.className = 'card-head';

    const badge = document.createElement('span');
    badge.className = 'type-badge ' + media.type;
    badge.textContent = media.type === 'website' ? '🌐' : media.type === 'image' ? '🖼️' : '🎬';
    head.appendChild(badge);

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = media.name || '(tanpa nama)';
    head.appendChild(name);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const up = document.createElement('button');
    up.className = 'btn btn-mini';
    up.textContent = '↑';
    up.disabled = i === 0;
    up.title = 'Naikkan';
    up.addEventListener('click', () => moveItem(i, -1));
    actions.appendChild(up);

    const down = document.createElement('button');
    down.className = 'btn btn-mini';
    down.textContent = '↓';
    down.disabled = i === mediaList.length - 1;
    down.title = 'Turunkan';
    down.addEventListener('click', () => moveItem(i, 1));
    actions.appendChild(down);

    const del = document.createElement('button');
    del.className = 'btn btn-mini btn-danger';
    del.textContent = '×';
    del.title = 'Hapus';
    del.addEventListener('click', () => {
      if (confirm(`Hapus slide "${media.name}"?`)) {
        const removed = mediaList.splice(i, 1)[0];
        if (removed?.fileId) {
          blobUrlCache.delete(removed.fileId);
          removeBlob(removed.fileId);
        }
        saveToStorage();
        renderAdmin();
        renderStage();
      }
    });
    actions.appendChild(del);

    head.appendChild(actions);
    card.appendChild(head);

    const typeSel = document.createElement('select');
    [
      ['website', '🌐 Website'],
      ['image', '🖼️ Foto'],
      ['video', '🎬 Video']
    ].forEach(([v, label]) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label;
      opt.selected = media.type === v;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', (e) => {
      mediaList[i].type = e.target.value;
      saveToStorage();
      renderAdmin();
      renderStage();
    });
    card.appendChild(buildField('Tipe', typeSel));

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = media.name || '';
    nameInput.placeholder = 'Judul slide';
    nameInput.addEventListener('input', (e) => {
      mediaList[i].name = e.target.value;
      saveToStorage();
      name.textContent = e.target.value || '(tanpa nama)';
      const dot = pagerEl.querySelectorAll('.dot')[i];
      if (dot) {
        dot.dataset.label = e.target.value || `Slide ${i + 1}`;
        dot.title = e.target.value || `Slide ${i + 1}`;
      }
    });
    card.appendChild(buildField('Nama', nameInput));

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = media.url || '';
    urlInput.placeholder = media.fileId
      ? 'File lokal: ' + (media.fileName || 'terunggah')
      : (media.type === 'website' ? 'https://...' : 'URL video (MP4 / YouTube)');
    if (media.fileId) urlInput.disabled = true;
    urlInput.addEventListener('input', (e) => {
      mediaList[i].url = e.target.value;
      saveToStorage();
    });
    urlInput.addEventListener('change', () => renderStage());
    card.appendChild(buildField('URL', urlInput));

    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.min = 0.5;
    durInput.max = 600;
    durInput.step = 0.5;
    durInput.value = media.duration ?? '';
    durInput.placeholder = 'Default';
    durInput.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (v === '') {
        delete mediaList[i].duration;
      } else {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) mediaList[i].duration = n;
      }
      saveToStorage();
      if (i === currentIndex) {
        currentSlideDuration = getDurationMs(i);
        elapsedMs = 0;
        lastTick = isPlaying ? performance.now() : 0;
      }
    });

    const durField = buildField('Durasi', durInput);
    const suffix = document.createElement('span');
    suffix.className = 'field-suffix';
    suffix.textContent = 'dtk';
    durField.appendChild(suffix);
    card.appendChild(durField);

    adminBody.appendChild(card);
  });
}

function buildField(labelText, inputEl) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function moveItem(index, dir) {
  const ni = index + dir;
  if (ni < 0 || ni >= mediaList.length) return;
  [mediaList[index], mediaList[ni]] = [mediaList[ni], mediaList[index]];
  saveToStorage();
  renderAdmin();
  renderStage();
}

/* ============================================
   ADD / UPLOAD / RESET / IO
   ============================================ */
$('uploadBtn').addEventListener('click', () => mediaFileInput.click());

mediaFileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
    const id = 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    try {
      await saveBlob(id, file);
      const type = file.type.startsWith('video/') ? 'video' : 'image';
      blobUrlCache.set(id, URL.createObjectURL(file));
      mediaList.push({
        type,
        fileId: id,
        fileName: file.name,
        name: file.name,
        duration: type === 'video' ? '' : 10
      });
    } catch (err) {
      alert('Gagal menyimpan file ' + file.name);
    }
  }
  saveToStorage();
  renderAdmin();
  renderStage();
  e.target.value = '';
  if (files.length) adminBody.scrollTop = adminBody.scrollHeight;
});

$('addBtn').addEventListener('click', () => {
  mediaList.push({ type: 'image', url: '', name: 'Slide Baru', duration: 10 });
  saveToStorage();
  renderAdmin();
  renderStage();
  adminBody.scrollTop = adminBody.scrollHeight;
});

$('resetBtn').addEventListener('click', () => {
  if (confirm('Reset ke data default? Semua perubahan akan hilang.')) {
    mediaList = structuredClone(DEFAULT_MEDIA);
    saveToStorage();
    renderAdmin();
    renderStage();
  }
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(mediaList, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'slideshow-data-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!Array.isArray(data)) throw new Error('Format harus array');
      mediaList = data;
      saveToStorage();
      renderAdmin();
      renderStage();
      alert('Berhasil import ' + data.length + ' slide!');
    } catch (err) {
      alert('Gagal import: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ============================================
   BOOT
   ============================================ */
hydrateBlobs()
  .then(() => {
    renderStage();
    updatePlayButton();
  })
  .catch((err) => {
    console.warn(err);
    renderStage();
    updatePlayButton();
  });

requestAnimationFrame(tick);
