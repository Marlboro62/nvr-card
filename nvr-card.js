/*
 * NVR Card — carte Home Assistant façon enregistreur vidéo (NVR)
 * - Direct (ha-camera-stream, repli MJPEG), mosaïque si plusieurs caméras
 * - Frise 24 h : plages enregistrées + événements (rafales de photos), curseur glissable
 * - Lecture des vidéos horaires avec saut à l'heure cliquée, vitesse x1..x8
 * - Visionneuse des snaps, navigation événement par événement
 * - Téléchargement / suppression des fichiers depuis HA
 * - Éditeur visuel (sélection des caméras et des dossiers)
 * - Lien profond : ?nvr=last (ouvre la dernière détection du jour), ?nvr_cam=camera.xxx
 *
 * Arborescence attendue par caméra :
 *   <media_root>/JJ.MM.AAAA/HHhMM.mkv
 *   <media_root>/JJ.MM.AAAA/<snap_folder>/HHhMM/HHhMMmSSs.jpg (ou HHhMMmSSs_1.jpg … _6.jpg pour une rafale)
 */
const NVR_VERSION = '2.0.1-beta.1';
const DAY = 86400;
const ZOOMS = [24, 6, 1];
const SPEEDS = [1, 2, 4, 8];
const DEFAULTS = { live_layout: 'grid', aspect_ratio: '16/9', max_height: '70vh', event_gap: 60, preroll: 5, refresh: 60, osd: true, snap_folder: 'snap' };

const pad = (n) => String(n).padStart(2, '0');
const hms = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const hm = (s) => hms(s).slice(0, 5);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) if (v !== '' && v !== undefined && v !== null) r[k] = v;
  return r;
};

const STYLE = `
:host{display:block}
ha-card{background:#0b0d10;color:#d6dbe1;overflow:hidden;border:1px solid #1d232b}
ha-icon{--mdc-icon-size:20px}
[hidden]{display:none!important}
button{font:inherit;color:inherit;background:none;border:none;cursor:pointer;padding:0}
.top{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#11151a;border-bottom:1px solid #1d232b}
.cam{display:flex;align-items:center;gap:8px;flex:1;min-width:0;font-weight:500;white-space:nowrap;overflow:hidden}
.camname{overflow:hidden;text-overflow:ellipsis}
.rec{width:9px;height:9px;border-radius:50%;background:#555;flex:none}
.mode-live .rec{background:#e53935;box-shadow:0 0 6px #e53935;animation:blink 1.4s infinite}
.mode-video .rec{background:#43a047}
.mode-snap .rec{background:#fb8c00}
@keyframes blink{50%{opacity:.25}}
.tabs{display:flex;gap:4px;overflow-x:auto;min-width:0;scrollbar-width:none}
.tab{padding:5px 10px;border-radius:6px;border:1px solid #2a323c;font-size:12px;color:#aeb6c0;white-space:nowrap}
.tab:hover{background:#1c232c;color:#fff}
.tab.on{background:#1c232c;color:#fff;border-color:#4fc3f7}
.daynav{display:flex;align-items:center;gap:2px}
select{background:#0b0d10;color:inherit;border:1px solid #2a323c;border-radius:6px;padding:5px 6px;font:inherit;font-size:13px}
.ib{width:34px;height:34px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#aeb6c0}
.ib:hover,.txt:hover{background:#1c232c;color:#fff}
.ib.on{color:#4fc3f7}
.ib.big{width:40px;height:40px;background:#1c232c;color:#fff}
.ib.danger:hover{color:#ef5350}
.txt{height:30px;padding:0 8px;border-radius:8px;border:1px solid #2a323c;font-size:12px;color:#aeb6c0;font-variant-numeric:tabular-nums}
.live{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;border:1px solid #2a323c;font-size:12px;font-weight:700;letter-spacing:1px;color:#aeb6c0}
.ldot{width:7px;height:7px;border-radius:50%;background:currentColor}
.mode-live .live{background:#e53935;border-color:#e53935;color:#fff}
.viewer{position:relative;background:#000;aspect-ratio:16/9;overflow:hidden}
.viewer:fullscreen{aspect-ratio:auto;max-height:none!important}
.stage{position:absolute;inset:0}
.stage>*{position:absolute;inset:0;width:100%;height:100%}
.stage>video,.stage>img{object-fit:contain;background:#000}
.mosaic{display:grid;gap:2px;background:#000;grid-auto-rows:1fr}
.tile{position:relative;overflow:hidden;cursor:pointer;background:#05070a}
.tile>ha-camera-stream,.tile>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.tile .lbl{position:absolute;left:6px;top:6px;font:12px ui-monospace,monospace;color:#fff;text-shadow:0 0 3px #000,0 0 6px #000;z-index:1;pointer-events:none}
.tile:hover{outline:2px solid #4fc3f7;outline-offset:-2px}
.osd{position:absolute;top:8px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#fff;text-shadow:0 0 3px #000,0 0 6px #000;pointer-events:none}
.osd.tl{left:10px}.osd.tr{right:10px}
.is-grid .osd.tl{display:none}
.badge{position:absolute;left:10px;bottom:10px;font:700 11px/1 ui-monospace,monospace;letter-spacing:1px;padding:5px 7px;border-radius:4px;background:rgba(0,0,0,.6);pointer-events:none;z-index:2}
.mode-live .badge{color:#ff5252}.mode-video .badge{color:#69f0ae}.mode-snap .badge{color:#ffb74d}
.nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:56px;background:rgba(0,0,0,.45);color:#fff;border-radius:8px;display:none;align-items:center;justify-content:center}
.nav.prev{left:8px}.nav.next{right:8px}
.mode-snap .nav{display:flex}
.msg{position:absolute;left:10%;right:10%;top:40%;text-align:center;background:rgba(0,0,0,.75);padding:12px;border-radius:8px;font-size:13px;display:none;z-index:2}
.toast{position:absolute;right:10px;bottom:10px;background:rgba(20,25,31,.92);border:1px solid #2a323c;padding:6px 10px;border-radius:6px;font-size:12px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:2}
.toast.on{opacity:1}
.bar{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 8px;background:#11151a;flex-wrap:wrap}
.grp{display:flex;align-items:center;gap:2px}
.clock{font-family:ui-monospace,monospace;font-size:14px;color:#fff;font-variant-numeric:tabular-nums}
.timeline{padding:2px 10px 10px;background:#11151a;border-bottom:1px solid #1d232b;user-select:none}
.ticks{position:relative;height:16px;font:10px ui-monospace,monospace;color:#6b7682;overflow:hidden}
.ticks span{position:absolute;transform:translateX(-50%);white-space:nowrap;top:1px}
.track{position:relative;height:34px;background:#0b0d10;border:1px solid #232b34;border-radius:4px;cursor:crosshair;overflow:hidden;touch-action:none}
.track.drag{cursor:grabbing}
.grid{position:absolute;top:0;bottom:0;width:1px;background:#1a2129}
.seg{position:absolute;top:0;bottom:0;background:linear-gradient(#1b5e20,#2e7d32);opacity:.55}
.future{position:absolute;top:0;bottom:0;right:0;background:repeating-linear-gradient(45deg,transparent 0 4px,rgba(255,255,255,.05) 4px 8px)}
.mk{position:absolute;top:6px;bottom:6px;min-width:3px;background:#ffa726;border-radius:2px;box-shadow:0 0 4px rgba(255,167,38,.6)}
.cursor{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#4fc3f7;box-shadow:0 0 6px #4fc3f7;pointer-events:none;display:none}
.track.drag .cursor{background:#fff;box-shadow:0 0 8px #fff}
.hover{position:absolute;top:2px;transform:translateX(-50%);font:10px ui-monospace,monospace;background:#000c;color:#fff;padding:1px 4px;border-radius:3px;pointer-events:none;display:none}
.evhead{display:flex;justify-content:space-between;padding:8px 12px 0;font-size:11px;color:#8a95a1;text-transform:uppercase;letter-spacing:.8px}
.events{display:flex;gap:8px;overflow-x:auto;padding:8px 10px 12px;scrollbar-width:thin}
.ev{flex:none;width:128px;cursor:pointer;border-radius:6px;padding:3px;border:1px solid transparent}
.ev:hover{background:#151b22}
.ev.sel{border-color:#ffa726;background:#1a1610}
.th{position:relative;aspect-ratio:16/9;background:#1a2028;border-radius:4px;overflow:hidden}
.th img{width:100%;height:100%;object-fit:cover;display:block}
.th .n{position:absolute;right:4px;bottom:4px;font:600 10px ui-monospace,monospace;background:#000b;color:#fff;padding:1px 4px;border-radius:3px}
.ev .t{font:12px ui-monospace,monospace;margin-top:4px;text-align:center;color:#cfd6dd}
.empty{color:#6b7682;font-size:13px;padding:10px}
@media (max-width:520px){.clock{display:none}.ib{width:30px;height:30px}}
`;

/* ======================================================================= */
class NvrCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._urls = new Map();
    this._liveEls = new Map();
    this._livePromises = new Map();
    this._days = [];
    this._dayIdx = 0;
    this._data = null;
    this._mode = 'live';
    this._cursor = null;
    this._zoomIdx = 0;
    this._speedIdx = 0;
    this._seq = 0;
    this._timers = [];
    this._ws = 0;
    this._we = DAY;
    this._camIdx = 0;
    this._grid = false;
  }

  static getConfigElement() { return document.createElement('nvr-card-editor'); }

  static getStubConfig(hass) {
    const cam = Object.keys(hass.states).find((e) => e.startsWith('camera.'));
    return { cameras: [{ entity: cam || 'camera.xxx', media_root: 'media-source://media_source/local/Surveillance' }] };
  }

  setConfig(config) {
    if (!config) throw new Error('Configuration manquante');
    const list = Array.isArray(config.cameras) && config.cameras.length
      ? config.cameras
      : (config.entity ? [{ entity: config.entity, media_root: config.media_root, title: config.title, snap_folder: config.snap_folder }] : []);
    const cams = list.filter((c) => c && c.entity).map((c) => ({
      entity: c.entity,
      title: c.title || '',
      media_root: String(c.media_root || '').replace(/\/+$/, ''),
      snap_folder: c.snap_folder || config.snap_folder || DEFAULTS.snap_folder,
    }));
    if (!cams.length) throw new Error('Choisis au moins une caméra (éditeur visuel)');
    this._config = Object.assign({}, DEFAULTS, config);
    this._cams = cams;
    if (this._camIdx >= cams.length) this._camIdx = 0;
    this._grid = this._config.live_layout === 'grid' && cams.length > 1;
    this._stopLive();
    this._data = null;
    this._days = [];
    this._built = false;
    if (this._hass) { this._build(); this._start(); }
  }

  get _cam() { return this._cams[this._camIdx]; }

  _camName(cam) {
    const so = this._hass && this._hass.states[cam.entity];
    return cam.title || (so && so.attributes.friendly_name) || cam.entity;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) { this._build(); this._start(); return; }
    for (const [ent, el] of this._liveEls) {
      if (el.localName !== 'ha-camera-stream') continue;
      el.hass = hass;
      const so = hass.states[ent];
      if (so && so !== el._nvrSo) { el._nvrSo = so; el.stateObj = so; }
    }
  }
  get hass() { return this._hass; }

  getCardSize() { return 10; }

  connectedCallback() {
    if (this._built && !this._timers.length) {
      this._startTimers();
      if (this._mode === 'live') this._showLive();
    }
  }

  disconnectedCallback() {
    this._stopTimers();
    if (this._video) this._video.pause();
    this._stopLive();
  }

  /* ---------- construction ---------- */
  _build() {
    const multi = this._cams.length > 1;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
<ha-card class="mode-live">
  <div class="top">
    <div class="cam"><span class="rec"></span><span class="camname" ${multi ? 'hidden' : ''}></span>
      <div class="tabs" ${multi ? '' : 'hidden'}></div></div>
    <div class="daynav">
      <button class="ib" data-a="older" title="Jour précédent"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
      <select class="days"></select>
      <button class="ib" data-a="newer" title="Jour suivant"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
    </div>
    <button class="ib gridbtn" data-a="grid" title="Mosaïque" ${multi ? '' : 'hidden'}><ha-icon icon="mdi:view-grid"></ha-icon></button>
    <button class="live" data-a="live"><span class="ldot"></span>LIVE</button>
  </div>
  <div class="viewer">
    <div class="stage"></div>
    <div class="osd tl"></div>
    <div class="osd tr"></div>
    <div class="badge"></div>
    <button class="nav prev" data-a="snapprev"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
    <button class="nav next" data-a="snapnext"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
    <div class="msg"></div>
    <div class="toast"></div>
  </div>
  <div class="bar">
    <div class="grp">
      <button class="ib" data-a="evprev" title="Événement précédent"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
      <button class="ib" data-a="back" title="-30 s"><ha-icon icon="mdi:rewind-30"></ha-icon></button>
      <button class="ib big" data-a="play" title="Lecture / pause"><ha-icon class="playicon" icon="mdi:play"></ha-icon></button>
      <button class="ib" data-a="fwd" title="+30 s"><ha-icon icon="mdi:fast-forward-30"></ha-icon></button>
      <button class="ib" data-a="evnext" title="Événement suivant"><ha-icon icon="mdi:skip-next"></ha-icon></button>
      <button class="txt" data-a="speed" title="Vitesse de lecture">1×</button>
    </div>
    <div class="clock"></div>
    <div class="grp">
      <button class="txt" data-a="zoom" title="Zoom de la frise">24 h</button>
      <button class="ib" data-a="download" title="Télécharger"><ha-icon icon="mdi:download"></ha-icon></button>
      <button class="ib danger" data-a="delete" title="Supprimer"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
      <button class="ib" data-a="full" title="Plein écran"><ha-icon icon="mdi:fullscreen"></ha-icon></button>
    </div>
  </div>
  <div class="timeline">
    <div class="ticks"></div>
    <div class="track"><div class="segs"></div><div class="marks"></div><div class="cursor"></div><div class="hover"></div></div>
  </div>
  <div class="evhead"><span>Événements</span><span class="evcount"></span></div>
  <div class="events"><div class="empty">Chargement…</div></div>
</ha-card>`;
    const q = (s) => this.shadowRoot.querySelector(s);
    const viewer = q('.viewer');
    viewer.style.aspectRatio = String(this._config.aspect_ratio).replace(':', '/');
    if (this._config.max_height) viewer.style.maxHeight = this._config.max_height;
    if (this._config.osd === false) q('.osd.tl').style.display = q('.osd.tr').style.display = 'none';
    this.$ = {
      card: q('ha-card'), camname: q('.camname'), tabs: q('.tabs'), gridbtn: q('.gridbtn'), days: q('.days'), viewer, stage: q('.stage'),
      tl: q('.osd.tl'), tr: q('.osd.tr'), badge: q('.badge'), msg: q('.msg'), toast: q('.toast'),
      clock: q('.clock'), playicon: q('.playicon'), speed: q('[data-a="speed"]'), zoom: q('[data-a="zoom"]'),
      ticks: q('.ticks'), track: q('.track'), segs: q('.segs'), marks: q('.marks'), cursor: q('.cursor'),
      hover: q('.hover'), events: q('.events'), evcount: q('.evcount'),
    };
    this.shadowRoot.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this._action(b.dataset.a, b);
    });
    this.$.days.addEventListener('change', () => this._loadDay(+this.$.days.value));
    this.$.stage.addEventListener('click', (e) => {
      if (e.target.closest('[data-a]')) return;
      if (this._mode === 'video' && this._video) this._video.paused ? this._video.play() : this._video.pause();
    });
    this._bindTrack();
    this._io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const img = en.target;
        this._io.unobserve(img);
        this._resolve(img.dataset.id).then((u) => { img.src = u; }).catch(() => {});
      }
    }, { root: this.$.events, rootMargin: '300px' });
    this._built = true;
    this._renderTabs();
    this._updateOSD();
  }

  _renderTabs() {
    if (!this.$) return;
    this.$.tabs.innerHTML = this._cams.map((c, i) =>
      `<button class="tab ${i === this._camIdx && !this._grid ? 'on' : ''}" data-a="cam" data-i="${i}">${esc(this._camName(c))}</button>`).join('');
    this.$.gridbtn.classList.toggle('on', this._grid);
  }

  async _start() {
    const p = new URLSearchParams(location.search);
    const want = p.get('nvr_cam');
    if (want) {
      const i = this._cams.findIndex((c) => c.entity === want);
      if (i >= 0) { this._camIdx = i; this._grid = false; this._renderTabs(); }
    }
    this._startTimers();
    this._showLive();
    await this._loadDays();
  }

  _startTimers() {
    this._stopTimers();
    this._timers.push(setInterval(() => this._updateOSD(), 1000));
    this._timers.push(setInterval(() => {
      const d = this._days[this._dayIdx];
      if (d && this._isToday(d)) this._loadDay(this._dayIdx, true);
    }, Math.max(15, +this._config.refresh || 60) * 1000));
    this._timers.push(setInterval(() => { this._urls.clear(); this._loadDays(); }, 30 * 60 * 1000));
  }

  _stopTimers() { this._timers.forEach(clearInterval); this._timers = []; }

  /* ---------- accès media_source ---------- */
  async _browse(id) {
    const r = await this._hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
    return r.children || [];
  }

  _resolve(id) {
    if (this._urls.has(id)) return this._urls.get(id);
    const p = this._hass.callWS({ type: 'media_source/resolve_media', media_content_id: id, expires: 3600 })
      .then((r) => (this._hass.hassUrl ? this._hass.hassUrl(r.url) : r.url));
    this._urls.set(id, p);
    p.catch(() => this._urls.delete(id));
    return p;
  }

  _remove(id) {
    this._urls.delete(id);
    return this._hass.callWS({ type: 'media_source/local_source/remove', media_content_id: id });
  }

  /* ---------- chargement des données ---------- */
  _isToday(day) {
    const n = new Date();
    return day.ts === new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  }

  async _loadDays() {
    const cam = this._cam;
    if (!cam.media_root) {
      this._days = [];
      this._data = null;
      this.$.days.innerHTML = '';
      this.$.evcount.textContent = '';
      this.$.events.innerHTML = '<div class="empty">Pas de dossier d\'enregistrements pour cette caméra (direct seulement).</div>';
      this._renderTimeline();
      return;
    }
    let kids;
    try { kids = await this._browse(cam.media_root); } catch (e) {
      if (cam === this._cam) this.$.events.innerHTML = `<div class="empty">Impossible de lire ${esc(cam.media_root)} : ${esc(e.message || e.code || e)}</div>`;
      return;
    }
    if (cam !== this._cam) return;
    const prev = this._days[this._dayIdx] && this._days[this._dayIdx].title;
    this._days = kids
      .filter((c) => c.can_expand && /^\d{2}\.\d{2}\.\d{4}$/.test(c.title))
      .map((c) => {
        const [d, m, y] = c.title.split('.').map(Number);
        return { title: c.title, id: c.media_content_id, ts: new Date(y, m - 1, d).getTime() };
      })
      .sort((a, b) => b.ts - a.ts);
    if (!this._days.length) {
      this.$.days.innerHTML = '';
      this.$.events.innerHTML = '<div class="empty">Aucun dossier JJ.MM.AAAA trouvé.</div>';
      return;
    }
    this.$.days.innerHTML = this._days.map((d, i) => {
      const lbl = new Date(d.ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      return `<option value="${i}">${esc(lbl)}</option>`;
    }).join('');
    let idx = prev ? this._days.findIndex((d) => d.title === prev) : 0;
    if (idx < 0) idx = 0;
    this.$.days.value = String(idx);
    if (!this._data || this._data.day.title !== this._days[idx].title) await this._loadDay(idx);
    else this._dayIdx = idx;
  }

  async _loadDay(idx, silent = false) {
    const day = this._days[idx];
    if (!day) return;
    const cam = this._cam;
    const seq = ++this._seq;
    this._dayIdx = idx;
    this.$.days.value = String(idx);
    if (!silent) this.$.events.innerHTML = '<div class="empty">Chargement…</div>';
    let videos = [];
    const snaps = [];
    try {
      const kids = await this._browse(day.id);
      let snapDir = null;
      for (const k of kids) {
        const m = k.title.match(/^(\d{1,2})h(\d{2})\.(mkv|mp4|avi|mov|webm)$/i);
        if (m && !k.can_expand) videos.push({ start: +m[1] * 3600 + +m[2] * 60, id: k.media_content_id, title: k.title });
        else if (k.can_expand && k.title.toLowerCase() === String(cam.snap_folder).toLowerCase()) snapDir = k;
      }
      if (snapDir) {
        const hours = (await this._browse(snapDir.media_content_id)).filter((h) => h.can_expand);
        const lists = await Promise.all(hours.map((h) => this._browse(h.media_content_id).catch(() => [])));
        for (const f of lists.flat()) {
          // « 17h25m12s.jpg », ou une rafale « 17h25m12s_1.jpg » … « _6.jpg »
          const m = f.title.match(/^(\d{1,2})h(\d{2})m(\d{2})s(?:[_-](\d+))?\.(jpe?g|png)$/i);
          if (m) snaps.push({ sec: +m[1] * 3600 + +m[2] * 60 + +m[3], n: +(m[4] || 0), id: f.media_content_id, title: f.title });
        }
      }
    } catch (e) {
      if (!silent && seq === this._seq) this.$.events.innerHTML = `<div class="empty">Erreur : ${esc(e.message || e.code || e)}</div>`;
      return;
    }
    if (seq !== this._seq || cam !== this._cam) return;

    videos.sort((a, b) => a.start - b.start);
    videos = videos.map((v, i) => {
      const next = videos[i + 1];
      return Object.assign(v, { end: Math.min(v.start + 3600, next ? next.start : DAY) });
    });
    snaps.sort((a, b) => a.sec - b.sec || a.n - b.n);
    const gap = +this._config.event_gap || 0;
    const events = [];
    for (const s of snaps) {
      const last = events[events.length - 1];
      if (last && s.sec - last.end <= gap) { last.snaps.push(s); last.end = s.sec; } else events.push({ start: s.sec, end: s.sec, snaps: [s] });
    }

    const dayChanged = !this._data || this._data.day.title !== day.title;
    this._data = { day, videos, snaps, events };
    this._renderTimeline();
    this._renderEvents(silent && !dayChanged);
    if (dayChanged && this._mode !== 'live') {
      if (events.length) this._showEvent(events[events.length - 1], 0); else this._showLive();
    }
    if (!this._deepDone && !silent) {
      this._deepDone = true;
      if (new URLSearchParams(location.search).get('nvr') === 'last' && events.length && this._isToday(day)) {
        this._grid = false;
        this._renderTabs();
        this._showEvent(events[events.length - 1], 0);
      }
    }
    this._updateOSD();
  }

  /* ---------- rendu ---------- */
  _win() {
    const span = ZOOMS[this._zoomIdx] * 3600;
    if (span >= DAY) return [0, DAY];
    let center = this._cursor;
    if (center == null) {
      const n = new Date();
      center = this._data && this._isToday(this._data.day) ? n.getHours() * 3600 + n.getMinutes() * 60 : 12 * 3600;
    }
    const s = Math.max(0, Math.min(DAY - span, center - span / 2));
    return [s, s + span];
  }

  _renderTimeline() {
    const [ws, we] = this._win();
    this._ws = ws; this._we = we;
    const span = we - ws;
    const pct = (s) => ((s - ws) / span) * 100;
    const step = span >= DAY ? 7200 : span >= 6 * 3600 ? 1800 : 300;
    let ticks = '';
    let grid = '';
    for (let t = Math.ceil(ws / step) * step; t <= we; t += step) {
      const p = pct(t);
      if (p > 2 && p < 98) ticks += `<span style="left:${p}%">${hm(t)}</span>`;
      grid += `<div class="grid" style="left:${p}%"></div>`;
    }
    this.$.ticks.innerHTML = ticks;
    let segs = grid;
    const d = this._data;
    if (d) {
      for (const v of d.videos) {
        const a = Math.max(v.start, ws); const b = Math.min(v.end, we);
        if (b > a) segs += `<div class="seg" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%"></div>`;
      }
      if (this._isToday(d.day)) {
        const n = new Date();
        const now = n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
        if (now < we) segs += `<div class="future" style="left:${Math.max(0, pct(now))}%"></div>`;
      }
    }
    this.$.segs.innerHTML = segs;
    let marks = '';
    if (d) {
      for (const e of d.events) {
        if (e.end + 1 < ws || e.start > we) continue;
        marks += `<div class="mk" style="left:${pct(e.start)}%;width:${pct(e.end + 1) - pct(e.start)}%"></div>`;
      }
    }
    this.$.marks.innerHTML = marks;
    this._updateCursor(true);
  }

  _renderEvents(keepScroll) {
    const d = this._data;
    const scroll = this.$.events.scrollLeft;
    const evs = d ? d.events : [];
    this.$.evcount.textContent = d ? `${evs.length} événement(s) · ${d.snaps.length} photo(s) · ${d.videos.length} vidéo(s)` : '';
    if (!evs.length) {
      this.$.events.innerHTML = '<div class="empty">Aucun événement ce jour-là.</div>';
      return;
    }
    let html = '';
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      html += `<div class="ev" data-a="event" data-i="${i}"><div class="th"><img data-id="${esc(e.snaps[0].id)}" alt=""><span class="n">${e.snaps.length}</span></div><div class="t">${hms(e.start)}</div></div>`;
    }
    this.$.events.innerHTML = html;
    this.$.events.querySelectorAll('img[data-id]').forEach((img) => this._io.observe(img));
    if (keepScroll) this.$.events.scrollLeft = scroll;
    this._highlightEvent(false);
  }

  _placeCursor(sec) {
    this.$.cursor.style.display = 'block';
    const p = ((sec - this._ws) / (this._we - this._ws)) * 100;
    this.$.cursor.style.left = `${Math.max(0, Math.min(100, p))}%`;
  }

  _updateCursor(fromRender = false) {
    if (this._drag && this._drag.moved) return;
    const c = this._cursor;
    if (c == null || !this._data) { this.$.cursor.style.display = 'none'; return; }
    if (!fromRender && (c < this._ws || c > this._we)) { this._renderTimeline(); return; }
    this._placeCursor(c);
  }

  _updateOSD() {
    if (!this.$) return;
    const name = this._camName(this._cam);
    this.$.camname.textContent = name;
    this.$.tl.textContent = name;
    this.$.card.classList.toggle('is-grid', this._mode === 'live' && this._grid);
    let stamp;
    if (this._mode === 'live' || this._cursor == null) {
      const n = new Date();
      stamp = `${pad(n.getDate())}/${pad(n.getMonth() + 1)}/${n.getFullYear()} ${hms(n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds())}`;
    } else {
      stamp = `${this._data ? this._data.day.title.replace(/\./g, '/') : ''} ${hms(this._cursor)}`;
    }
    this.$.tr.textContent = stamp;
    this.$.clock.textContent = stamp;
    if (this._mode === 'live') this.$.badge.textContent = this._grid ? '● LIVE · MOSAÏQUE' : '● LIVE';
    else if (this._mode === 'video') this.$.badge.textContent = `▶ LECTURE ${SPEEDS[this._speedIdx]}×`;
    else if (this._snapEv) this.$.badge.textContent = `SNAP ${this._snapIdx + 1}/${this._snapEv.snaps.length}`;
  }

  _setMode() {
    this.$.card.classList.remove('mode-live', 'mode-video', 'mode-snap');
    this.$.card.classList.add(`mode-${this._mode}`);
    this._updatePlayIcon();
    this._updateOSD();
  }

  _updatePlayIcon() {
    const playing = this._mode === 'video' && this._video && !this._video.paused;
    this.$.playicon.setAttribute('icon', playing ? 'mdi:pause' : 'mdi:play');
  }

  _highlightEvent(scroll = true) {
    const evs = this._data ? this._data.events : [];
    const i = this._snapEv ? evs.indexOf(this._snapEv) : -1;
    this.$.events.querySelectorAll('.ev').forEach((el) => {
      const on = +el.dataset.i === i;
      el.classList.toggle('sel', on);
      if (on && scroll) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  }

  _msg(text) {
    this.$.msg.textContent = text || '';
    this.$.msg.style.display = text ? 'block' : 'none';
  }

  _toast(text) {
    this.$.toast.textContent = text;
    this.$.toast.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.$.toast.classList.remove('on'), 2500);
  }

  _mount(el) {
    if (this.$.stage.firstChild !== el) this.$.stage.replaceChildren(el);
  }

  /* ---------- direct ---------- */
  async _ensureStreamElement(ent) {
    if (customElements.get('ha-camera-stream') || !window.loadCardHelpers) return;
    try {
      const h = await window.loadCardHelpers();
      h.createCardElement({ type: 'picture-entity', entity: ent, camera_view: 'live' });
      await Promise.race([customElements.whenDefined('ha-camera-stream'), new Promise((r) => setTimeout(r, 4000))]);
    } catch (e) { /* repli MJPEG */ }
  }

  _getLive(ent) {
    if (this._liveEls.has(ent)) return Promise.resolve(this._liveEls.get(ent));
    if (this._livePromises.has(ent)) return this._livePromises.get(ent);
    const p = (async () => {
      await this._ensureStreamElement(ent);
      const so = this._hass.states[ent];
      let el;
      if (!so) {
        el = document.createElement('div');
        el.className = 'empty';
        el.textContent = `Entité ${ent} introuvable`;
      } else if (customElements.get('ha-camera-stream')) {
        el = document.createElement('ha-camera-stream');
        el.hass = this._hass;
        el.stateObj = so;
        el._nvrSo = so;
        el.muted = true;
        el.controls = false;
        el.allowExoPlayer = true;
      } else {
        el = document.createElement('img');
        el.src = this._hass.hassUrl(`/api/camera_proxy_stream/${ent}?token=${so.attributes.access_token}`);
      }
      this._livePromises.delete(ent);
      this._liveEls.set(ent, el);
      return el;
    })();
    this._livePromises.set(ent, p);
    return p;
  }

  _stopLive(keep) {
    for (const [ent, el] of this._liveEls) {
      if (ent === keep) continue;
      el.remove();
      this._liveEls.delete(ent);
    }
  }

  async _showLive() {
    if (this._video) this._video.pause();
    this._mode = 'live';
    this._snapEv = null;
    this._curVideo = null;
    this._cursor = null;
    this._msg('');
    this._setMode();
    this._renderTabs();
    this._updateCursor();
    this._highlightEvent(false);
    if (this._zoomIdx) this._renderTimeline();
    if (this._grid && this._cams.length > 1) { this._showGrid(); return; }
    const cam = this._cam;
    const el = await this._getLive(cam.entity);
    if (this._mode !== 'live' || this._grid || this._cam !== cam) return;
    this._stopLive(cam.entity);
    this._mount(el);
  }

  _showGrid() {
    const grid = document.createElement('div');
    grid.className = 'mosaic';
    const n = this._cams.length;
    const cols = Math.ceil(Math.sqrt(n));
    grid.style.gridTemplateColumns = `repeat(${cols},1fr)`;
    this._cams.forEach((cam, i) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.a = 'cam';
      tile.dataset.i = String(i);
      tile.title = this._camName(cam);
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = this._camName(cam);
      tile.append(lbl);
      grid.append(tile);
      this._getLive(cam.entity).then((el) => {
        if (this._mode === 'live' && this._grid && grid.isConnected) tile.prepend(el);
      });
    });
    this._mount(grid);
  }

  _selectCam(i) {
    if (i === this._camIdx && !this._grid) return;
    const changed = i !== this._camIdx;
    this._camIdx = i;
    this._grid = false;
    if (changed) {
      this._seq++;
      this._data = null;
      this._days = [];
      this._dayIdx = 0;
      this._snapEv = null;
      this._curVideo = null;
      if (this._video) { this._video.pause(); this._video.removeAttribute('src'); delete this._video.dataset.id; this._video.load(); }
      this.$.days.innerHTML = '';
      this.$.events.innerHTML = '<div class="empty">Chargement…</div>';
      this.$.evcount.textContent = '';
      this._renderTimeline();
    }
    this._showLive();
    if (changed) this._loadDays();
  }

  /* ---------- lecture vidéo ---------- */
  _getVideo() {
    if (this._video) return this._video;
    const v = document.createElement('video');
    v.playsInline = true;
    v.muted = true;
    v.preload = 'auto';
    v.addEventListener('loadedmetadata', () => {
      if (this._pendingOffset != null) {
        try { v.currentTime = this._pendingOffset; } catch (e) { /* ignore */ }
        this._pendingOffset = null;
      }
      v.playbackRate = SPEEDS[this._speedIdx];
    });
    v.addEventListener('timeupdate', () => {
      if (this._mode !== 'video' || !this._curVideo || (this._drag && this._drag.moved)) return;
      this._cursor = this._curVideo.start + v.currentTime;
      this._updateCursor();
      this._updateOSD();
    });
    v.addEventListener('play', () => this._updatePlayIcon());
    v.addEventListener('pause', () => this._updatePlayIcon());
    v.addEventListener('ended', () => {
      const cur = this._curVideo;
      const next = cur && this._data && this._data.videos.find((x) => x.start > cur.start);
      if (next) this._playVideo(next, 0);
    });
    v.addEventListener('error', () => {
      if (this._mode !== 'video' || !v.getAttribute('src')) return;
      this._msg('Vidéo illisible dans ce navigateur (conteneur MKV ou codec H.265 ?). Utilise ⬇ Télécharger pour l\'ouvrir dans VLC.');
    });
    this._video = v;
    return v;
  }

  async _playVideo(vf, offset, autoplay = true) {
    this._stopLive();
    this._mode = 'video';
    this._grid = false;
    this._snapEv = null;
    this._curVideo = vf;
    this._cursor = vf.start + offset;
    this._msg('');
    this._setMode();
    this._renderTabs();
    this._highlightEvent(false);
    this._updateCursor();
    const v = this._getVideo();
    this._mount(v);
    let url;
    try { url = await this._resolve(vf.id); } catch (e) { this._msg('Impossible d\'accéder au fichier vidéo'); return; }
    if (this._curVideo !== vf) return;
    if (v.dataset.id !== vf.id) {
      v.dataset.id = vf.id;
      this._pendingOffset = Math.max(0, offset);
      v.src = url;
    } else {
      try { v.currentTime = Math.max(0, offset); } catch (e) { /* ignore */ }
    }
    v.playbackRate = SPEEDS[this._speedIdx];
    if (autoplay) v.play().catch(() => {});
  }

  _seek(sec, autoplay = true) {
    const d = this._data;
    if (!d) return;
    sec = Math.max(0, Math.min(DAY - 1, sec));
    const vf = d.videos.find((x) => sec >= x.start && sec < x.end);
    if (vf) { this._playVideo(vf, sec - vf.start, autoplay); return; }
    const next = d.videos.find((x) => x.start > sec);
    if (next) { this._toast(`Pas d'enregistrement à ${hm(sec)} → ${hm(next.start)}`); this._playVideo(next, 0, autoplay); return; }
    this._toast(`Pas d'enregistrement à ${hm(sec)}`);
  }

  /* ---------- snaps ---------- */
  async _showEvent(ev, idx = 0) {
    this._stopLive();
    if (this._video) this._video.pause();
    this._mode = 'snap';
    this._grid = false;
    this._curVideo = null;
    this._snapEv = ev;
    this._snapIdx = (idx + ev.snaps.length) % ev.snaps.length;
    const s = ev.snaps[this._snapIdx];
    this._cursor = s.sec;
    if (!this._img) this._img = document.createElement('img');
    const img = this._img;
    this._mount(img);
    this._msg('');
    this._setMode();
    this._renderTabs();
    this._updateCursor();
    this._highlightEvent();
    try {
      const u = await this._resolve(s.id);
      if (this._snapEv === ev && ev.snaps[this._snapIdx] === s) img.src = u;
    } catch (e) { this._msg('Image introuvable'); }
    ev.snaps.forEach((x) => this._resolve(x.id).then((u) => { new Image().src = u; }).catch(() => {}));
  }

  /* ---------- frise : clic + glisser ---------- */
  _trackPos(e) {
    const r = this.$.track.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
    return { sec: this._ws + (x / r.width) * (this._we - this._ws), x, w: r.width };
  }

  _bindTrack() {
    const tr = this.$.track;
    const showHover = (e) => {
      const { sec, x } = this._trackPos(e);
      this.$.hover.style.display = 'block';
      this.$.hover.style.left = `${x}px`;
      this.$.hover.textContent = hms(sec);
    };
    tr.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this._data) return;
      tr.setPointerCapture(e.pointerId);
      const playing = this._mode === 'video' && this._video && !this._video.paused;
      this._drag = { x0: e.clientX, moved: false, playing };
    });
    tr.addEventListener('pointermove', (e) => {
      showHover(e);
      const d = this._drag;
      if (!d) return;
      if (!d.moved && Math.abs(e.clientX - d.x0) > 4) {
        d.moved = true;
        tr.classList.add('drag');
        if (d.playing) this._video.pause();
      }
      if (d.moved) this._scrub(this._trackPos(e).sec);
    });
    const end = (e, cancel) => {
      const d = this._drag;
      this._drag = null;
      tr.classList.remove('drag');
      if (!d || cancel) return;
      if (!d.moved) { this._onTrackClick(e); return; }
      this._endScrub(this._trackPos(e).sec, d.playing);
    };
    tr.addEventListener('pointerup', (e) => end(e, false));
    tr.addEventListener('pointercancel', (e) => end(e, true));
    tr.addEventListener('pointerleave', () => { if (!this._drag) this.$.hover.style.display = 'none'; });
  }

  _scrub(sec) {
    sec = Math.max(0, Math.min(DAY - 1, sec));
    this._scrubSec = sec;
    this._placeCursor(sec);
    this.$.tr.textContent = `${this._data.day.title.replace(/\./g, '/')} ${hms(sec)}`;
    this.$.clock.textContent = this.$.tr.textContent;
    if (this._scrubRaf) return;
    this._scrubRaf = requestAnimationFrame(() => {
      this._scrubRaf = null;
      const v = this._video;
      const cv = this._curVideo;
      const s = this._scrubSec;
      if (this._mode === 'video' && v && cv && s >= cv.start && s < cv.end && v.readyState >= 1) {
        try { v.currentTime = s - cv.start; } catch (e) { /* ignore */ }
      }
    });
  }

  _endScrub(sec, wasPlaying) {
    sec = Math.max(0, Math.min(DAY - 1, sec));
    const v = this._video;
    const cv = this._curVideo;
    if (this._mode === 'video' && v && cv && sec >= cv.start && sec < cv.end) {
      try { v.currentTime = sec - cv.start; } catch (e) { /* ignore */ }
      this._cursor = sec;
      this._updateCursor();
      this._updateOSD();
      if (wasPlaying) v.play().catch(() => {});
      return;
    }
    this._seek(sec, true);
  }

  _onTrackClick(e) {
    if (!this._data) return;
    const { sec, w } = this._trackPos(e);
    const tol = ((this._we - this._ws) / w) * 6;
    const hit = this._data.events.find((ev) => sec >= ev.start - tol && sec <= ev.end + tol);
    if (hit) this._showEvent(hit, 0); else this._seek(sec);
  }

  /* ---------- actions ---------- */
  async _action(a, el) {
    const d = this._data;
    const pre = +this._config.preroll || 0;
    switch (a) {
      case 'live': this._grid = false; this._showLive(); break;
      case 'grid': this._grid = true; this._showLive(); break;
      case 'cam': this._selectCam(+el.dataset.i); break;
      case 'older': if (this._dayIdx < this._days.length - 1) this._loadDay(this._dayIdx + 1); break;
      case 'newer': if (this._dayIdx > 0) this._loadDay(this._dayIdx - 1); break;
      case 'event': { const ev = d && d.events[+el.dataset.i]; if (ev) this._showEvent(ev, 0); break; }
      case 'snapprev': if (this._snapEv) this._showEvent(this._snapEv, this._snapIdx - 1); break;
      case 'snapnext': if (this._snapEv) this._showEvent(this._snapEv, this._snapIdx + 1); break;
      case 'play':
        if (this._mode === 'video' && this._video) { if (this._video.paused) this._video.play().catch(() => {}); else this._video.pause(); }
        else if (this._mode === 'snap' && this._snapEv) this._seek(this._snapEv.start - pre);
        else if (d) {
          const last = d.events[d.events.length - 1];
          if (last) this._seek(last.start - pre);
          else if (d.videos.length) this._playVideo(d.videos[d.videos.length - 1], 0);
        }
        break;
      case 'back': case 'fwd':
        if (this._cursor != null) this._seek(this._cursor + (a === 'back' ? -30 : 30));
        break;
      case 'evprev': case 'evnext': {
        const evs = d ? d.events : [];
        if (!evs.length) break;
        const ref = this._snapEv ? this._snapEv.start : (this._cursor != null ? this._cursor : DAY);
        const ev = a === 'evprev' ? [...evs].reverse().find((x) => x.start < ref - 1) : evs.find((x) => x.start > ref + 1);
        if (ev) this._showEvent(ev, 0); else this._toast('Aucun autre événement');
        break;
      }
      case 'speed':
        this._speedIdx = (this._speedIdx + 1) % SPEEDS.length;
        this.$.speed.textContent = `${SPEEDS[this._speedIdx]}×`;
        if (this._video) this._video.playbackRate = SPEEDS[this._speedIdx];
        this._updateOSD();
        break;
      case 'zoom':
        this._zoomIdx = (this._zoomIdx + 1) % ZOOMS.length;
        this.$.zoom.textContent = `${ZOOMS[this._zoomIdx]} h`;
        this._renderTimeline();
        break;
      case 'download': this._download(); break;
      case 'delete': this._delete(); break;
      case 'full': {
        const v = this.$.viewer;
        if (document.fullscreenElement) document.exitFullscreen();
        else if (v.requestFullscreen) v.requestFullscreen();
        else if (this._mode === 'video' && this._video && this._video.webkitEnterFullscreen) this._video.webkitEnterFullscreen();
        break;
      }
      default: break;
    }
  }

  async _download() {
    let item = null;
    if (this._mode === 'video' && this._curVideo) item = this._curVideo;
    else if (this._mode === 'snap' && this._snapEv) item = this._snapEv.snaps[this._snapIdx];
    if (!item) { this._toast('Sélectionne une vidéo ou une photo'); return; }
    try {
      const url = await this._resolve(item.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this._data.day.title}_${item.title}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { this._toast('Téléchargement impossible'); }
  }

  async _delete() {
    const d = this._data;
    try {
      if (this._mode === 'snap' && this._snapEv) {
        const ev = this._snapEv;
        if (!confirm(`Supprimer les ${ev.snaps.length} photo(s) de l'événement du ${d.day.title} à ${hms(ev.start)} ?`)) return;
        for (const s of ev.snaps) await this._remove(s.id);
        this._toast('Événement supprimé');
        await this._loadDay(this._dayIdx, true);
        const evs = this._data.events;
        const nxt = evs.find((x) => x.start >= ev.start) || evs[evs.length - 1];
        if (nxt) this._showEvent(nxt, 0); else this._showLive();
      } else if (this._mode === 'video' && this._curVideo) {
        const vf = this._curVideo;
        if (!confirm(`Supprimer l'enregistrement ${vf.title} du ${d.day.title} ?`)) return;
        if (this._video) { this._video.pause(); this._video.removeAttribute('src'); delete this._video.dataset.id; this._video.load(); }
        await this._remove(vf.id);
        this._toast('Vidéo supprimée');
        await this._loadDay(this._dayIdx, true);
        this._showLive();
      } else {
        this._toast('Sélectionne un événement ou une vidéo à supprimer');
      }
    } catch (e) {
      this._toast(`Suppression refusée : ${e.message || e.code || e}`);
    }
  }
}

/* ======================================================================= */
/* Éditeur visuel                                                          */
/* ======================================================================= */
const LABELS = {
  entity: 'Caméra',
  title: 'Nom affiché (facultatif)',
  media_root: 'Dossier des enregistrements',
  snap_folder: 'Sous-dossier des photos',
  live_layout: 'Direct avec plusieurs caméras',
  aspect_ratio: 'Format de l\'image',
  max_height: 'Hauteur maximale',
  event_gap: 'Regroupement des photos',
  preroll: 'Pré-lecture avant détection',
  refresh: 'Rafraîchissement du jour',
  osd: 'Incruster nom et heure sur l\'image',
};
const HELPERS = {
  media_root: 'Dossier qui contient les sous-dossiers JJ.MM.AAAA. Vide = direct seulement.',
  snap_folder: 'Nom du dossier des photos dans chaque jour (par défaut : snap).',
  max_height: 'Par exemple 60vh ou 500px.',
  event_gap: 'Photos espacées de moins de X secondes = un seul événement.',
  osd: 'À désactiver si la caméra incruste déjà la date et son nom.',
};
const EDITOR_STYLE = `
.cam{border:1px solid var(--divider-color);border-radius:10px;padding:8px 12px 12px;margin-bottom:12px}
.hd{display:flex;justify-content:space-between;align-items:center;font-weight:500;margin-bottom:8px}
.btn{background:none;border:1px solid var(--divider-color);color:var(--primary-color);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
.btn.del{color:var(--error-color);padding:4px 10px;font-size:13px}
.sec{margin:20px 0 8px;font-weight:500}
.note{color:var(--secondary-text-color);font-size:13px;padding:8px 0}
`;

class NvrCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._folders = null;
    this._forms = [];
  }

  setConfig(config) {
    const c = JSON.parse(JSON.stringify(config || {}));
    if (!Array.isArray(c.cameras)) {
      c.cameras = c.entity ? [clean({ entity: c.entity, media_root: c.media_root, title: c.title, snap_folder: c.snap_folder })] : [{}];
      delete c.entity; delete c.media_root; delete c.title; delete c.snap_folder;
    }
    if (!c.cameras.length) c.cameras = [{}];
    this._config = c;
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._forms.forEach((f) => { f.hass = hass; });
    if (this._globalForm) this._globalForm.hass = hass;
    if (first) this._prepare();
  }

  async _prepare() {
    if (!customElements.get('ha-form') && window.loadCardHelpers) {
      try {
        const h = await window.loadCardHelpers();
        const c = await h.createCardElement({ type: 'entities', entities: [] });
        if (c && c.constructor.getConfigElement) await c.constructor.getConfigElement();
      } catch (e) { /* ignore */ }
    }
    await this._loadFolders();
    this._render(true);
  }

  async _loadFolders() {
    const out = [];
    const seen = new Set();
    const add = (c, prefix) => {
      const id = c.media_content_id;
      if (!c.can_expand || !id || !id.startsWith('media-source://media_source/') || seen.has(id)) return;
      seen.add(id);
      out.push({ value: id, label: `${prefix || ''}${c.title}` });
    };
    const browse = (id) => this._hass.callWS({ type: 'media_source/browse_media', media_content_id: id });
    try {
      const r = await browse('media-source://media_source/local/.');
      (r.children || []).forEach((c) => add(c));
    } catch (e) {
      try {
        const r = await browse('media-source://media_source');
        for (const d of (r.children || []).filter((c) => c.can_expand)) {
          try { const r2 = await browse(d.media_content_id); (r2.children || []).forEach((c) => add(c, `${d.title} / `)); } catch (e2) { /* ignore */ }
        }
      } catch (e3) { /* ignore */ }
    }
    this._folders = out;
  }

  _camSchema() {
    const folder = this._folders && this._folders.length
      ? { select: { mode: 'dropdown', custom_value: true, options: this._folders } }
      : { text: {} };
    return [
      { name: 'entity', required: true, selector: { entity: { domain: 'camera' } } },
      { name: 'title', selector: { text: {} } },
      { name: 'media_root', selector: folder },
      { name: 'snap_folder', selector: { text: {} } },
    ];
  }

  _globalSchema() {
    return [
      { name: 'live_layout', selector: { select: { mode: 'dropdown', options: [
        { value: 'grid', label: 'Mosaïque de toutes les caméras' },
        { value: 'single', label: 'Une caméra à la fois (onglets)' },
      ] } } },
      { name: '', type: 'grid', schema: [
        { name: 'aspect_ratio', selector: { select: { mode: 'dropdown', custom_value: true, options: ['16/9', '4/3', '3/2', '1/1', '3/4', '9/16'] } } },
        { name: 'max_height', selector: { text: {} } },
      ] },
      { name: '', type: 'grid', schema: [
        { name: 'event_gap', selector: { number: { min: 0, max: 900, step: 5, mode: 'box', unit_of_measurement: 's' } } },
        { name: 'preroll', selector: { number: { min: 0, max: 120, step: 1, mode: 'box', unit_of_measurement: 's' } } },
        { name: 'refresh', selector: { number: { min: 15, max: 900, step: 5, mode: 'box', unit_of_measurement: 's' } } },
      ] },
      { name: 'osd', selector: { boolean: {} } },
    ];
  }

  _globalData() {
    const g = Object.assign({}, DEFAULTS, this._config);
    delete g.cameras; delete g.type;
    return g;
  }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  _makeForm(schema, data, onChange) {
    const f = document.createElement('ha-form');
    f.hass = this._hass;
    f.schema = schema;
    f.data = data;
    f.computeLabel = (s) => LABELS[s.name] || s.name;
    f.computeHelper = (s) => HELPERS[s.name];
    f.addEventListener('value-changed', (ev) => { ev.stopPropagation(); onChange(ev.detail.value); });
    return f;
  }

  _render(force = false) {
    if (!this._config || !this._hass) return;
    if (!customElements.get('ha-form')) {
      this.shadowRoot.innerHTML = '<div class="note">Chargement de l\'éditeur…</div>';
      return;
    }
    const cams = this._config.cameras;
    if (!force && this._built && this._forms.length === cams.length) {
      cams.forEach((c, i) => { this._forms[i].data = c; });
      this._globalForm.data = this._globalData();
      return;
    }
    const root = this.shadowRoot;
    root.innerHTML = `<style>${EDITOR_STYLE}</style><div class="cams"></div>
      <button class="btn add" type="button">+ Ajouter une caméra</button>
      <div class="sec">Options d'affichage</div><div class="glob"></div>`;
    this._forms = [];
    const box = root.querySelector('.cams');
    cams.forEach((cam, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'cam';
      wrap.innerHTML = `<div class="hd"><span>Caméra ${i + 1}</span>${cams.length > 1 ? `<button class="btn del" type="button" data-i="${i}">Supprimer</button>` : ''}</div>`;
      const f = this._makeForm(this._camSchema(), cam, (val) => {
        const list = [...this._config.cameras];
        list[i] = clean(val);
        this._emit(Object.assign({}, this._config, { cameras: list }));
      });
      wrap.append(f);
      box.append(wrap);
      this._forms.push(f);
    });
    this._globalForm = this._makeForm(this._globalSchema(), this._globalData(), (val) => {
      this._emit(Object.assign({}, this._config, clean(val), { cameras: this._config.cameras }));
    });
    root.querySelector('.glob').append(this._globalForm);
    root.querySelector('.add').addEventListener('click', () => {
      this._emit(Object.assign({}, this._config, { cameras: [...this._config.cameras, {}] }));
      this._render(true);
    });
    root.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.i;
      this._emit(Object.assign({}, this._config, { cameras: this._config.cameras.filter((_, j) => j !== i) }));
      this._render(true);
    }));
    this._built = true;
  }
}

customElements.define('nvr-card', NvrCard);
customElements.define('nvr-card-editor', NvrCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'nvr-card', name: 'NVR Card', description: 'Direct, mosaïque, frise 24 h, enregistrements et snaps façon NVR', preview: false });
console.info(`%c NVR-CARD %c v${NVR_VERSION} `, 'background:#e53935;color:#fff;font-weight:700', 'background:#11151a;color:#fff');
