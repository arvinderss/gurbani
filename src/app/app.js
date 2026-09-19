'use strict';
// ---------------------------------------------------------------- data
const DATA = JSON.parse(document.getElementById('kosh-data').textContent);
const BANIS = DATA.banis;
const BY_SLUG = new Map(BANIS.map((b) => [b.slug, b]));
const WRITERS = DATA.writers || {};
const cps = (s) => Array.from(s);

/**
 * The two complete Granths are built into their own
 * `<script id="kosh-data-bani-<slug>">` blocks (see tools/build-lib.js
 * DeferLineThreshold) and only parsed when that Bani is actually opened, so
 * boot never touches their ~60-70k lines. `deferred` marks such a stub;
 * the app loads and merges the payload in on demand.
 */
const deferredCache = new Map();
function ensureBaniLines(bani) {
  if (bani.lines) return bani;
  if (bani.lines === null) return bani; // a previous load found nothing
  let payload = deferredCache.get(bani.slug);
  if (!payload) {
    const node = document.getElementById('kosh-data-bani-' + bani.slug);
    if (!node) {
      bani.lines = null;
      return bani;
    }
    try {
      payload = JSON.parse(node.textContent);
    } catch {
      bani.lines = null;
      return bani;
    }
    deferredCache.set(bani.slug, payload);
  }
  bani.sections = payload.sections || [];
  bani.lines = payload.lines;
  return bani;
}
/** How many lines a Bani has, whether or not its full payload is loaded. */
const lineCountOf = (b) => (b.lineCount !== undefined ? b.lineCount : b.lines ? b.lines.length : 0);

/**
 * Word boundaries as [start,end) codepoint offsets - the same split the
 * build used to precompute and embed as `w`. Computing it here (and caching
 * it on the line) moves ~7.7 MB out of the shipped JSON; the first render
 * of a given line pays a tiny one-time cost. A line with no whitespace at
 * all yields one whole-line span, mirroring the old embedded-data shape.
 */
function wordSpans(line) {
  if (line.w && line.w.length) return line.w;
  const cached = line._w;
  if (cached) return cached;
  const chars = cps(line.t);
  const words = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && !/\s/.test(chars[j])) j++;
    words.push([i, j]);
    i = j;
  }
  line._w = words.length ? words : [[0, chars.length]];
  return line._w;
}

// Gurmukhi letters, for first-letter search. Matras, bindi and the like are not letters.
const NON_LETTER = new Set(cps('ਁਂਃ਼ਾਿੀੁੂੇੈੋੌ੍ੑੰੱੵ'));
const firstLetters = (text) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => cps(w).find((c) => !NON_LETTER.has(c)) ?? '')
    .join('');

// ------------------------------------------------------------ settings
const DEFAULTS = {
  theme: 'nihung',
  larivaar: false,
  larivaarAssist: true,
  vishraam: true,
  vishraamStyle: 'colored',
  vishraamKinds: { 0: true, 1: true, 2: true }, // per-severity visibility: 0=short,1=medium,2=long
  paragraph: false,
  continuous: false,
  keepAwake: true,
  showTitles: true,
  autoScrollOnOpen: false, // start auto-scroll immediately when a Bani opens/resumes
  size: 28,
  lh: 1.8,
  weight: 700,
  align: 'center',
  font: 'serif',
  speed: 30, // autoscroll speed as a unit on a 0-100 scale; 100 = 400 wpm
  colors: {},
  favourites: [],
  pothis: [],
  bookmarks: {},
  sehaj: {},
  flags: [], // reader-added "please review this line" notes; see § flags
  baniLog: [], // { slug, start, end, stage, i } - one row per reading arc, all derived views read this; see § bani log
  sampuranWindowDays: 90, // how many days a completed Bani stays in the Completed list, 30/60/90/180/365
  openCats: {}, // which collapsible <details> categories the user has toggled, by id
  searchScope: '', // '' = all Banian; otherwise a granthSlug (see the scope select on Home)
  reminders: [], // { id, label, mode: 'nitnem-morning'|'bani', slug?, time:'HH:MM', days:'daily'|[0-6] }; see § reminders
  remindersFired: {}, // 'id_YYYYMMDD' -> true, so a reminder surfaces once per day at most
};
// Autoscroll speed is a unit on a 0-100 scale (100 = 400 wpm, 0 = stopped).
// Saved values from before this scale existed stored words-per-minute (up to
// 400), so anything above 100 is treated as legacy wpm and folded back in.
const SPEED_MIN = 0;
const SPEED_MAX = 100;
const SPEED_STEP = 6; // ≈ 25 wpm per press
const normalizeSpeed = (v) => (v > 100 ? Math.round(v / 4) : v);
const clampSpeed = (v) => Math.max(SPEED_MIN, Math.min(SPEED_MAX, Math.round(v)));
const speedToWpm = (units) => units * 4;
// Installed-on-device font stacks. The first name is what the reader tries;
// the rest are fallbacks so every choice visibly differs even where the
// named Gurmukhi fonts aren't installed (Gurmukhi glyphs then fall back to
// the system Gurmukhi face).
const FONTS = [
  ['serif', 'System serif'],
  ["'Noto Sans Gurmukhi', 'Nirmala UI', sans-serif", 'Noto Sans Gurmukhi'],
  ["'Gurbani Akhar', 'GurbaniLipi', 'Noto Sans Gurmukhi', sans-serif", 'Gurbani Akhar'],
  ["'Mukta Mahee', 'Noto Sans Gurmukhi', sans-serif", 'Mukta Mahee'],
  ["'Noto Serif Gurmukhi', 'Noto Serif', serif", 'Noto Serif'],
  ["'Roboto Condensed', 'sans-serif-condensed', sans-serif", 'Condensed sans'],
  ["'Noto Sans Mono', 'Roboto Mono', 'Courier New', monospace", 'Monospace'],
  ['cursive', 'Cursive'],
  ['casual', 'Casual'],
  ["'Georgia', 'Palatino', 'Times New Roman', serif", 'Georgia'],
  ["'Garamond', 'Book Antiqua', 'Palatino', serif", 'Garamond'],
  ["'Times New Roman', 'Times', serif", 'Times'],
  ["'Arial', 'Helvetica Neue', sans-serif", 'Arial'],
  ["'Verdana', 'Geneva', sans-serif", 'Verdana'],
  ["'Trebuchet MS', 'Segoe UI', sans-serif", 'Trebuchet MS'],
  ["'AnmolLipi', 'Noto Sans Gurmukhi', sans-serif", 'AnmolLipi'],
  ["'Magaz', 'Noto Sans Gurmukhi', sans-serif", 'Magaz'],
  ["'Raajaa', 'Noto Sans Gurmukhi', sans-serif", 'Raajaa'],
  ["'Lanma', 'Noto Sans Gurmukhi', sans-serif", 'Lanma'],
  ["'Gurbani Web Thick', 'Noto Sans Gurmukhi', sans-serif", 'Gurbani Web Thick'],
  ["'GHW Dukandar', 'Noto Sans Gurmukhi', sans-serif", 'GHW Dukandar'],
  ["'Punjabi Typewriter', 'Noto Sans Gurmukhi', monospace", 'Punjabi Typewriter'],
  ["'GHW Adhiapak', 'Noto Sans Gurmukhi', sans-serif", 'GHW Adhiapak'],
  ["'Karmic Sanj', 'Noto Sans Gurmukhi', sans-serif", 'Karmic Sanj'],
];
const KEY = 'pothi-sahib-standalone';
let S = load();
function load() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    s = {};
  }
  // Adopt the new built-in defaults when an install still sits on the old
  // ones (the pre-Nihung defaults). Any personalised setting is kept.
  if (s.theme === 'light' && s.lh === 2.2 && s.font === "'Noto Sans Gurmukhi', 'Nirmala UI', sans-serif") {
    s = { ...s, theme: DEFAULTS.theme, lh: DEFAULTS.lh, font: DEFAULTS.font };
  }
  const out = { ...DEFAULTS, ...s };
  out.speed = clampSpeed(normalizeSpeed(out.speed));
  out.reminders = sanitizeReminders(s.reminders);
  out.remindersFired = sanitizeFiredReminders(s.remindersFired);
  if (typeof out.searchScope !== 'string' || !out.searchScope) out.searchScope = '';
  return out;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* private mode: settings simply do not persist */
  }
  applyTheme();
}
// Screen-reader status announcements
function announce(msg) {
  const el2 = document.getElementById('sr-announce');
  if (!el2) return;
  el2.textContent = '';
  requestAnimationFrame(() => {
    el2.textContent = msg;
  });
}

// Native alert()/confirm() don't render in a bare Android WebView (it has
// no WebChromeClient), so every app dialog goes through these <dialog>
// helpers instead - consistent UI on all platforms, and nothing relies on a
// JS dialog being shown by the host.
function dialogBox({ title, body, okText = 'OK' } = {}) {
  return new Promise((resolve) => {
    const ok = el('button', { class: 'primary', text: okText });
    const dlg = el('dialog', {}, [
      el('div', { class: 'dialog-head row' }, [
        el('strong', { text: title || '' }),
        el('div', { class: 'grow' }),
        el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
      ]),
      el('div', { class: 'dialog-body' }, [body]),
      el('div', { class: 'row', style: 'justify-content:flex-end' }, [ok]),
    ]);
    const done = (v) => {
      resolve(v);
      if (!dlg.open) dlg.close();
      dlg.remove();
    };
    ok.addEventListener('click', () => done(true));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    dlg.addEventListener('close', () => done(false));
    document.body.append(dlg);
    dlg.showModal();
  });
}

function confirmBox({ title, body, okText = 'Continue', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const ok = el('button', { class: 'primary', text: okText });
    const cancel = el('button', { text: cancelText });
    const dlg = el('dialog', {}, [
      el('div', { class: 'dialog-head row' }, [el('strong', { text: title || 'Confirm' })]),
      el('div', { class: 'dialog-body' }, [body]),
      el('div', { class: 'row', style: 'justify-content:flex-end;gap:.5rem' }, [cancel, ok]),
    ]);
    const done = (v) => {
      resolve(v);
      if (!dlg.open) dlg.close();
      dlg.remove();
    };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      done(false);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Coarse relative time for the Continue Reading list ("3 days ago"). */
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  const steps = [
    [60, 'just now', null],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [2592000, 'day', 86400],
    [31536000, 'month', 2592000],
    [Infinity, 'year', 31536000],
  ];
  for (const [limit, unit, div] of steps) {
    if (s < limit) {
      if (!div) return unit;
      const n = Math.floor(s / div);
      return n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
    }
  }
  return 'a while ago';
}

/**
 * The single most recent baniLog row for a slug, or null. Every derived
 * view (Continue Reading, Completed, Archive, "is this unread") is just
 * this one query filtered/grouped by .stage - see the § bani log note in
 * renderRead. A row is reused across sessions until it's completed, so
 * there's normally at most a handful of rows per Bani, not one per open.
 */
function latestEntryFor(slug) {
  let latest = null;
  for (const e of S.baniLog) {
    if (e.slug === slug && (!latest || e.start >= latest.start)) latest = e;
  }
  return latest;
}

/** Reading progress % for a Bani slug, or null if never opened. */
function progressFor(slug) {
  const entry = latestEntryFor(slug);
  const bani = BY_SLUG.get(slug);
  if (!entry || !bani) return null;
  return Math.round((entry.i / Math.max(1, lineCountOf(bani) - 1)) * 100);
}

/** Clear saved reading state for a Bani so it behaves as unread again. */
function markUnread(slug) {
  const before = S.baniLog.length;
  S.baniLog = S.baniLog.filter((e) => e.slug !== slug);
  if (S.baniLog.length === before) return false;
  save();
  const bani = BY_SLUG.get(slug);
  announce((bani ? bani.name : 'Bani') + ' marked unread');
  return true;
}

const COLOR_VARS = [
  ['gurbani', 'Gurbani'],
  ['title', 'Titles'],
  ['assist', 'Larivaar Assist'],
  ['v-long', 'Long Vishraam'],
  ['v-med', 'Medium Vishraam'],
  ['v-short', 'Short Vishraam'],
  ['bg', 'Background'],
];
function applyTheme() {
  const r = document.documentElement;
  r.dataset.theme = S.theme;
  r.dataset.larivaar = S.larivaar ? 'on' : 'off';
  r.dataset.assist = S.larivaarAssist ? 'on' : 'off';
  r.dataset.vishraam = S.vishraam ? S.vishraamStyle : 'off';
  r.dataset.paragraph = S.paragraph ? 'on' : 'off';
  const st = r.style;
  st.setProperty('--size', S.size + 'px');
  st.setProperty('--lh', String(S.lh));
  st.setProperty('--weight', String(S.weight));
  st.setProperty('--align', S.align);
  st.setProperty('--gur', S.font);
  for (const [k] of COLOR_VARS) {
    const v = S.colors[k];
    if (v) st.setProperty('--' + k, v);
    else st.removeProperty('--' + k);
  }
}

// ---------------------------------------------------------------- view
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const subEl = document.getElementById('sub');
const backEl = document.getElementById('back');
let route = { tab: 'home' };

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== false && v !== undefined) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
};
/** The app's mark: the Waheguru (Ik Onkar) emblem. Source of truth is
 * assets/waheguru.png; LOGO_URI below is an optimised 256p render of it kept
 * inline so the app stays a single offline file (see .logo-mark / .bar-logo
 * in styles.css). The browser favicon (head.html) is the same PNG at 96p,
 * synced via tools/make-favicon.js, and the Android launcher icons are
 * resized copies of the same source. The share-card logo draws this same
 * bitmap, so the mark no longer recolours with the accent. */
const LOGO_URI =
  'data:image/png;base64,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';

const logoMark = (className) =>
  el('span', { class: 'logo-mark' + (className ? ' ' + className : ''), 'aria-hidden': 'true' }, [
    el('img', { src: LOGO_URI, alt: '', draggable: 'false' }),
  ]);

const sw = (checked, onchange, label) =>
  el('button', {
    class: 'sw',
    role: 'switch',
    'aria-checked': String(!!checked),
    'aria-label': label,
    onclick: () => onchange(!checked),
  });
const setting = (label, control, desc) =>
  el('div', { class: 'setting' }, [
    el('label', {}, [document.createTextNode(label), desc ? el('span', { class: 'desc', text: desc }) : null]),
    control,
  ]);

/**
 * A collapsible <details> section used for both Home groups and Settings
 * categories. Open/closed state persists per-id in S.openCats so the app
 * remembers what a person collapsed. `defaultOpen` only matters the first
 * time a given id is ever seen.
 */
function catDetails(id, icon, title, nodes, defaultOpen = true) {
  const isOpen = id in S.openCats ? S.openCats[id] : defaultOpen;
  const d = document.createElement('details');
  d.className = 'cat';
  d.open = isOpen;
  d.addEventListener('toggle', () => {
    S.openCats[id] = d.open;
    save();
  });
  const summary = document.createElement('summary');
  const h = el('h2', { class: 'section cat-title' });
  const ic = el('em', { class: 'sec-ic', 'aria-hidden': 'true', text: icon });
  h.append(ic, document.createTextNode(' ' + title));
  summary.append(h);
  d.append(summary, ...[].concat(nodes).filter(Boolean));
  return d;
}

function go(r) {
  const leavingRead = route.tab === 'read' && r.tab !== 'read';
  route = r;
  stopScroll();
  if (leavingRead) releaseWakeLock();
  render();
  window.scrollTo(0, 0);
}

function render() {
  drainCleanup();
  view.replaceChildren();
  backEl.hidden = route.tab !== 'read';
  document.getElementById('tabs').hidden = route.tab === 'read';
  for (const b of document.querySelectorAll('nav.tabs button')) b.toggleAttribute('aria-current', b.dataset.tab === route.tab);
  subEl.textContent = '';
  ({ home: renderHome, settings: renderSettingsPage, read: renderRead })[route.tab]();
  // Move keyboard/screen-reader focus into the new view
  requestAnimationFrame(() => {
    const m = document.getElementById('view');
    if (m) m.focus({ preventScroll: true });
  });
}

// ---------------------------------------------------------------- home
/**
 * The Nitnem order as recited, and which Bani to show first when a source
 * holds more than one recension. Both come from manifest.json (via the
 * build), so re-ordering Nitnem is a one-line edit there, not a code change.
 */
const NITNEM = DATA.nitnem;

// The five morning Nitnem Banian, for the "Nitnem · morning" reminder
// preset (a combined sequential read, exactly like the Home Read button).
const NITNEM_MORNING = ['jap-ji-sahib', 'jaap-sahib', 'tav-prasad-savaiye-sravag-sudh', 'benti-chaupai-sahib', 'anand-sahib'];
const NITNEM_MORNING_LABEL = 'Nitnem · morning (5 Banian)';

const REMINDER_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function reminderScheduleText(r) {
  if (r.days === 'daily') return 'Every day · ' + r.time;
  if (Array.isArray(r.days) && r.days.length) return r.days.sort((a, b) => a - b).map((d) => REMINDER_WEEKDAYS[d]).join(', ') + ' · ' + r.time;
  return 'Daily · ' + r.time;
}
const localDay = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

/**
 * Full-text search across every line of every Bani. Ranks hits (best first):
 *  0  exact whole-line match
 *  1  "heavy phrase" - all words of the query present, or the query matches
 *     the *first letter of each word* (Gurbani is often recalled by its
 *     opening letters, so "ਸਸਸਸ" finds a line whose words start so)
 *  2  plain substring
 *  3  any single query token
 * Within a tier, sources ordered SGGS → Dasam → Panthic → rest (see
 * granthRank), then by Ang within a Granth, then by line. Capped so a
 * broad query (e.g. a single common letter) stays fast and usable.
 */
const GO_TO_ANG_RE = /^(?:ang|ਅੰਗ|ਪੰਨਾ|panna|panaa|pan|page)\s*(\d{1,4})$|^(\d{1,4})$/i;

// Reminder records are user-typed state, so every path that accepts them
// (load, backup import) goes through the same whitelist: capped list, a
// real bani unless it's the Nitnem preset, and a sane time/days shape.
function sanitizeReminders(arr) {
  if (!Array.isArray(arr)) return [];
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const out = [];
  for (const r of arr) {
    if (!r || typeof r !== 'object' || out.length >= 50) break;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : '';
    const time = typeof r.time === 'string' && TIME_RE.test(r.time) ? r.time : '';
    if (!label || !time) continue;
    let days = r.days;
    if (days === 'daily') days = 'daily';
    else if (Array.isArray(days)) {
      days = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
      if (!days.length) continue;
    } else continue;
    const isBani = r.mode === 'bani' && typeof r.slug === 'string' && BY_SLUG.has(r.slug);
    out.push({
      id: typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,30}$/.test(r.id) ? r.id : 'r' + Date.now().toString(36),
      label,
      mode: isBani ? 'bani' : 'nitnem-morning',
      slug: isBani ? r.slug : null,
      time,
      days,
    });
  }
  return out;
}
// Fired marks (<id>_<YYYYMMDD>) are pure history; keep them long enough to
// stop a reminder re-firing, drop anything malformed, and cap the total.
function sanitizeFiredReminders(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const key of Object.keys(obj)) {
    if (!/^[A-Za-z0-9_-]{1,30}_\d{8}$/.test(key) || obj[key] !== true) continue;
    out[key] = true;
    if (Object.keys(out).length >= 500) break;
  }
  return out;
}
// ── reminders: runtime ─────────────────────────────────────────────────
// Fired while the app is open: checkReminders() compares each reminder's
// time/days with now and shows a <dialog> that can open the read (exactly
// like a bookmark click), then marks it fired for the day so it won't nag.
function checkReminders() {
  if (document.visibilityState === 'hidden' || !S.reminders.length) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
  const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
  const dow = now.getDay();
  let changed = false;
  for (const r of S.reminders) {
    const key = r.id + '_' + today;
    if (S.remindersFired[key]) continue;
    const dayOk = r.days === 'daily' || (Array.isArray(r.days) && r.days.includes(dow));
    if (!dayOk || hhmm < r.time) continue;
    S.remindersFired[key] = true;
    changed = true;
    const slugs = r.mode === 'bani' ? [r.slug] : NITNEM_MORNING;
    const body = el('div', { class: 'dialog-body' }, [
      el('p', { style: 'margin:.2rem 0', text: 'It’s time for your daily reading' }),
      el('p', { style: 'margin:.2rem 0;font-weight:600', text: r.label }),
      el('p', { class: 'muted small', style: 'margin:.2rem 0', text: reminderScheduleText(r) }),
    ]);
    const dlg = el('dialog', {}, [
      el('div', { class: 'dialog-head row' }, [el('strong', { text: '⏰ Reminder' })]),
      body,
      el('div', { class: 'row', style: 'gap:.5rem;justify-content:flex-end;padding-bottom:.2rem' }, [
        el('button', { text: 'Dismiss', onclick: () => dlg.close() }),
        el('button', {
          class: 'primary',
          text: 'Open',
          onclick: () => {
            dlg.close();
            go(r.mode === 'bani' ? { tab: 'read', key: r.slug, title: r.label } : { tab: 'read', slugs, key: 'nitnem', title: r.label });
          },
        }),
      ]),
    ]);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
  if (changed) save();
}
// Check on a slow tick. In Node/jsdom (build harnesses) unref() keeps the
// process able to exit between ticks; browsers get the schedule either way.
const reminderTimer = setInterval(checkReminders, 60000);
if (typeof reminderTimer === 'object' && typeof reminderTimer.unref === 'function') reminderTimer.unref();

/**
 * The single most recent baniLog row for a slug, or null. Every derived
 * view (Continue Reading, Completed, Archive, "is this unread") is just
 * this one query filtered/grouped by .stage - see the § bani log note in
 * renderRead. A row is reused across sessions until it's completed, so
 * there's normally at most a handful of rows per Bani, not one per open.
 */

// ── phonetic search: Latin letters → Gurmukhi ───────────────────────────
// Typing is much easier in English letters (waheguru, sukhmani), so a
// Latin-only query is first looked up in this word list and the search is
// run on the Gurmukhi it maps to. The list deliberately keeps the common
// spellings used in everyday Sikh parlance - not a full transliterator,
// just the words people actually type to find Gurbani.
const PHONETIC = {
  'ik onkar': 'ੴ', onkar: 'ੴ', onkaar: 'ੴ', 'ik onkaar': 'ੴ', 'ek onkar': 'ੴ', 'ik oankaar': 'ੴ',
  waheguru: 'ਵਾਹਿਗੁਰੂ', vahiguru: 'ਵਾਹਿਗੁਰੂ', vaahiguru: 'ਵਾਹਿਗੁਰੂ',
  guru: 'ਗੁਰੂ', satguru: 'ਸਤਿਗੁਰੂ', 'guru nanak': 'ਗੁਰੂ ਨਾਨਕ', nanak: 'ਨਾਨਕ', 'gobind': 'ਗੋਬਿੰਦ',
  sahib: 'ਸਾਹਿਬ', jee: 'ਜੀ', ji: 'ਜੀ', dev: 'ਦੇਵ', rai: 'ਰਾਇ',
  sat: 'ਸਤਿ', saa: 'ਸਾ', sach: 'ਸਚੁ', sachu: 'ਸਚੁ', naam: 'ਨਾਮੁ', nam: 'ਨਾਮੁ', naanak: 'ਨਾਨਕ',
  karta: 'ਕਰਤਾ', purakh: 'ਪੁਰਖੁ', purkh: 'ਪੁਰਖੁ', nirbhau: 'ਨਿਰਭਉ', nirbhao: 'ਨਿਰਭਉ',
  nirvair: 'ਨਿਰਵੈਰੁ', nirvairu: 'ਨਿਰਵੈਰੁ', akaal: 'ਅਕਾਲ', akal: 'ਅਕਾਲ', moorti: 'ਮੂਰਤਿ',
  murti: 'ਮੂਰਤਿ', ajooni: 'ਅਜੂਨੀ', ajuni: 'ਅਜੂਨੀ', saibhang: 'ਸੈਭੰ', gur: 'ਗੁਰ',
  parsaad: 'ਪ੍ਰਸਾਦਿ', prasad: 'ਪ੍ਰਸਾਦਿ', prasadh: 'ਪ੍ਰਸਾਦਿ',
  jap: 'ਜਪੁ', japji: 'ਜਪੁਜੀ', 'jap ji sahib': 'ਜਪੁ ਜੀ ਸਾਹਿਬ', 'japji sahib': 'ਜਪੁ ਜੀ ਸਾਹਿਬ',
  prabh: 'ਪ੍ਰਭ', parbrahm: 'ਪਰਬ੍ਰਹਮ', parabrahm: 'ਪਰਬ੍ਰਹਮ', brahm: 'ਬ੍ਰਹਮ', brahma: 'ਬ੍ਰਹਮ',
  har: 'ਹਰਿ', hari: 'ਹਰਿ', ram: 'ਰਾਮ', raam: 'ਰਾਮ', gobind: 'ਗੋਬਿੰਦ', gobindh: 'ਗੋਬਿੰਦ',
  krishan: 'ਕ੍ਰਿਸਨ', madhava: 'ਮਾਧਵ', madho: 'ਮਾਧਉ', murlidhar: 'ਮੁਰਲੀਧਰ', mohan: 'ਮੋਹਨ',
  sukh: 'ਸੁਖ', sukhmani: 'ਸੁਖਮਨੀ', sukhmaani: 'ਸੁਖਮਨੀ', rehras: 'ਰਹਰਾਸਿ', rehraas: 'ਰਹਰਾਸਿ',
  sohila: 'ਸੋਹਿਲਾ', kirtan: 'ਕੀਰਤਨ', gurbani: 'ਗੁਰਬਾਣੀ', bani: 'ਬਾਣੀ', baniya: 'ਬਾਣੀਆਂ',
  nitnem: 'ਨਿਤਨੇਮ', panj: 'ਪੰਜ', panch: 'ਪੰਜ', baniyaan: 'ਬਾਣੀਆਂ',
  jaap: 'ਜਾਪ', sahib: 'ਸਾਹਿਬ', 'jaap sahib': 'ਜਾਪ ਸਾਹਿਬ', japp: 'ਜਾਪੁ', japu: 'ਜਾਪੁ',
  chaupai: 'ਚੌਪਈ', 'chaupai sahib': 'ਚੌਪਈ ਸਾਹਿਬ', benti: 'ਬੇਨਤੀ', 'benti chaupai': 'ਬੇਨਤੀ ਚੌਪਈ',
  anand: 'ਅਨੰਦੁ', 'anand sahib': 'ਅਨੰਦ ਸਾਹਿਬ', ardaas: 'ੴ ਅਰਦਾਸ', ardas: 'ਅਰਦਾਸ',
  kirtan: 'ਕੀਰਤਨ', aarti: 'ਆਰਤੀ', arti: 'ਆਰਤੀ', aarta: 'ਆਰਤੀ',
  simran: 'ਸਿਮਰਨ', simrin: 'ਸਿਮਰਨਿ', sehaj: 'ਸਹਜ', sahaj: 'ਸਹਜ',
  'gur granth': 'ਗੁਰ ਗ੍ਰੰਥ', 'granth sahib': 'ਗ੍ਰੰਥ ਸਾਹਿਬ', granth: 'ਗ੍ਰੰਥ', sggs: 'ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ',
  'sri guru granth sahib': 'ਸ੍ਰੀ ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ', dasam: 'ਦਸਮ', 'dasam granth': 'ਦਸਮ ਗ੍ਰੰਥ',
  japuji: 'ਜਪੁਜੀ', jaapuji: 'ਜਾਪੁਜੀ', japo: 'ਜਪਉ',
  ang: 'ਅੰਗ', mool: 'ਮੂਲ', mantra: 'ਮੰਤ੍ਰ', mantr: 'ਮੰਤ੍ਰ', gurmantar: 'ਗੁਰਮੰਤ੍ਰ',
  sampuran: 'ਸੰਪੂਰਨ', saroop: 'ਸਰੂਪ', parkash: 'ਪ੍ਰਕਾਸ਼', sukhasa: 'ਸੁਖਾਸਨਾ',
  'mehla': 'ਮਹਲਾ', mhala: 'ਮਹਲਾ', raag: 'ਰਾਗ', ashpadi: 'ਅਸ਼ਟਪਦੀ', ashtpadi: 'ਅਸ਼ਟਪਦੀ',
  salok: 'ਸਲੋਕ', slok: 'ਸਲੋਕ', pauri: 'ਪਉੜੀ', pauRi: 'ਪਉੜੀ', shabad: 'ਸਬਦ', sadd: 'ਸਦ',
  'rehat': 'ਰਹਿਤ', 'maryada': 'ਮਰਯਾਦਾ', 'rehat maryada': 'ਰਹਿਤ ਮਰਯਾਦਾ', 'sikh': 'ਸਿੱਖ',
  amrit: 'ਅੰਮ੍ਰਿਤ', amritdhari: 'ਅੰਮ੍ਰਿਤਧਾਰੀ', khande: 'ਖੰਡੇ', di: 'ਦੀ', pahul: 'ਪਾਹੁਲ',
  kakar: 'ਕਕਾਰ', kes: 'ਕੇਸ', kangha: 'ਕੰਘਾ', kara: 'ਕੜਾ', kirpan: 'ਕਿਰਪਾਨ', kachha: 'ਕਛਹਿਰਾ',
  keshas: 'ਕੇਸ਼', satnaam: 'ਸਤਿ ਨਾਮੁ', 'sat naam': 'ਸਤਿ ਨਾਮੁ',
};
/** If a Latin-only query maps fully to Gurmukhi, return { gurmukhi } (a joined
 *  string); otherwise null so callers fall back to the plain Gurmukhi search. */
function phoneticQuery(latin) {
  const words = latin.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || /[^a-z\s]/.test(latin)) return null;
  const mapped = words.map((w) => PHONETIC[w]).filter(Boolean);
  if (!mapped.length || mapped.length !== words.length) return null;
  return { gurmukhi: mapped.join(' ') };
}

const granthPriority = new Map(); // granthSlug -> SGGS-first rank (lazy)
function granthRank(slug) {
  if (!granthPriority.size) {
    let r = 0;
    for (const b of BANIS) {
      if (granthPriority.has(b.granthSlug)) continue;
      // SGGS content leads, then Dasam, then Panthic, then everything else
      if (b.granthSlug === 'granth-sahib-ji' || b.granthSlug === 'sggs') granthPriority.set(b.granthSlug, 0);
      else if (b.granthSlug === 'dasam') granthPriority.set(b.granthSlug, 1);
      else if (b.granthSlug === 'panthic-compilations') granthPriority.set(b.granthSlug, 2);
      else granthPriority.set(b.granthSlug, 3 + r++);
    }
  }
  return granthPriority.get(slug) ?? 99;
}
/**
 * First line index whose Ang equals the requested one. angMap is the RLE
 * [runStart, value, runStart, value, ...] flat that flatAt() reads, so the
 * answer is just the runStart of the run whose value is the Ang.
 */
function angToFirstIndex(angMap, ang) {
  if (!angMap || ang < 1) return null;
  for (let k = 1; k < angMap.length; k += 2) {
    const v = angMap[k];
    if (v == null) continue;
    if (v === ang) return angMap[k - 1];
    if (v > ang) return null; // ordered; this Bani never reaches that Ang
  }
  return null;
}
function searchLines(query, limit = 60, scope = '') {
  const q = query.trim();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const byFirstLetters = cps(q).every((c) => !NON_LETTER.has(c) && !/\s/.test(c));
  const byFL = byFirstLetters ? firstLetters(q) : null;
  const results = [];
  for (const b of BANIS) {
    if (scope && b.granthSlug !== scope) continue;
    ensureBaniLines(b);
    if (!b.lines) continue;
    const srcKey = granthRank(b.granthSlug) * 1000;
    for (let i = 0; i < b.lines.length; i++) {
      const line = b.lines[i];
      const t = line.t;
      let tier = -1;
      if (t.trim() === q) tier = 0;
      else if (byFL && firstLetters(t).includes(byFL)) tier = 1;
      else if (tokens.every((tok) => t.includes(tok))) tier = 1;
      else if (t.includes(q)) tier = 2;
      else if (tokens.some((tok) => t.includes(tok))) tier = 3;
      if (tier < 0) continue;
      results.push({ bani: b, lineIndex: i, text: t, tier, srcKey });
      if (results.length > 6000) break; // safety valve; ranked below, not here
    }
  }
  results.sort(
    (a, b2) =>
      a.srcKey - b2.srcKey ||
      a.tier - b2.tier ||
      (flatAt(a.bani.angMap, a.lineIndex) ?? 0) - (flatAt(b2.bani.angMap, b2.lineIndex) ?? 0) ||
      a.lineIndex - b2.lineIndex,
  );
  return results.slice(0, limit);
}

function renderHome() {
  titleEl.textContent = 'Pothi Sahib';
  // Full-text search scans all 137k+ lines; debounced so fast typing
  // doesn't trigger a scan per keystroke.
  let searchTimer = null;
  const scopes = new Map(); // granthSlug -> granth display name (first Bani wins)
  for (const b of BANIS) if (!scopes.has(b.granthSlug)) scopes.set(b.granthSlug, b.granth);
  const scopeSel = el(
    'select',
    {
      'aria-label': 'Search scope',
      style: 'flex:0 0 auto;max-width:13rem',
      onchange: (e) => {
        S.searchScope = e.target.value;
        save();
        draw(S.searchScope);
      },
    },
    [
      el('option', { value: '', text: 'All granths', selected: S.searchScope === '' }),
      ...[...scopes.entries()]
        .sort((a, b) => granthRank(a[0]) - granthRank(b[0]))
        .map(([slug, name]) => el('option', { value: slug, text: name, selected: S.searchScope === slug })),
    ],
  );
  const q = el('input', {
    type: 'search',
    placeholder: 'Filter Banian, or search the text…',
    'aria-label': 'Filter Banian or search the text',
    style: 'flex:1;min-width:0',
    oninput: (e) => {
      const value = e.target.value.trim().toLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => draw(value), 150);
    },
  });
  const holder = el('div');
  view.append(
    el('div', { class: 'home-hero' }, [logoMark('home-hero-logo')]),
    el('div', { class: 'row', style: 'gap:.5rem;margin-bottom:.75rem' }, [q, scopeSel]),
    holder,
  );
  renderContinueReading();
  draw('');
  renderPractice();
  renderCompletedBanis();
  renderBookmarksArchive();
  renderMyBookmarks();

  /**
   * My Practice — a private dashboard over S.baniLog (no network, nothing
   * shared). Shows the current reading streak, completions, an activity
   * grid for the last 14 days and a few milestones. baniLog rows are one
   * per reading arc, so "active days" counts the distinct dates a row
   * ended on and "sessions" counts arcs; both are honest to the data we
   * actually capture.
   */
  function renderPractice() {
    const old = view.querySelector('.my-practice');
    if (old) old.remove();
    const log = S.baniLog;
    const todayStr = localDay(Date.now());
    const yesterdayStr = localDay(Date.now() - 86400000);
    const endDays = new Set(log.map((e) => localDay(e.end)));
    const sessions = log.length;
    const completions = log.filter((e) => e.stage === 'completed');
    const activeDays = endDays.size;
    let streak = 0;
    let cursor = endDays.has(todayStr) || endDays.has(yesterdayStr) ? new Date(Date.now()) : null;
    if (cursor && !endDays.has(todayStr)) cursor = new Date(Date.now() - 86400000);
    while (cursor && endDays.has(localDay(cursor.getTime()))) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    let longest = 0;
    {
      const dayNum = (s) => Math.floor(new Date(s + 'T00:00:00Z').getTime() / 86400000);
      const list = [...endDays].map(dayNum).sort((a, b) => a - b);
      for (let i = 0, run = 0; i < list.length; i++) {
        if (i > 0 && list[i] - list[i - 1] === 1) run = (run || 1) + 1;
        else run = 1;
        if (run > longest) longest = run;
      }
      if (list.length === 1) longest = 1;
    }

    // last-14-days activity grid: a filled cell per read day
    const dayCells = [];
    for (let back = 13; back >= 0; back--) {
      const ts = Date.now() - back * 86400000;
      const d = new Date(ts);
      const key = localDay(ts);
      const dow = d.toLocaleDateString('en-US', { weekday: 'narrow' });
      const isToday = key === todayStr;
      dayCells.push(
        el(
          'span',
          {
            class: 'activity-cell' + (endDays.has(key) ? ' on' : '') + (isToday ? ' today' : ''),
            title: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
            'aria-label': d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + (endDays.has(key) ? ': read' : ': not read'),
          },
          [isToday ? todayStr.slice(8, 10) : dow],
        ),
      );
    }

    // completions per Bani (any stage='completed' row, any recension)
    const perBani = new Map();
    for (const e of completions) perBani.set(e.slug, (perBani.get(e.slug) ?? 0) + 1);
    const rankedBani = [...perBani.entries()]
      .sort((a, b) => b[1] - a[1] || (BY_SLUG.get(a[0])?.name ?? a[0]).localeCompare(BY_SLUG.get(b[0])?.name ?? b[0]))
      .slice(0, 8);

    const stat = (label, value, sub) =>
      el('div', { class: 'stat-tile' }, [
        el('div', { class: 'stat-value', text: String(value) }),
        el('div', { class: 'stat-label', text: label }),
        sub ? el('div', { class: 'small muted', text: sub }) : null,
      ]);

    const milestones = [
      ['Streak 3 days', 'st3', streak >= 3],
      ['Streak 7 days', 'st7', streak >= 7],
      ['Streak 14 days', 'st14', streak >= 14],
      ['Streak 30 days', 'st30', streak >= 30],
      ['First ਸੰਪੂਰਨ', 'c1', completions.length >= 1],
      ['5 Banian completed', 'c5', completions.length >= 5],
      ['10 Banian completed', 'c10', completions.length >= 10],
      ['25 Banian completed', 'c25', completions.length >= 25],
      ['7 active days', 'd7', activeDays >= 7],
      ['30 active days', 'd30', activeDays >= 30],
    ];

    const numbers = el('div', { class: 'practice-stats', style: 'margin-bottom:.6rem' }, [
      stat('Current streak', streak, streak ? 'days' : 'start today'),
      stat('ਸੰਪੂਰਨ done', completions.length, 'banian completed'),
      stat('Sessions', sessions, 'reading arcs'),
      stat('Active days', activeDays, 'distinct days'),
    ]);

    const grid = el('div', { class: 'practice-grid' }, [
      el('div', { class: 'muted small', style: 'margin-bottom:.35rem', text: 'Last 14 days — private to you, never shared or ranked' }),
      el('div', { class: 'activity-grid', role: 'img', 'aria-label': 'Reading activity, last 14 days' }, dayCells),
    ]);

    const completionsList = el('div', { class: 'practice-banis', style: 'margin-top:.6rem' }, [
      el('div', { class: 'muted small', style: 'margin-bottom:.35rem', text: 'Banian/completions' }),
      rankedBani.length
        ? rankedBani.map(([slug, n]) =>
            el('div', { class: 'row', style: 'gap:.5rem;margin:.2rem 0' }, [
              el('span', { style: 'flex:1', text: (BY_SLUG.get(slug)?.name ?? slug) + '' }),
              el('span', { class: 'small muted', text: n + '×' }),
            ]),
          )
        : el('p', { class: 'small muted', text: 'No.sampuran completions yet.' }),
    ]);

    const chips = el('div', { class: 'ach-chips' }, [
      ...milestones.map(([label, k, done]) =>
        el('span', { class: 'ach-chip' + (done ? ' done' : ''), title: k, text: (done ? '✓ ' : '○ ') + label }),
      ),
    ]);

    const section = el('div', { class: 'my-practice' }, [
      catDetails('home-practice', '🪘', 'My Practice · Progress & Habits', [numbers, grid, completionsList, chips], false),
    ]);
    view.append(section);
  }

  /**
   * All three sections below are pure queries over S.baniLog, filtered by
   * each slug's *latest* row's .stage - there is no separate stored list
   * for any of them. See progressFor()/latestEntryFor() and the § bani log
   * note in renderRead() for how rows are created/reused/transitioned.
   */
  function renderCompletedBanis() {
    const old = view.querySelector('.completed-banis');
    if (old) old.remove();
    const windowMs = S.sampuranWindowDays * 86400000;
    const now = Date.now();
    const completed = [];
    for (const b of BANIS) {
      const entry = latestEntryFor(b.slug);
      if (entry && entry.stage === 'completed' && now - entry.end <= windowMs) completed.push([b, entry]);
    }
    completed.sort((a, c) => c[1].end - a[1].end);
    const windowSelect = el('div', { class: 'row', style: 'gap:.5rem;align-items:center;margin-bottom:.5rem' }, [
      el('span', { class: 'small muted', text: 'Show completed in the last' }),
      el(
        'select',
        {
          onchange: (e) => {
            S.sampuranWindowDays = +e.target.value;
            save();
            renderCompletedBanis();
          },
        },
        [30, 60, 90, 180, 365].map((d) => el('option', { value: String(d), text: d + ' days', selected: d === S.sampuranWindowDays })),
      ),
    ]);
    const rows = completed.length
      ? completed.map(([b, entry]) =>
          el('div', { class: 'row', style: 'margin: 0.5rem 0' }, [
            el('div', { style: 'flex:1' }, [
              el('div', { text: b.name }),
              el('div', { class: 'small muted', text: 'ਸੰਪੂਰਨ · completed ' + timeAgo(entry.end) }),
            ]),
            el('button', {
              class: 'quiet small',
              text: 'Remove',
              'aria-label': 'Remove ' + b.name + ' from Completed',
              onclick: () => {
                entry.stage = 'archived';
                save();
                renderCompletedBanis();
                renderBookmarksArchive();
              },
            }),
            el('button', {
              class: 'quiet small',
              text: 'Unread',
              'aria-label': 'Mark ' + b.name + ' unread',
              onclick: () => {
                if (markUnread(b.slug)) render();
              },
            }),
          ]),
        )
      : [el('p', { class: 'small muted', text: 'Nothing completed yet — mark a Bani ਸੰਪੂਰਨ (complete) while reading and it shows up here.' })];
    const section = el('div', { class: 'completed-banis' }, [
      catDetails('home-completed', '🙏', 'ਸੰਪੂਰਨ ਬਾਣੀਆਂ · Completed', [windowSelect, el('div', { class: 'card' }, rows)], false),
    ]);
    view.append(section);
  }

  function renderBookmarksArchive() {
    const old = view.querySelector('.bookmarks-archive');
    if (old) old.remove();
    const archived = [];
    for (const b of BANIS) {
      const entry = latestEntryFor(b.slug);
      if (entry && entry.stage === 'archived') archived.push([b, entry]);
    }
    archived.sort((a, c) => c[1].end - a[1].end);
    const rows = archived.length
      ? archived.map(([b, entry]) => {
          const pct = Math.round((entry.i / Math.max(1, lineCountOf(b) - 1)) * 100);
          return el('div', { class: 'row', style: 'margin: 0.5rem 0' }, [
            el('div', { style: 'flex:1' }, [
              el('div', { text: b.name }),
              el('div', { class: 'small muted', text: pct + '% · removed ' + timeAgo(entry.end) }),
            ]),
            el('button', {
              class: 'primary small',
              text: 'Restore',
              onclick: () => {
                entry.stage = 'progress';
                save();
                renderContinueReading();
                renderCompletedBanis();
                renderBookmarksArchive();
              },
            }),
            el('button', {
              class: 'quiet small',
              text: 'Unread',
              'aria-label': 'Mark ' + b.name + ' unread',
              onclick: () => {
                if (markUnread(b.slug)) render();
              },
            }),
          ]);
        })
      : [el('p', { class: 'small muted', text: 'Nothing archived yet — entries you remove from Continue Reading or Completed appear here.' })];
    const section = el('div', { class: 'bookmarks-archive' }, [catDetails('home-archive', '🗄', 'Bookmarks Archive', el('div', { class: 'card' }, rows), false)]);
    view.append(section);
  }

  /** Per-line bookmarks (double-tap a line while reading). Jumps straight to the line. */
  function renderMyBookmarks() {
    const old = view.querySelector('.my-bookmarks');
    if (old) old.remove();
    const marks = [];
    for (const [id, m] of Object.entries(S.bookmarks)) {
      const sep = id.lastIndexOf(':');
      const slug = id.slice(0, sep);
      const i = +id.slice(sep + 1);
      const bani = BY_SLUG.get(slug);
      if (!bani || !isFinite(i)) continue;
      marks.push({ id, m, bani, i });
    }
    marks.sort((a, c) => c.m.at - a.m.at);
    const rows = marks.length
      ? marks.slice(0, 200).map(({ id, m, bani, i }) => {
          const ang = flatAt(bani.angMap, i);
          const att = ang != null ? ' · ਅੰਗ ' + paNumber(ang) : '';
          return el('div', { class: 'row', style: 'margin: 0.5rem 0' }, [
            el(
              'button',
              {
                class: 'quiet',
                style: 'text-align:left;flex:1',
                onclick: () => go({ tab: 'read', slugs: [bani.slug], key: bani.slug, title: bani.name, jump: i }),
              },
              [
                el('div', { lang: 'pa', class: 'bk-snippet', text: m.text }),
                el('div', { class: 'small muted', text: bani.name + att + ' · ' + timeAgo(m.at) }),
              ],
            ),
            el('button', {
              class: 'quiet hit',
              text: '✕',
              'aria-label': 'Remove this bookmark',
              onclick: () => {
                delete S.bookmarks[id];
                save();
                renderMyBookmarks();
              },
            }),
          ]);
        })
      : [el('p', { class: 'small muted', text: 'Nothing bookmarked yet — double-tap any line while reading to save it here.' })];
    const section = el('div', { class: 'my-bookmarks' }, [
      catDetails('home-marks', '📌', 'My Bookmarks' + (marks.length ? ' · ' + marks.length : ''), el('div', { class: 'card' }, rows)),
    ]);
    view.append(section);
  }

  function renderContinueReading() {
    const inProgress = [];
    for (const b of BANIS) {
      const entry = latestEntryFor(b.slug);
      if (entry && entry.stage === 'progress') inProgress.push([b, entry]);
    }
    inProgress.sort((a, c) => c[1].end - a[1].end);
    const old = view.querySelector('.continue-reading');
    if (old) old.remove();
    if (!inProgress.length) return;
    const rows = inProgress.map(([bani, entry]) => {
      const pct = progressFor(bani.slug);
      return el('div', { class: 'row', style: 'margin: 0.5rem 0' }, [
        el(
          'button',
          {
            class: 'quiet',
            style: 'text-align:left;flex:1',
            onclick: () => go({ tab: 'read', slugs: [bani.slug], key: bani.slug, title: bani.name }),
          },
          [el('div', { text: bani.name }), el('div', { class: 'small muted', text: pct + '% · ' + timeAgo(entry.end) })],
        ),
        el('button', {
          class: 'quiet small',
          text: 'Unread',
          'aria-label': 'Mark ' + bani.name + ' unread',
          onclick: () => {
            if (markUnread(bani.slug)) render();
          },
        }),
        el('button', {
          class: 'quiet hit',
          text: '✕',
          'aria-label': 'Remove ' + bani.name + ' from Continue Reading',
          onclick: () => {
            entry.stage = 'archived';
            save();
            renderContinueReading();
            renderBookmarksArchive();
          },
        }),
      ]);
    });
    const section = el('div', { class: 'continue-reading' }, [catDetails('home-continue', '📖', 'Continue Reading', el('div', { class: 'card' }, rows))]);
    const hero = view.querySelector('.home-hero');
    view.insertBefore(section, hero ? hero.nextSibling : null);
  }
  function draw(filter) {
    holder.replaceChildren();
    const scope = S.searchScope;
    const favs = BANIS.filter((b) => S.favourites.includes(b.slug));
    const groups = new Map();
    for (const b of BANIS) {
      if (scope && b.granthSlug !== scope) continue;
      if (filter && !(b.name.toLowerCase().includes(filter) || b.slug.includes(filter))) continue;
      groups.set(b.granth, [...(groups.get(b.granth) ?? []), b]);
    }
    if (!filter && !scope) {
      const nitnem = NITNEM.map((s) => BY_SLUG.get(s)).filter(Boolean);
      if (nitnem.length) holder.append(group('home-nitnem', 'ਨਿਤਨੇਮ ਬਾਣੀਆਂ · Nitnem Baniya', nitnem, true));
    }
    if (favs.length && !filter) holder.append(group('home-favs', '★ Bookmarked (Favourites)', favs.filter((b) => !scope || b.granthSlug === scope)));
    for (const [g, items] of groups) holder.append(group('home-granth-' + g, g, items));
    if (!groups.size) holder.append(el('p', { class: 'muted', text: 'Nothing matches.' }));

    // Go-to-Ang: a plain number (or "ang 219", "panna 40") offers a jump
    // straight into whichever loaded Granths carry that Ang.
    const angMatch = filter.match(GO_TO_ANG_RE);
    const angRequest = angMatch ? +(angMatch[1] ?? angMatch[2]) : null;

    // Full-text results only once the query is meaningfully specific -
    // this is separate from the name filter above, which always runs.
    // A pure/numbered Ang query skips the (useless and expensive) text scan.
    if (!angRequest && filter.length >= 2) {
      const hits = searchLines(filter, 60, scope);
      // A Latin-only query that produced nothing is offered as phonetic
      // Gurmukhi ("vahiguru" → "ਵਾਹਿਗੁਰੂ") so English typing still finds
      // Gurbani.
      const phon = hits.length ? null : /^[a-z\s]+$/i.test(filter) ? phoneticQuery(filter) : null;
      const phonHits = phon ? searchLines(phon.gurmukhi, 60, scope) : [];
      const resultSections = [];
      if (hits.length)
        resultSections.push({ title: 'Matching lines' + (phon ? '' : ''), rows: hits, note: null });
      if (phonHits.length)
        resultSections.push({
          title: 'Phonetic matches',
          rows: phonHits,
          note: 'Typed "' + filter.trim() + '" — matching "' + phon.gurmukhi + '"',
        });
      for (const rs of resultSections) {
        holder.append(
          el('section', {}, [
            el('h2', { class: 'section', text: rs.title }),
            rs.note ? el('p', { class: 'small muted', style: 'margin:.1rem 0 .4rem', text: rs.note }) : null,
            el(
              'ul',
              { class: 'list' },
              rs.rows.map((h) => {
                const ang = flatAt(h.bani.angMap, h.lineIndex);
                const att = ang != null ? ' · ਅੰਗ ' + paNumber(ang) : '';
                return el('li', {}, [
                  el(
                    'button',
                    {
                      class: 'quiet',
                      style: 'text-align:left;flex:1',
                      onclick: () =>
                        go({
                          tab: 'read',
                          slugs: [h.bani.slug],
                          key: h.bani.slug,
                          title: h.bani.name,
                          jump: h.lineIndex,
                        }),
                    },
                    [
                      el('div', { lang: 'pa', text: h.text }),
                      el('div', { class: 'small muted', text: h.bani.name + att }),
                    ],
                  ),
                ]);
              }),
            ),
          ]),
        );
      }
      if (hits.length || phonHits.length)
        holder.append(
          el('p', {
            class: 'small muted',
            style: 'margin:.5rem 0 0',
            text: 'Every result cites its Ang — from a single verified edition.',
          }),
        );
    } else if (angRequest) {
      const jumps = [];
      for (const b of BANIS) {
        if (b.granthSlug !== 'granth-sahib-ji' || !b.angMap) continue;
        const idx = angToFirstIndex(b.angMap, angRequest);
        if (idx == null || idx >= lineCountOf(b)) continue;
        jumps.push({ bani: b, lineIndex: idx, total: lineCountOf(b) });
      }
      if (jumps.length) {
        holder.prepend(
          el('section', {}, [
            el('h2', { class: 'section', text: paNumber(angRequest) + ' · Ang ' + angRequest }),
            el(
              'div',
              { class: 'nav-chips' },
              jumps.map((j) =>
                el(
                  'button',
                  {
                    class: 'nav-chip quiet',
                    onclick: () =>
                      go({ tab: 'read', slugs: [j.bani.slug], key: j.bani.slug, title: j.bani.name, jump: j.lineIndex }),
                  },
                  [
                    el('span', { text: j.bani.honorific || j.bani.name }),
                    el('span', { class: 'small muted', text: 'ਅੰਗ ' + paNumber(angRequest) + ' · ' + j.total + ' lines' }),
                  ],
                ),
              ),
            ),
          ]),
        );
      }
    }
  }
  function group(id, name, items, readAll) {
    return catDetails(id, '📚', name, [
      readAll
        ? el('div', { class: 'row', style: 'margin-bottom:.4rem' }, [
            el('span', { class: 'small muted', text: 'Read all seven in order' }),
            el('div', { class: 'grow' }),
            el('button', {
              class: 'primary',
              text: 'Read Nitnem',
              onclick: () =>
                go({
                  tab: 'read',
                  slugs: items.map((b) => b.slug),
                  key: 'nitnem',
                  title: 'ਨਿਤਨੇਮ · Nitnem',
                }),
            }),
          ])
        : null,
      el(
        'ul',
        { class: 'list' },
        items.map((b) => {
          const pct = progressFor(b.slug);
          return el('li', {}, [
            el('button', {
              class: 'quiet hit',
              text: S.favourites.includes(b.slug) ? '★' : '☆',
              'aria-label': 'Favourite ' + b.name,
              onclick: () => {
                S.favourites = S.favourites.includes(b.slug)
                  ? S.favourites.filter((s) => s !== b.slug)
                  : [...S.favourites, b.slug];
                save();
                render();
              },
            }),
            el(
              'button',
              {
                class: 'quiet',
                style: 'text-align:left;flex:1',
                onclick: () => go({ tab: 'read', slugs: [b.slug], key: b.slug, title: b.name }),
              },
              [
                el('div', { text: b.name }),
                el('div', {
                  class: 'small muted',
                  text: lineCountOf(b) + ' lines · ' + b.state.toLowerCase() + (pct !== null ? ' · ' + pct + '% read' : ''),
                }),
              ],
            ),
            pct !== null
              ? el('button', {
                  class: 'quiet hit',
                  text: '↺',
                  'aria-label': 'Mark ' + b.name + ' unread',
                  onclick: () => {
                    if (markUnread(b.slug)) render();
                  },
                })
              : null,
          ]);
        }),
      ),
    ]);
  }
}

// ------------------------------------------------------------ settings
/** The settings page, and the same controls in the panel that floats over the text. */
function renderSettingsPage() {
  titleEl.textContent = 'Settings';
  buildSettings(view, () => {
    save();
    render();
  });
}

function buildSettings(view, rerender) {
  // ── helpers ────────────────────────────────────────────
  const num = (get, set, step, min, max, fmt) => {
    const out = el('span', { text: fmt(get()) });
    return el('div', { class: 'row' }, [
      out,
      el('button', {
        class: 'hit',
        text: '−',
        'aria-label': 'Decrease',
        onclick: () => {
          set(Math.max(min, +(get() - step).toFixed(2)));
          out.textContent = fmt(get());
          save();
        },
      }),
      el('button', {
        class: 'hit',
        text: '+',
        'aria-label': 'Increase',
        onclick: () => {
          set(Math.min(max, +(get() + step).toFixed(2)));
          out.textContent = fmt(get());
          save();
        },
      }),
    ]);
  };
  const sel = (value, options, onchange) =>
    el(
      'select',
      {
        onchange: (e) => {
          onchange(e.target.value);
          rerender();
        },
      },
      options.map(([v, t]) => el('option', { value: v, text: t, selected: v === value })),
    );
  // setting row with optional leading icon
  const srow = (icon, label, control, desc) =>
    el('div', { class: 'setting' }, [
      el('span', { class: 'setting-icon', 'aria-hidden': 'true', text: icon }),
      el('label', {}, [document.createTextNode(label), desc ? el('span', { class: 'desc', text: desc }) : null]),
      control,
    ]);
  const toggle = (label, icon, key, desc) =>
    srow(
      icon,
      label,
      el('button', {
        class: 'sw',
        role: 'switch',
        'aria-checked': String(!!S[key]),
        'aria-label': label,
        onclick: (ev) => {
          S[key] = !S[key];
          ev.currentTarget.setAttribute('aria-checked', String(S[key]));
          rerender();
        },
      }),
      desc,
    );

  // ── 🖐 READING BEHAVIOUR (interactivity) ─────────────────────────
  const readingBehaviour = el(
    'div',
    { class: 'card' },
    [
      toggle('Larivaar', 'ਲ', 'larivaar', 'Continuous Gurmukhi — no spaces between words'),
      toggle('Larivaar Assist', '🌈', 'larivaarAssist', 'Colour alternate words so the eye can separate them'),
      toggle('Paragraph Mode', '¶', 'paragraph', 'Group lines into blocks rather than one line each'),
      toggle('Continuous Reading', '📜', 'continuous', 'Hide headings for undisturbed paath'),
      toggle('Section Titles', '#', 'showTitles', 'Section/Raag headings inside a Bani'),
    ].filter(Boolean),
  );

  // ── ∼ VISHRAAM ─────────────────────────────────────────
  const vishKindRow = (kind, label) =>
    el('label', { class: 'row', style: 'gap:.4rem;font-size:.85rem' }, [
      el('input', {
        type: 'checkbox',
        checked: S.vishraamKinds[kind] !== false,
        onchange: (e) => {
          S.vishraamKinds = { ...S.vishraamKinds, [kind]: e.target.checked };
          save();
        },
      }),
      document.createTextNode(label),
    ]);
  const vishraam = el(
    'div',
    { class: 'card' },
    [
      toggle('Vishraam Marks', '∼', 'vishraam', 'Pause marks from the source — never added to the text'),
      S.vishraam
        ? srow(
            '≋',
            'Vishraam Style',
            sel(
              S.vishraamStyle,
              [
                ['colored', 'Coloured'],
                ['underline', 'Underlined'],
                ['spaced', 'Spaced'],
              ],
              (v) => (S.vishraamStyle = v),
            ),
          )
        : null,
      S.vishraam
        ? el('div', { class: 'setting' }, [
            el('span', { class: 'setting-icon', 'aria-hidden': 'true', text: '☰' }),
            el('label', {}, document.createTextNode('Show by severity')),
            el('div', { class: 'row', style: 'gap:.75rem;flex-wrap:wrap' }, [
              vishKindRow(2, 'Long'),
              vishKindRow(1, 'Medium'),
              vishKindRow(0, 'Short'),
            ]),
          ])
        : null,
    ].filter(Boolean),
  );

  // ── Aa TYPOGRAPHY ──────────────────────────────────────
  const typography = el('div', { class: 'card' }, [
    el('p', {
      class: 'text',
      style: 'margin:.5rem 0;font-size:calc(var(--size)*.75)',
      text: 'ੰ ਸ੍ਰੀ ਵਾਹਿਗੁਰੂ ਜੀ ਕੀ ਫਤਿਹ',
    }),
    srow('📐', 'Text size', num(() => S.size, (v) => (S.size = v), 1, 14, 72, (v) => v + ' px')),
    srow(
      '↕',
      'Line spacing',
      el('div', { class: 'row' }, [
        num(() => S.lh, (v) => (S.lh = v), 0.1, 1, 4, (v) => v.toFixed(1)),
        el(
          'div',
          { class: 'wpm-presets' },
          [
            ['Compact', 1.4],
            ['Normal', 1.8],
            ['Airy', 2.2],
            ['Open', 2.8],
          ].map(([t, v]) =>
            el('button', {
              text: t,
              class: S.lh === v ? 'primary' : '',
              onclick: () => {
                S.lh = v;
                rerender();
              },
            }),
          ),
        ),
      ]),
    ),
    srow(
      '🔤',
      'Font',
      sel(S.font, FONTS, (v) => (S.font = v)),
      'Only fonts installed on this device',
    ),
    srow(
      'B',
      'Weight',
      sel(
        String(S.weight),
        [
          ['400', 'Normal'],
          ['600', 'Medium'],
          ['700', 'Bold'],
        ],
        (v) => (S.weight = +v),
      ),
    ),
    srow(
      '≡',
      'Alignment',
      sel(
        S.align,
        [
          ['center', 'Centre'],
          ['start', 'Start'],
          ['justify', 'Justify'],
        ],
        (v) => (S.align = v),
      ),
    ),
  ]);

  // ── 🎨 APPEARANCE & COLOURS ──────────────────────────────────
  const themes = el(
    'div',
    { class: 'row', style: 'justify-content:center;gap:.75rem;margin:.5rem 0' },
    [
      ['system', 'System', '#888'],
      ['light', 'Light', '#eceae4'],
      ['dark', 'Dark', '#141414'],
      ['sepia', 'Sepia', '#efe6d4'],
      ['nirmala', 'Nirmala', '#fdeee9'],
      ['nihung', 'Nihung', '#0a0a1a'],
    ].map(([v, t, bg]) =>
      el(
        'button',
        {
          class: 'quiet',
          style: 'display:grid;justify-items:center;gap:.3rem',
          'aria-pressed': String(S.theme === v),
          onclick: () => {
            S.theme = v;
            S.colors = {};
            rerender();
          },
        },
        [
          el('span', {
            style:
              'width:2.8rem;height:2.8rem;border-radius:50%;border:2.5px solid ' +
              (S.theme === v ? 'var(--accent)' : 'var(--border)') +
              ';background:' +
              bg,
          }),
          el('span', { class: 'small', text: t }),
        ],
      ),
    ),
  );
  const colours = el(
    'div',
    { class: 'card' },
    COLOR_VARS.map(([k, label]) =>
      srow(
        '💧',
        label,
        el('input', {
          type: 'color',
          class: 'swatch',
          value: S.colors[k] ?? currentVar('--' + k),
          oninput: (e) => {
            S.colors[k] = e.target.value;
            save();
          },
        }),
      ),
    ),
  );
  const appearance = el('div', {}, [
    themes,
    colours,
    el('button', {
      class: 'quiet small',
      text: '↺ Reset custom colours',
      onclick: () => {
        S.colors = {};
        rerender();
      },
    }),
  ]);

  // ── ⚡ SPEED & SCROLLING ──────────────────────────────
  const speedSliderRow = (() => {
    const out = el('span', {
      class: 'small muted',
      style: 'white-space:nowrap',
      text: S.speed + ' / 100',
    });
    const slider = el('input', {
      type: 'range',
      min: SPEED_MIN,
      max: SPEED_MAX,
      step: 1,
      value: S.speed,
      'aria-label': 'Reading speed on a scale of 0 to 100, where 100 is the fastest and 0 is stopped',
      style: 'flex:1;min-width:0',
      oninput: (e) => {
        S.speed = clampSpeed(Number(e.target.value));
        out.textContent = S.speed + ' / 100';
        save();
      },
    });
    return el('div', { class: 'row', style: 'gap:.5rem;align-items:center;flex:1;min-width:0' }, [slider, out]);
  })();
  const speedScroll = el('div', { class: 'card' }, [
    el('p', {
      class: 'small muted',
      style: 'margin:.2rem 0 .5rem',
      text: 'Speed is shown on a simple 0–100 scale (100 is the fastest, 0 means stopped). It auto-adjusts for font size, so a chosen speed reads at the same pace at any text size.',
    }),
    srow(
      '⚡',
      'Reading speed',
      el('div', { style: 'display:grid;gap:.55rem' }, [
        speedSliderRow,
        el('div', { class: 'wpm-presets' }, [
          [10, 'Meditative'],
          [18, 'Slow'],
          [30, 'Normal'],
          [45, 'Fast'],
          [100, 'Maximum'],
        ].map(([v, t]) =>
          el('button', {
            text: t + ' ' + v,
            class: S.speed === v ? 'primary' : '',
            onclick: () => {
              S.speed = v;
              rerender();
            },
          }),
        )),
        num(() => S.speed, (v) => (S.speed = v), SPEED_STEP, SPEED_MIN, SPEED_MAX, (v) => v + ' / 100'),
      ]),
    ),
    toggle('Auto-start on open', '▶', 'autoScrollOnOpen', 'Start auto-scroll immediately when a Bani opens or resumes'),
    toggle('Keep Screen Awake', '☀', 'keepAwake', 'Prevents screen dimming while reading'),
  ]);

  // ── ℹ ABOUT ───────────────────────────────────────────
  const total = BANIS.reduce((n, b) => n + lineCountOf(b), 0);
  const about = el('div', { class: 'card small muted' }, [
    el('p', { text: 'Pothi Sahib — single-file build. ' + BANIS.length + ' Banian, ' + total + ' lines.' }),
    el('p', { text: 'Built ' + new Date(DATA.builtAt).toLocaleString() + '.' }),
    el('p', {
      text:
        'Text adopted from: ' +
        [...new Set(BANIS.map((b) => b.source?.name).filter(Boolean))].join(', ') +
        '. Where a Bani is marked PROVISIONAL, it has been adopted from a source and not yet reviewed line by line against printed editions — see Changelog below for what has already been checked.',
    }),
    el('p', { text: [...new Set(BANIS.map((b) => b.source?.attribution).filter(Boolean))].join(' ') }),
    el('p', { text: 'Nothing here is sent anywhere. No account, no analytics, no network requests.' }),
  ]);

  // ── 💾 BACKUP & RESTORE ────────────────────────────────
  const backup = el('div', { class: 'card' }, [
    el('p', {
      class: 'small muted',
      text: "Saves your settings, favourites, bookmarks, flags and reading positions to a file you can restore on any device. No Gurbani text is included — it's already in this file.",
    }),
    el('div', { class: 'row', style: 'margin-top:.5rem' }, [
      el('button', { class: 'primary', text: '📤 Export', onclick: exportBackup }),
      el('button', { text: '📥 Import', onclick: importBackup }),
      el('div', { class: 'grow' }),
      el('button', {
        class: 'quiet',
        text: '↺ Reset settings',
        onclick: async () => {
          if (
            !(await confirmBox({
              title: 'Reset settings?',
              body: el('p', { text: 'Reset all settings to defaults? Your Pothis, bookmarks, flags and reading history are kept.' }),
              okText: 'Reset settings',
            }))
          )
            return;
          const keep = {
            favourites: S.favourites,
            pothis: S.pothis,
            bookmarks: S.bookmarks,
            sehaj: S.sehaj,
            flags: S.flags,
            baniLog: S.baniLog,
          };
          S = { ...DEFAULTS, ...keep };
          rerender();
        },
      }),
    ]),
  ]);

  // ── ⏰ REMINDERS ─────────────────────────────────────────
  // Gentle in-app reminders. They surface only while the app is open (a
  // <dialog>, exactly like every other prompt), need no notifications
  // permission, and are never sent anywhere. OS-level background
  // notifications are deliberately out of reach for a single offline
  // file - nothing here requests a permission the host can't honour.
  const remindersCard = el('div', { class: 'card' }, [
    el('p', {
      class: 'small muted',
      style: 'margin:.2rem 0 .5rem',
      text: 'Politely reminds you while the app is open — no notifications permission needed, nothing is sent anywhere. Pick a Bani (or the five morning Nitnem Banian) and a time.',
    }),
    S.reminders.map((r) =>
      el('div', { class: 'setting', style: 'display:block' }, [
        el('div', { class: 'row', style: 'gap:.5rem' }, [
          el('strong', { style: 'flex:1', text: r.label }),
          el('button', {
            class: 'quiet hit',
            text: '✕',
            'aria-label': 'Delete reminder ' + r.label,
            onclick: () => {
              S.reminders = S.reminders.filter((x) => x.id !== r.id);
              save();
              rerender();
            },
          }),
        ]),
        el('div', { class: 'small muted', text: reminderScheduleText(r) }),
      ]),
    ),
    el('button', {
      class: 'primary small',
      text: '＋ Add reminder',
      style: 'margin-top:.5rem',
      onclick: () => openReminderDialog(),
    }),
  ]);

  function openReminderDialog() {
    const typeSel = el(
      'select',
      { 'aria-label': 'Reminder type', onchange: (e) => updateVisibility() },
      [
        el('option', { value: 'nitnem-morning', text: NITNEM_MORNING_LABEL }),
        el('option', { value: 'bani', text: 'A single Bani' }),
      ],
    );
    const baniSel = el(
      'select',
      { 'aria-label': 'Bani', onchange: (e) => (labelIn.value = e.target.selectedOptions[0].textContent) },
      BANIS.map((b) => el('option', { value: b.slug, text: b.name })),
    );
    const labelIn = el('input', {
      type: 'text',
      value: NITNEM_MORNING_LABEL,
      placeholder: 'Reminder name',
      style: 'width:100%;font:inherit',
      'aria-label': 'Reminder name',
    });
    const timeIn = el('input', { type: 'time', value: '06:00', style: 'font:inherit', 'aria-label': 'Time' });
    const recurSel = el(
      'select',
      { 'aria-label': 'Repeat', onchange: (e) => updateVisibility() },
      [
        el('option', { value: 'daily', text: 'Every day' }),
        el('option', { value: 'weekly', text: 'On chosen weekdays' }),
      ],
    );
    const dayBoxes = [0, 1, 2, 3, 4, 5, 6].map((d) =>
      el('label', { class: 'row', style: 'gap:.3rem;font-size:.85rem' }, [
        el('input', { type: 'checkbox', value: String(d), checked: d !== 0 && d !== 6 }),
        document.createTextNode(REMINDER_WEEKDAYS[d]),
      ]),
    );
    const daysWrap = el('div', { class: 'row', style: 'gap:.75rem;flex-wrap:wrap;margin-top:.3rem' }, dayBoxes);
    const baniRow = el('div', {});
    const daysRow = el('div', {});
    baniRow.append(el('div', { class: 'small muted', style: 'margin:.3rem 0', text: 'Bani' }), baniSel);
    daysRow.append(el('div', { class: 'small muted', style: 'margin:.3rem 0', text: 'Days' }), daysWrap);
    const updateVisibility = () => {
      baniRow.hidden = typeSel.value !== 'bani';
      daysRow.hidden = recurSel.value !== 'weekly';
      if (typeSel.value === 'nitnem-morning') labelIn.value = NITNEM_MORNING_LABEL;
      else if (!labelIn.value || labelIn.value === NITNEM_MORNING_LABEL) labelIn.value = baniSel.selectedOptions[0]?.textContent ?? '';
    };
    const dlg = el('dialog', { class: 'settings-panel' }, [
      el('div', { class: 'panel-head' }, [
        el('strong', { text: 'Add reminder' }),
        el('div', { class: 'grow' }),
        el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
      ]),
      el('div', { class: 'panel-body small' }, [
        el('div', { class: 'small muted', style: 'margin:.2rem 0', text: 'What to read' }),
        typeSel,
        baniRow,
        el('div', { class: 'small muted', style: 'margin:.6rem 0 .2rem', text: 'When' }),
        el('div', { class: 'row', style: 'gap:.5rem' }, [timeIn, recurSel]),
        daysRow,
        el('label', { class: 'row', style: 'margin-top:.6rem;gap:.5rem;align-items:center' }, [
          el('span', { class: 'small muted', text: 'Name' }),
          labelIn,
        ]),
        el('div', { class: 'row', style: 'justify-content:flex-end;gap:.5rem;margin-top:.6rem' }, [
          el('button', { text: 'Cancel', onclick: () => dlg.close() }),
          el('button', {
            class: 'primary',
            text: 'Save reminder',
            onclick: () => {
              const time = timeIn.value;
              const daysRaw = dayBoxes.filter((b) => b.querySelector('input').checked).map((b) => +b.querySelector('input').value);
              const label = (labelIn.value || '').trim();
              if (!time || !label) {
                announce('Give the reminder a name and a time first');
                return;
              }
              const finalDays = recurSel.value === 'weekly' ? daysRaw : 'daily';
              if (finalDays !== 'daily' && finalDays.length === 0) {
                announce('Pick at least one weekday');
                return;
              }
              S.reminders.push({
                id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
                label,
                mode: typeSel.value,
                slug: typeSel.value === 'bani' ? baniSel.value : null,
                time,
                days: finalDays,
              });
              save();
              dlg.close();
              rerender();
              announce('Reminder added');
            },
          }),
        ]),
      ]),
    ]);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    updateVisibility();
  }

  view.append(
    catDetails('set-typography', 'Aa', 'Typography', typography, true),
    catDetails('set-behaviour', '🖐', 'Reading Behaviour', readingBehaviour, true),
    catDetails('set-vishraam', '∼', 'Vishraam', vishraam, true),
    catDetails('set-appearance', '🎨', 'Appearance & Colours', appearance, true),
    catDetails('set-speed', '⚡', 'Speed & Scrolling', speedScroll, false),
    catDetails('set-reminders', '⏰', 'Reminders', remindersCard, false),
    catDetails('set-flags', '🚩', 'My Flags', buildFlagsCard(rerender), false),
    catDetails('set-changelog', '🕘', 'Changelog', buildChangelogCard(), false),
    catDetails('set-backup', '💾', 'Backup & Restore', backup, false),
    catDetails('set-about', 'ℹ️', 'About', about, false),
  );
}
const currentVar = (name) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  return '#000000';
};

// ── changelog: app updates first, then every Bani's history, newest first ──
const APP_CHANGES = [
  {
    date: '2026-09-19',
    title: 'Rehat Maryada added',
    body: 'The English Sikh Rehat Maryada (SGPC Dharam Parchar Committee edition) is now available under a new Rehat Maryada collection, organised by its thirteen chapters. Marked PROVISIONAL while it awaits a line-by-line comparison against the printed booklet.',
  },
  {
    date: '2026-09-19',
    title: 'New app mark',
    body: 'The reader, the share card, the browser tab icon and the Android launcher now carry the Waheguru (Ik Onkar) emblem instead of the open-book mark.',
  },
  {
    date: '2026-09-19',
    title: 'Security hardening',
    body: 'Reader flags can now be exported and resolved in the review tool; app messages no longer rely on the browser alert()/confirm() (they were silently ignored inside the Android WebView); the Android build stops backing up your private flags and notes; the hosted copy now sends security headers; restoring a backup re-validates every field and caps the sizes of restored items.',
  },
  {
    date: '2026-09-19',
    title: 'Go-to-Ang, ranked search, My Bookmarks',
    body: 'Open any Ang of the complete Granths by typing its number; full-text search is now ranked (exact line first, then heavy phrase matches, then substrings/tokens) with Granth order used as a tiebreak; bookmarked lines have their own "My Bookmarks" list on Home.',
  },
  {
    date: '2026-09-19',
    title: 'Manifest editor',
    body: 'tools/editor.html can now edit the manuscript: choose which compiled Bani fills each Granth of the two complete scriptures, reorder the Granth list in the manifest, and save a new manifest.json — validated exactly as the build would, before download.',
  },
];
function buildChangelogCard() {
  const appSection = el('div', { class: 'card small', style: 'margin-bottom:.6rem' }, [
    el('div', { class: 'small muted', style: 'margin-bottom:.4rem', text: 'App — recent changes' }),
    ...APP_CHANGES.map((c) =>
      el('div', { class: 'setting', style: 'display:block' }, [
        el('div', {}, [el('strong', { text: c.title }), el('span', { class: 'muted', text: '  ·  ' + c.date })]),
        el('div', { class: 'muted', text: c.body }),
      ]),
    ),
  ]);
  const entries = [];
  for (const b of BANIS) {
    for (const h of b.history || []) entries.push({ ...h, bani: b.name });
  }
  entries.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
  if (!entries.length) {
    return el('div', {}, [appSection, el('div', { class: 'card small muted' }, [el('p', { text: 'No Bani history recorded yet.' })])]);
  }
  const baniSection = el(
    'div',
    { class: 'card small' },
    entries.slice(0, 60).map((h) =>
      el('div', { class: 'setting', style: 'display:block' }, [
        el('div', {}, [
          el('strong', { text: h.bani }),
          el('span', { class: 'muted', text: '  ·  v' + h.versionNo + '  ·  ' + h.date }),
        ]),
        el('div', { class: 'muted', text: h.note }),
      ]),
    ),
  );
  return el('div', {}, [appSection, baniSection]);
}

// ── review flags: notes a reader left on specific lines ────────────
function buildFlagsCard(rerender) {
  if (!S.flags.length)
    return el('div', { class: 'card small muted' }, [
      el('p', {
        text: "No flags yet. While reading, long-press (or right-click) a line and choose Add note, or press F for the line currently in view. Once you have some, you can copy them as text or export them for review in tools/review.html.",
      }),
    ]);
  const list = el(
    'div',
    { class: 'card small' },
    S.flags
      .slice()
      .reverse()
      .map((f) => {
        const bani = BY_SLUG.get(f.slug);
        return el('div', { class: 'setting', style: 'display:block' }, [
          el('div', {}, [
            el('strong', { text: bani ? bani.name : f.slug }),
            el('span', { class: 'muted', text: '  ·  line ' + (f.lineIndex + 1) + '  ·  ' + new Date(f.at).toLocaleDateString() }),
          ]),
          el('div', { lang: 'pa', class: 'muted', text: f.text }),
          el('div', { text: f.note }),
          el('button', {
            class: 'quiet small',
            text: 'Remove',
            onclick: () => {
              S.flags = S.flags.filter((x) => x !== f);
              save();
              rerender();
            },
          }),
        ]);
      }),
  );
  const toolbar = el('div', { style: 'margin-bottom:.5rem' }, [
    el('div', { class: 'row' }, [
      el('button', {
        text: '📋 Copy all as text',
        onclick: async () => {
          const text = S.flags
            .map((f) => {
              const bani = BY_SLUG.get(f.slug);
              return `${bani ? bani.name : f.slug} — line ${f.lineIndex + 1}\n${f.text}\nNote: ${f.note}\n`;
            })
            .join('\n');
          try {
            await navigator.clipboard.writeText(text);
            announce('Flags copied to clipboard');
          } catch {
            dialogBox({ title: 'My Flags', body: el('pre', { class: 'dialog-pre', text }), okText: 'Close' });
          }
        },
      }),
      el('button', {
        text: '📤 Export for review',
        onclick: () => {
          const payload = {
            format: 'pothi-sahib-review/1',
            savedAt: new Date().toISOString(),
            flags: S.flags.map((f) => {
              const bani = BY_SLUG.get(f.slug);
              return {
                slug: f.slug,
                granthSlug: bani ? bani.granthSlug : '',
                lineIndex: f.lineIndex,
                text: f.text,
                note: f.note,
                at: f.at,
              };
            }),
          };
          const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
          const a = el('a', { href: url, download: 'pothi-sahib-flags.json' });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        },
      }),
    ]),
    el('p', {
      class: 'small muted',
      style: 'margin:.4rem 0 0',
      text: 'Each flag records the line as it was when you added it. Hand the exported file to whoever runs the next audit — open it in tools/review.html to approve, fix or reject every line, and the fixes land back in the app as new history entries.',
    }),
  ]);
  return el('div', {}, [toolbar, list]);
}

function exportBackup() {
  const payload = {
    format: 'pothi-sahib-backup/1',
    savedAt: new Date().toISOString(),
    settings: S,
  };
  // A data: URL (rather than a blob:) so the Android shell's DownloadListener
  // — which receives <a download> clicks as onDownloadStart with the content
  // inlined — can save the file even where blob URLs have no native saver.
  // Desktop browsers download data-URL anchors straight to disk as usual.
  const dataUrl =
    'data:application/json;charset=utf-8;base64,' +
    btoa(unescape(encodeURIComponent(JSON.stringify(payload, null, 2))));
  const a = el('a', { href: dataUrl, download: 'pothi-sahib-backup.json' });
  document.body.append(a);
  a.click();
  a.remove();
}
/**
 * Keep only fields whose type matches the corresponding DEFAULTS entry, so
 * a hand-edited or corrupted backup file can't hand a wrong-shaped value
 * (a string where a number/array/object is expected) to code downstream
 * that assumes the shape - it just falls back to the default for that
 * field instead of restoring it.
 */
function sanitizeSettings(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in obj)) continue;
    const def = DEFAULTS[key];
    const val = obj[key];
    const sameShape = Array.isArray(def) ? Array.isArray(val) : typeof val === typeof def && (typeof def !== 'object' || def === null || !Array.isArray(val));
    if (sameShape) out[key] = val;
  }
  return out;
}

/**
 * A hand-edited or hostile backup is only trusted at the shape level by
 * sanitizeSettings above, so per-item hits (bookmarks, flags) get their own
 * whitelist here: bounded counts, short strings, sane numbers. Sinks are all
 * textContent anyway, but bounding keeps restored data predictable.
 * Accepts both new-style top-level keys and the long-standing "everything
 * lives inside settings" snapshots exported by exportBackup.
 */
const BK_TEXT_MAX = 80;
const FLAG_TEXT_MAX = 80;
const FLAG_NOTE_MAX = 500;
const MAX_BOOKMARKS = 5000;
const MAX_FLAGS = 2000;
function sanitizeBackup(parsed) {
  const out = { settings: {}, bookmarks: {}, flags: [], reminders: [] };
  if (!parsed || typeof parsed !== 'object') return out;
  out.settings = sanitizeSettings(parsed.settings);
  out.reminders = sanitizeReminders(parsed.reminders || parsed.settings?.reminders);
  const bookmarksSrc = Array.isArray(parsed.bookmarks) ? null : parsed.bookmarks || parsed.settings?.bookmarks;
  const flagsSrc = parsed.flags || parsed.settings?.flags;
  if (bookmarksSrc && typeof bookmarksSrc === 'object' && !Array.isArray(bookmarksSrc)) {
    for (const [k, v] of Object.entries(bookmarksSrc)) {
      if (Object.keys(out.bookmarks).length >= MAX_BOOKMARKS) break;
      if (!k.includes(':')) continue;
      if (!v || typeof v !== 'object') continue;
      const at = Number.isFinite(+v.at) ? +v.at : Date.now();
      const text = typeof v.text === 'string' ? v.text.slice(0, BK_TEXT_MAX) : '';
      if (!text) continue;
      out.bookmarks[String(k).slice(0, 80)] = { at, text };
    }
  }
  if (Array.isArray(flagsSrc)) {
    for (const f of flagsSrc) {
      if (out.flags.length >= MAX_FLAGS) break;
      if (!f || typeof f !== 'object') continue;
      const slug = typeof f.slug === 'string' ? f.slug.slice(0, 60) : '';
      if (!slug) continue;
      const lineIndex = Number.isInteger(f.lineIndex) && f.lineIndex >= 0 ? f.lineIndex : 0;
      const text = typeof f.text === 'string' ? f.text.slice(0, FLAG_TEXT_MAX) : '';
      const note = typeof f.note === 'string' ? f.note.slice(0, FLAG_NOTE_MAX) : '';
      const at = Number.isFinite(+f.at) ? +f.at : Date.now();
      out.flags.push({ slug, lineIndex, text, note, at });
    }
  }
  return out;
}
function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== 'pothi-sahib-backup/1') throw new Error('not a Pothi Sahib backup');
      const restored = sanitizeBackup(parsed);
      S = {
        ...DEFAULTS,
        ...restored.settings,
        bookmarks: restored.bookmarks,
        flags: restored.flags,
        reminders: restored.reminders,
        remindersFired: {},
      };
      S.speed = clampSpeed(normalizeSpeed(S.speed));
      save();
      render();
      const nBk = Object.keys(restored.bookmarks).length;
      const nFl = restored.flags.length;
      const nRm = restored.reminders.length;
      dialogBox({
        title: 'Backup restored',
        body: el(
          'p',
          {
            text:
              'Settings, favourites, bookmarks and flags restored' +
              (nBk ? ` — ${nBk} bookmark${nBk === 1 ? '' : 's'}` : '') +
              (nFl ? `, ${nFl} flag${nFl === 1 ? '' : 's'}` : '') +
              (nRm ? `, ${nRm} reminder${nRm === 1 ? '' : 's'}` : '') +
              '.',
          },
        ),
        okText: 'Close',
      });
    } catch (e) {
      dialogBox({ title: 'Could not restore', body: el('p', { text: e.message }), okText: 'Close' });
    }
  });
  input.click();
}

// ---------------------------------------------------------------- read
let scroller = null;
let wakeLock = null;
let wakeLockVideo = null; // muted looping <video> fallback, for when navigator.wakeLock is unavailable (e.g. opened as a file:// page, which isn't a secure context)
let avgWPL = 6; // average words per line; set in renderRead, used in startScroll
/** The reader bar's current-Ang chip, kept at module scope so the progress
 *  observer can update it as the visible line changes. */
let angChipEl = null;
function updateAngChip(bani, lineIndex) {
  if (!angChipEl) return;
  if (!bani || !bani.angMap) {
    angChipEl.textContent = '';
    angChipEl.setAttribute('aria-hidden', 'true');
    return;
  }
  const ang = flatAt(bani.angMap, lineIndex);
  if (ang == null) {
    angChipEl.textContent = '';
    angChipEl.setAttribute('aria-hidden', 'true');
    return;
  }
  angChipEl.textContent = 'ਅੰਗ ' + paNumber(ang);
  angChipEl.title = (bani.honorific || bani.name) + ' · ਅੰਗ ' + ang;
  angChipEl.setAttribute('aria-hidden', 'false');
}
let barVisible = true; // whether the floating reader bar is shown
let currentLine = null; // { bani, lineIndex, text } for the line nearest the top of the viewport - used by the flag button
let readGeneration = 0; // bumped on every renderRead() call so a heavy-Bani background build (see buildLineChunk) can tell it's been superseded and stop

/** Count average words per line across a list of Banis. */
function calcAvgWPL(list) {
  let tw = 0,
    tl = 0;
  for (const b of list) {
    const n = lineCountOf(b);
    const step = n >= HEAVY_BANI_LINES ? Math.max(1, Math.ceil(n / 2000)) : 1;
    for (let i = 0; i < n; i += step) {
      const line = b.lines[i];
      tw += Math.max(1, wordSpans(line).length);
      tl++;
    }
  }
  return tl ? tw / tl : 6;
}

/**
 * Convert words-per-minute to pixels-per-second for the current font size/line-height.
 * This ensures a given WPM feels the same regardless of how large the text is set.
 *   lineHeightPx = fontSize × lineHeightMultiplier
 *   pxPerSec     = lineHeightPx × wpm / (avgWPL × 60)
 */
function wpmToPxPerSec(wpm, awpl) {
  const lineH = S.size * S.lh;
  return (lineH * wpm) / (awpl * 60);
}

// ── windowed rendering for very large Banis (the complete Granths) ──────
// Opening a ~60-70k line Bani used to build every <p> and IntersectionObserver
// registration in one pass. The previous windowed fix moved that work into
// background frames, but still eventually filled the DOM with the whole
// Granth. The heavy path now builds a small window around the reader's
// starting line and extends it only as the person approaches the edges.
const HEAVY_BANI_LINES = 3000;
const HEAVY_WINDOW_MARGIN = 180; // lines built synchronously around the start position
const HEAVY_CHUNK_LINES = 160; // lines added when the reader nears either edge
const HEAVY_EDGE_PX = 2400; // start extending before the reader hits the built edge

/**
 * Build lines [from, to) of one Bani as a standalone DocumentFragment.
 * Section heading / paragraph-grouping state is reseeded fresh at `from`
 * (from bani.lines[from-1]'s section - an O(1) lookup, no scan needed) so
 * every chunk is self-contained and can be built in any order relative to
 * its neighbours. The only cost of that is a purely cosmetic one: a chunk
 * boundary landing inside an unusually long section can start a second,
 * back-to-back paragraph block for what's logically one continuous
 * section when Paragraph Mode is on - never lost, duplicated or
 * misordered content, just an extra visual seam every few hundred lines.
 */
function buildLineChunk(b, from, to, indexOfLine, lastLineEl, io) {
  const frag = document.createDocumentFragment();
  let lastSection = b.lines[from - 1]?.s ?? 0;
  let para = null;
  const showTitles = S.showTitles && !S.continuous && b.sections.length > 1;
  for (let i = from; i < to; i++) {
    const line = b.lines[i];
    const s = line.s ?? 0;
    if (showTitles && s !== lastSection) {
      const sec = b.sections[s];
      const label = sec.name ?? (['BODY', 'BANI_SECTION'].includes(sec.t) ? null : sec.t.toLowerCase() + (sec.l ? ' ' + sec.l : ''));
      if (label) frag.append(el('h2', { class: 'sec', text: label }));
      para = null;
    }
    lastSection = s;
    if (S.paragraph && !para) {
      para = el('div', { class: 'sec-body' });
      frag.append(para);
    }
    const id = b.slug + ':' + i;
    const p = el('p', {
      class: 'line' + (S.bookmarks[id] ? ' bk' : ''),
      id: 'l' + i,
      'data-id': id,
      'data-i': String(i),
      'data-slug': b.slug,
      ondblclick: () => {
        if (S.bookmarks[id]) delete S.bookmarks[id];
        else S.bookmarks[id] = { at: Date.now(), text: line.t.slice(0, 40) };
        save();
        p.classList.toggle('bk');
        announce(S.bookmarks[id] ? 'Bookmark added' : 'Bookmark removed');
      },
    });
    p.append(...renderLine(line));
    (S.paragraph ? para : frag).append(p);
    indexOfLine[i] = p;
    if (io) io.observe(p);
    if (i === b.lines.length - 1) lastLineEl.set(b.slug, p);
  }
  return { frag, firstTopNode: frag.firstChild, lastTopNode: frag.lastChild };
}

function renderRead() {
  readGeneration++;
  const myGeneration = readGeneration;
  const list = route.slugs.map((s) => BY_SLUG.get(s)).filter(Boolean);
  for (const b of list) ensureBaniLines(b); // deferred complete Granths parse only when opened
  avgWPL = calcAvgWPL(list); // update global so startScroll can use it
  titleEl.textContent = route.title;
  const wrap = el('div', { class: 'text', lang: 'pa' });
  let globalIndex = 0;
  const indexOfLine = [];
  // § bani log: one row per Bani per reading arc (a combined Nitnem read
  // tracks each constituent Bani separately, since completion is per-Bani).
  // A row is *reused* across multiple day-to-day sessions of the same
  // unfinished read (only a prior 'completed' row causes a fresh one to
  // start) - see latestEntryFor(). Kept as live object references so the
  // observer below updates .i/.end/.stage in place, no re-searching.
  const sessionLog = new Map(); // slug -> the live baniLog row for this session
  const resumeBySlug = new Map(); // slug -> { i, end } as it was BEFORE this session touched it
  const lastLineEl = new Map(); // Bani slug -> its last <p>, to detect "reached the end"

  // A heavy Bani (currently only the two complete Granths) only ever opens
  // solo, never combined with others (Nitnem and friends are nowhere near
  // this size), so windowing only needs to handle the single-Bani case -
  // see buildLineChunk() above.
  const heavyBani = list.length === 1 && list[0].lines.length >= HEAVY_BANI_LINES ? list[0] : null;
  let targetLineIndex = 0; // heavy path only: start line, resolved up front from data

  // Progress bar - created before the IntersectionObserver below so its
  // callback can reference it regardless of which path (below) fills wrap.
  const prog = el('div', {
    class: 'progress-bar',
    role: 'progressbar',
    'aria-label': 'Reading progress',
    'aria-valuenow': '0',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    style: 'width:0',
  });

  // Track the topmost visible line (for the flag button, progress bar, and
  // this session's baniLog row), and separately check every intersecting
  // line for "has this Bani's last line now been visible" - reciting
  // Gurbani from memory while following/auto-scrolling is completely
  // normal, so reaching the end auto-completes (Sampuran) the same as the
  // button would, not just an explicit tap.
  const io = new IntersectionObserver(
    (obsEntries) => {
      const intersecting = obsEntries.filter((e) => e.isIntersecting);
      const top = intersecting.sort((a, b2) => a.boundingClientRect.top - b2.boundingClientRect.top)[0];
      if (top) {
        const slug = top.target.dataset.slug;
        const bani = BY_SLUG.get(slug);
        const lineIndex = +top.target.dataset.i;
        currentLine = bani ? { bani, lineIndex, text: bani.lines[lineIndex].t } : null;
        updateAngChip(bani, lineIndex);
        // A windowed heavy Bani's indexOfLine is sparse/out-of-order while
        // background chunks are still filling in, so both "where is this
        // line" and "how many lines total" come straight from the data
        // (every line already carries data-i) instead of scanning the array.
        const pct = heavyBani
          ? Math.round((lineIndex / Math.max(1, heavyBani.lines.length - 1)) * 100)
          : Math.round((indexOfLine.indexOf(top.target) / Math.max(1, indexOfLine.length - 1)) * 100);
        prog.style.width = pct + '%';
        prog.setAttribute('aria-valuenow', String(pct));
        const logEntry = sessionLog.get(slug);
        if (logEntry && logEntry.stage === 'progress') {
          logEntry.i = lineIndex;
          logEntry.end = Date.now();
        }
      }
      for (const e of intersecting) {
        const slug = e.target.dataset.slug;
        const logEntry = sessionLog.get(slug);
        if (e.target === lastLineEl.get(slug) && logEntry && logEntry.stage !== 'completed') {
          markSampuran(BY_SLUG.get(slug), sessionLog);
        }
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(S));
      } catch {}
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );

  if (heavyBani) {
    const b = heavyBani;
    let entry = latestEntryFor(b.slug);
    if (entry && entry.stage !== 'completed') {
      resumeBySlug.set(b.slug, { i: entry.i, end: entry.end });
      entry.stage = 'progress'; // reactivate if it had been archived
    } else {
      entry = { slug: b.slug, start: Date.now(), end: Date.now(), stage: 'progress', i: 0 };
      S.baniLog.push(entry);
    }
    sessionLog.set(b.slug, entry);
    if (!S.continuous && b.reviewNotes && b.reviewNotes.length) {
      const details = document.createElement('details');
      details.className = 'review-notes';
      const summary = document.createElement('summary');
      summary.textContent = '⚠ ' + b.reviewNotes.length + ' known review note' + (b.reviewNotes.length > 1 ? 's' : '') + ' for this Bani';
      details.append(summary);
      for (const rn of b.reviewNotes) {
        details.append(el('p', { class: 'small muted', text: 'Line ' + (rn.lineIndex + 1) + ': ' + rn.note }));
      }
      wrap.append(details);
    }

    const total = b.lines.length;
    targetLineIndex = Math.max(0, Math.min(total - 1, route.jump !== undefined ? route.jump : (resumeBySlug.get(b.slug)?.i ?? 0)));
    const winStart = Math.max(0, targetLineIndex - HEAVY_WINDOW_MARGIN);
    const winEnd = Math.min(total, targetLineIndex + HEAVY_WINDOW_MARGIN);

    // Phase A: build just the window around the start line synchronously,
    // so the jump-to-position below still feels instant. More lines are
    // added only when the reader nears the built window's top/bottom edge.
    const initial = buildLineChunk(b, winStart, winEnd, indexOfLine, lastLineEl, io);
    wrap.append(initial.frag);
    let builtFrom = winStart;
    let builtTo = winEnd;
    let backAnchor = initial.firstTopNode; // insertBefore reference for the next backward chunk
    let sampuranAppended = false;
    let heavyBuildRaf = null;

    const appendSampuranButton = () => {
      if (sampuranAppended || builtTo < total) return;
      sampuranAppended = true;
      if (!S.continuous) {
        wrap.append(
          el('div', { class: 'row', style: 'justify-content:center;margin:1rem 0' }, [
            el('button', {
              class: 'quiet sampuran-btn',
              text: '🙏 ਸੰਪੂਰਨ · Mark complete',
              onclick: () => markSampuran(b, sessionLog),
            }),
          ]),
        );
      }
    };

    const extendForward = () => {
      if (builtTo >= total) return false;
      const to = Math.min(total, builtTo + HEAVY_CHUNK_LINES);
      const chunk = buildLineChunk(b, builtTo, to, indexOfLine, lastLineEl, io);
      wrap.append(chunk.frag);
      builtTo = to;
      appendSampuranButton();
      return true;
    };

    const extendBackward = () => {
      if (builtFrom <= 0) return false;
      const from = Math.max(0, builtFrom - HEAVY_CHUNK_LINES);
      const beforeHeight = document.scrollingElement.scrollHeight;
      const chunk = buildLineChunk(b, from, builtFrom, indexOfLine, lastLineEl, io);
      wrap.insertBefore(chunk.frag, backAnchor);
      // New content just appeared above the reader's current spot -
      // compensate scrollTop by the same delta so nothing visibly jumps.
      document.scrollingElement.scrollTop += document.scrollingElement.scrollHeight - beforeHeight;
      backAnchor = chunk.firstTopNode;
      builtFrom = from;
      return true;
    };

    const nearForwardEdge = () => {
      const doc = document.scrollingElement;
      return builtTo < total && doc.scrollHeight - (doc.scrollTop + window.innerHeight) < HEAVY_EDGE_PX;
    };
    const nearBackwardEdge = () => builtFrom > 0 && document.scrollingElement.scrollTop < HEAVY_EDGE_PX;

    const extendHeavyWindow = () => {
      heavyBuildRaf = null;
      if (myGeneration !== readGeneration) return; // a newer renderRead() call has taken over - abandon
      try {
        const extended = (nearForwardEdge() && extendForward()) || (nearBackwardEdge() && extendBackward());
        if (extended && (nearForwardEdge() || nearBackwardEdge())) scheduleHeavyBuild();
      } catch (err) {
        console.error('Pothi Sahib: heavy-Bani lazy render step failed', err);
      }
    };

    function scheduleHeavyBuild() {
      if (heavyBuildRaf !== null || myGeneration !== readGeneration) return;
      heavyBuildRaf = requestAnimationFrame(extendHeavyWindow);
    }

    appendSampuranButton();
    window.addEventListener('scroll', scheduleHeavyBuild, { passive: true });
    cleanup.push(() => {
      if (heavyBuildRaf !== null) cancelAnimationFrame(heavyBuildRaf);
      window.removeEventListener('scroll', scheduleHeavyBuild);
    });
    requestAnimationFrame(scheduleHeavyBuild);
  } else {
    for (const b of list) {
      let entry = latestEntryFor(b.slug);
      if (entry && entry.stage !== 'completed') {
        resumeBySlug.set(b.slug, { i: entry.i, end: entry.end });
        entry.stage = 'progress'; // reactivate if it had been archived
      } else {
        entry = { slug: b.slug, start: Date.now(), end: Date.now(), stage: 'progress', i: 0 };
        S.baniLog.push(entry);
      }
      sessionLog.set(b.slug, entry);
      if (list.length > 1 && !S.continuous) wrap.append(el('h2', { class: 'bani-title', text: b.name }));
      if (!S.continuous) {
        // Provisional/attribution status intentionally isn't shown here -
        // it's identical across every Bani and belongs in Settings -> About,
        // not repeated above the text on every single read.
        if (b.reviewNotes && b.reviewNotes.length) {
          const details = document.createElement('details');
          details.className = 'review-notes';
          const summary = document.createElement('summary');
          summary.textContent = '⚠ ' + b.reviewNotes.length + ' known review note' + (b.reviewNotes.length > 1 ? 's' : '') + ' for this Bani';
          details.append(summary);
          for (const rn of b.reviewNotes) {
            details.append(el('p', { class: 'small muted', text: 'Line ' + (rn.lineIndex + 1) + ': ' + rn.note }));
          }
          wrap.append(details);
        }
      }
      let lastSection = -1;
      let para = null;
      b.lines.forEach((line, i) => {
        const s = line.s ?? 0; // omitted in storage when it's the Bani's first (0th) section
        if (S.showTitles && !S.continuous && s !== lastSection && b.sections.length > 1) {
          const sec = b.sections[s];
          // A generic BODY/BANI_SECTION entry with no real name is just an
          // internal structural break (a pauri/verse-group boundary) - it
          // carries no information worth a heading, so show nothing rather
          // than a bare "Section 7".
          const label = sec.name ?? (['BODY', 'BANI_SECTION'].includes(sec.t) ? null : sec.t.toLowerCase() + (sec.l ? ' ' + sec.l : ''));
          if (label) wrap.append(el('h2', { class: 'sec', text: label }));
          para = null;
        }
        lastSection = s;
        if (S.paragraph && !para) {
          para = el('div', { class: 'sec-body' });
          wrap.append(para);
        }
        const id = b.slug + ':' + i;
        const p = el('p', {
          class: 'line' + (S.bookmarks[id] ? ' bk' : ''),
          id: 'l' + globalIndex,
          'data-id': id,
          'data-i': String(i),
          'data-slug': b.slug,
          ondblclick: () => {
            if (S.bookmarks[id]) delete S.bookmarks[id];
            else S.bookmarks[id] = { at: Date.now(), text: line.t.slice(0, 40) };
            save();
            p.classList.toggle('bk');
            announce(S.bookmarks[id] ? 'Bookmark added' : 'Bookmark removed');
          },
        });
        p.append(...renderLine(line));
        (S.paragraph ? para : wrap).append(p);
        indexOfLine.push(p);
        lastLineEl.set(b.slug, p);
        globalIndex++;
      });
      if (!S.continuous) {
        wrap.append(
          el('div', { class: 'row', style: 'justify-content:center;margin:1rem 0' }, [
            el('button', {
              class: 'quiet sampuran-btn',
              text: '🙏 ਸੰਪੂਰਨ · Mark complete',
              onclick: () => markSampuran(b, sessionLog),
            }),
          ]),
        );
      }
    }
    indexOfLine.forEach((p) => io.observe(p));
  }

  document.body.append(prog);
  cleanup.push(() => prog.remove());
  view.append(wrap, readerBar());
  view.style.paddingBottom = '0'; // body padding-bottom clears fixed bar

  // Restore position: jump to a searched line, or to wherever the most
  // recently active Bani in this session (by prior .end) had reached -
  // for a combined multi-Bani read (e.g. Nitnem) this picks one Bani's
  // line, not a separately-tracked "combined session" position. A heavy
  // Bani already resolved its start line before building (targetLineIndex),
  // so it's a direct lookup rather than a search.
  requestAnimationFrame(() => {
    let target = null;
    if (heavyBani) {
      target = indexOfLine[targetLineIndex];
    } else if (route.jump !== undefined) {
      target = indexOfLine[route.jump];
    } else {
      let best = null;
      for (const [slug, r] of resumeBySlug) if (!best || r.end > best.end) best = { slug, i: r.i, end: r.end };
      if (best) target = indexOfLine.find((p) => p.dataset.slug === best.slug && +p.dataset.i === best.i);
    }
    // Visible "you left off here" marker, only on a genuine resume (never
    // for a search/bookmark jump or a fresh open).
    const resuming = route.jump === undefined && (heavyBani ? resumeBySlug.has(heavyBani.slug) : resumeBySlug.size > 0);
    if (target && resuming) {
      target.before(el('div', { class: 'resume-mark', text: '↪ you left off here' }));
    }
    if (target) target.scrollIntoView({ block: 'center' });
    if (S.autoScrollOnOpen) {
      // Let the jump above settle first, so auto-scroll doesn't fight it.
      requestAnimationFrame(() => requestAnimationFrame(() => startScroll()));
    }
  });

  cleanup.push(() => io.disconnect());
  if (S.keepAwake) requestWakeLock();
}

/** Words and pause marks as spans; the text itself is never altered. */
function renderLine(line) {
  const chars = cps(line.t);
  const vish = new Map(line.v ?? []); // Map<wordIndex, kind>
  const nodes = [];
  let prev = 0;
  const slice = (a, b) => chars.slice(a, b).join('');
  wordSpans(line).forEach(([s, e], idx) => {
    if (s > prev) nodes.push(el('span', { class: 'gap', text: slice(prev, s) }));
    let kind = vish.get(idx);
    if (kind !== undefined && S.vishraamKinds[kind] === false) kind = undefined; // that severity is hidden
    nodes.push(
      el('span', {
        class: 'w' + (kind !== undefined ? ' v' + kind : ''),
        text: slice(s, e),
      }),
    );
    prev = e;
  });
  if (prev < chars.length) nodes.push(el('span', { class: 'gap', text: slice(prev, chars.length) }));
  return nodes;
}

/**
 * Mark a Bani "ਸੰਪੂਰਨ" (complete) - via the button or by reaching its last
 * line on screen (see the IntersectionObserver in renderRead). Finalises
 * this session's reading-log entry, clears the saved position so a future
 * open starts fresh instead of "resuming" at the very last line, and
 * refreshes the Completed list if it's currently visible on Home.
 */
function markSampuran(bani, sessionLog) {
  const entry = sessionLog && sessionLog.get(bani.slug);
  if (entry) {
    if (entry.stage === 'completed') return; // already completed this session
    entry.stage = 'completed';
    entry.end = Date.now();
  } else {
    // Defensive fallback - shouldn't normally happen, every renderRead()
    // creates/reuses a row for each Bani in view before this can fire.
    S.baniLog.push({ slug: bani.slug, start: Date.now(), end: Date.now(), stage: 'completed', i: 0 });
  }
  save();
  announce('ਸੰਪੂਰਨ · ' + bani.name + ' marked complete');
  // Home's lists re-derive from S.baniLog fresh every renderHome() call,
  // so nothing else needs updating here - this only fires while actually
  // reading, never while Home is on screen.
}

/** Prompt for a short note on a line, and save it to S.flags. Defaults to the line currently at the top of the reader. */
function openFlagDialog(lineInfo) {
  const info = lineInfo || currentLine;
  if (!info) {
    announce('No line in view to flag yet');
    return;
  }
  const { bani, lineIndex, text } = info;
  const ta = el('textarea', {
    rows: '3',
    style: 'width:100%;font:inherit',
    placeholder: 'What looks off? e.g. a possible typo, wrong vishraam, missing word…',
  });
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: 'Flag this line for review' }),
      el('div', { class: 'grow' }),
      el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
    ]),
    el('div', { class: 'panel-body small' }, [
      el('p', { class: 'muted', text: bani.name + ' · line ' + (lineIndex + 1) }),
      el('p', { lang: 'pa', text: text }),
      ta,
      el('div', { class: 'row', style: 'margin-top:.5rem' }, [
        el('div', { class: 'grow' }),
        el('button', {
          class: 'primary',
          text: 'Save flag',
          onclick: () => {
            const note = ta.value.trim();
            if (!note) {
              announce('Add a short note first');
              return;
            }
            S.flags.push({ slug: bani.slug, lineIndex, text: text.slice(0, 80), note, at: Date.now() });
            save();
            announce('Flag saved');
            dlg.close();
          },
        }),
      ]),
    ]),
  ]);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  ta.focus();
}

const hexA = (hex, a) => {
  hex = hex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16),
    g = parseInt(hex.slice(2, 4), 16),
    b = parseInt(hex.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
};

/** The app's logo bitmap as a data URL, drawn onto the share-card canvas.
 * Color is ignored - the mark is a fixed PNG, not a recolorable SVG. */
function logoDataUrl() {
  return LOGO_URI;
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Draw letters with real tracking; ctx.letterSpacing is not universal. */
function fillTextSpaced(ctx, text, x, y, spacing) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx + widths[i] / 2, y);
    cx += widths[i] + spacing;
  });
}

const GUR_PA = '੦੧੨੩੪੫੬੭੮੯';
const paNumber = (n) => String(n).replace(/[0-9]/g, (d) => GUR_PA[+d]);

/** Binary search a [start, value, ...] flat map for the line index i. */
function flatAt(flat, i) {
  if (!flat || !flat.length) return null;
  let lo = 0,
    hi = flat.length / 2;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid * 2] <= i) lo = mid;
    else hi = mid;
  }
  return flat[lo * 2 + 1];
}

/**
 * Attribution for one line, from data the build derived per line:
 * which Ang (SGGP page) it's printed on and who wrote it. Bangs with no
 * per-line data (e.g. panthic compilations) return null; a specific line
 * with no mapping also gets null so its share falls back to the Bani name.
 */
function lineAttribution(info) {
  const { bani, lineIndex } = info || {};
  if (!bani || lineIndex == null || !bani.angMap) return null;
  const ang = flatAt(bani.angMap, lineIndex);
  const wid = bani.wm ? flatAt(bani.wm, lineIndex) : null;
  const author = wid && wid !== 'NONE' ? WRITERS[wid] : null;
  if (ang == null && !author) return null;
  return { ang, author };
}

function attributionTitle(info) {
  const att = lineAttribution(info);
  if (att && info.bani) {
    const hon = info.bani.honorific || info.bani.name;
    return att.ang != null ? hon + ' · ਅੰਗ ' + paNumber(att.ang) : hon;
  }
  return info && info.bani ? info.bani.name : null;
}

function attributionAuthor(info) {
  const att = lineAttribution(info);
  return att ? att.author : null;
}

/** Social-ready caption: the verse framed in dandas, then the Granth + Ang it comes from, then who wrote it. */
function buildShareText(info) {
  const parts = [];
  if (info.text && info.text.trim()) parts.push('॥ ' + info.text.trim().replace(/॥\s*$/, '').trim() + ' ॥');
  const title = attributionTitle(info);
  if (title) parts.push(title);
  const author = attributionAuthor(info);
  if (author) parts.push(author);
  return parts.join('\n\n');
}

/** Share as text via the OS share sheet, falling back to clipboard/alert. */
async function shareLineAsText(info) {
  const text = buildShareText(info);
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      return; // user cancelled the share sheet - not an error
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    announce('Copied to clipboard');
  } catch {
    dialogBox({ title: 'Share text', body: el('pre', { class: 'dialog-pre', text }), okText: 'Copy' });
  }
}

async function copyShareText(info) {
  const text = buildShareText(info);
  try {
    await navigator.clipboard.writeText(text);
    announce('Share text copied to clipboard');
  } catch {
    dialogBox({ title: 'Share text', body: el('pre', { class: 'dialog-pre', text }), okText: 'Close' });
  }
}

/** Draw one centered line, shrink-to-fit within maxW; returns the size used. */
function drawCenterFit(ctx, text, y, maxW, startSize, minSize, weight) {
  if (!text) return 0;
  let size = startSize;
  do {
    ctx.font = weight + ' ' + size + 'px system-ui, sans-serif';
    if (ctx.measureText(text).width <= maxW) break;
    size -= 2;
  } while (size > minSize);
  ctx.fillText(text, ctx.canvas.width / 2, y);
  return size;
}

/** Draw a line as a themed share card: Granth + Ang on top, who wrote it below, the verse as the main body. */
async function renderLineImage(info, orientation) {
  const W = orientation === 'landscape' ? 1600 : 1080;
  const H = orientation === 'landscape' ? 1000 : 1600;
  const P = Math.min(W, H); // portrait-friendly sizing unit
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = currentVar('--bg');
  const fg = currentVar('--gurbani');
  const accent = currentVar('--accent');

  // base tint
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // corner shading for depth
  const shade = ctx.createLinearGradient(0, 0, W, H);
  shade.addColorStop(0, 'rgba(255,255,255,.08)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.10)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // soft accent glow behind the verse
  const glow = ctx.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.max(W, H) * 0.58);
  glow.addColorStop(0, hexA(accent, 0.15));
  glow.addColorStop(1, hexA(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // layered frame: outer rule, inner hairline, corner + edge studs
  const m = Math.round(P * 0.055);
  ctx.strokeStyle = hexA(accent, 0.9);
  ctx.lineWidth = Math.max(2, Math.round(W * 0.005));
  ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  const inner = m + Math.round(P * 0.018);
  ctx.strokeStyle = hexA(accent, 0.4);
  ctx.lineWidth = Math.max(1, Math.round(P * 0.0016));
  ctx.strokeRect(inner, inner, W - inner * 2, H - inner * 2);
  const stud = Math.round(P * 0.013);
  ctx.strokeStyle = hexA(accent, 0.85);
  ctx.lineWidth = 1.5;
  for (const [cx, cy] of [
    [m, m],
    [W - m, m],
    [m, H - m],
    [W - m, H - m],
    [W / 2, m],
    [W / 2, H - m],
    [m, H / 2],
    [W - m, H / 2],
  ]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = hexA(accent, 0.85);
    ctx.fillRect(-stud / 2, -stud / 2, stud, stud);
    ctx.restore();
  }

  // header: small logo mark, then the Granth + Ang (h1) and who wrote it (h2)
  let logo = null;
  try {
    logo = await loadImage(logoDataUrl(accent));
  } catch {}
  const logoW = Math.round(P * 0.115);
  const logoH = logoW;
  const logoTop = Math.round(H * 0.055);
  if (logo) ctx.drawImage(logo, W / 2 - logoW / 2, logoTop, logoW, logoH);
  const h1Text = attributionTitle(info);
  const h2Text = attributionAuthor(info);
  const textMaxW = W - inner * 2 - Math.round(W * 0.06);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  const h1Size = drawCenterFit(ctx, h1Text, logoTop + logoH + Math.round(P * 0.06), textMaxW, Math.round(P * 0.043), Math.round(P * 0.027), '700');
  let attrBottom = logoTop + logoH + Math.round(P * 0.06) + h1Size;
  if (h2Text) {
    const h2Y = attrBottom + Math.round(P * 0.018);
    ctx.fillStyle = fg;
    const h2Size = drawCenterFit(ctx, h2Text, h2Y, textMaxW, Math.round(P * 0.036), Math.round(P * 0.024), '500');
    attrBottom = h2Y + h2Size;
  }

  // ornamental divider: rule — ◆ — rule
  const ornY = attrBottom + Math.round(P * 0.05);
  const ornHalf = Math.round(P * 0.12);
  ctx.strokeStyle = hexA(accent, 0.6);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - ornHalf, ornY);
  ctx.lineTo(W / 2, ornY);
  ctx.moveTo(W / 2 + ornHalf, ornY);
  ctx.lineTo(W / 2, ornY);
  ctx.stroke();
  const ds = Math.round(P * 0.007);
  ctx.save();
  ctx.translate(W / 2, ornY);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexA(accent, 0.85);
  ctx.fillRect(-ds / 2, -ds / 2, ds, ds);
  ctx.restore();

  // verse: word-wrap in the band between the divider and the bottom frame, shrink-to-fit
  const textTop = ornY + Math.round(P * 0.035);
  const textBottom = H - inner - Math.round(P * 0.09);
  const textAreaW = W - inner * 2 - Math.round(W * 0.08);
  const textAreaH = textBottom - textTop;
  const words = info.text.split(/\s+/).filter(Boolean);
  let fontSize = Math.round(P * 0.09);
  let lines, lineHeight;
  do {
    ctx.font = fontSize + 'px ' + S.font;
    lineHeight = fontSize * 1.6;
    lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(test).width > textAreaW) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    fontSize -= 4;
  } while (
    fontSize > Math.round(P * 0.03) &&
    (lines.length * lineHeight > textAreaH || lines.some((l) => ctx.measureText(l).width > textAreaW))
  );
  ctx.font = fontSize + 'px ' + S.font;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hexA(accent, 0.55);
  ctx.shadowBlur = fontSize * 0.5;
  ctx.shadowOffsetY = fontSize * 0.06;
  const totalTextH = lines.length * lineHeight;
  let y = textTop + (textAreaH - totalTextH) / 2 + lineHeight / 2;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += lineHeight;
  }
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // footer: app credit, in the band between the verse area and the inner rule
  ctx.fillStyle = hexA(fg, 0.55);
  ctx.font = '500 ' + Math.max(12, Math.round(P * 0.019)) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Pothi Sahib · Arvinder Singh', W / 2, H - inner - Math.round(P * 0.032));

  return canvas;
}

/** Pick the share card for the reader bar: use the current line if we have it. */
function openBaniShareDialog() {
  const cur = currentLine;
  if (!cur || !cur.text) {
    const t = route.title;
    if (t) {
      if (navigator.share) navigator.share({ title: route.title, text: t }).catch(() => {});
      else copyShareText({ bani: { name: route.title }, lineIndex: null, text: '' });
    }
    return;
  }
  openShareDialog(cur, { label: 'Share this Bani' });
}

function openShareDialog(info, opts = {}) {
  let orientation = 'portrait';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:100%;border-radius:.4rem;margin:.5rem 0;';
  img.alt = 'Share card';
  const redraw = () => {
    renderLineImage(info, orientation).then(
      (c) => {
        if (dlg.open) img.src = c.toDataURL('image/png');
      },
      () => {
        if (dlg.open) announce('Could not draw the share card');
      }
    );
  };
  const portraitBtn = el('button', { class: 'primary', text: 'Portrait' });
  const landscapeBtn = el('button', { text: 'Landscape' });
  const setOrientation = (o) => {
    orientation = o;
    portraitBtn.className = o === 'portrait' ? 'primary' : '';
    landscapeBtn.className = o === 'landscape' ? 'primary' : '';
    redraw();
  };
  portraitBtn.addEventListener('click', () => setOrientation('portrait'));
  landscapeBtn.addEventListener('click', () => setOrientation('landscape'));
  const makeBlob = async () => {
    const c = await renderLineImage(info, orientation);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  };
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: opts.label || 'Share card' }),
      el('div', { class: 'grow' }),
      el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
    ]),
    el('div', { class: 'panel-body small' }, [
      el('div', { class: 'row' }, [portraitBtn, landscapeBtn]),
      img,
      el('div', { class: 'row', style: 'margin-top:.5rem' }, [
        el('button', {
          class: 'primary',
          text: '⬇ Download',
          onclick: async () => {
            try {
              const blob = await makeBlob();
              const url = URL.createObjectURL(blob);
              const a = el('a', { href: url, download: 'pothi-sahib.png' });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch {
              announce('Could not render the image');
            }
          },
        }),
        navigator.canShare
          ? el('button', {
              text: '📤 Share',
              onclick: async () => {
                try {
                  const blob = await makeBlob();
                  const file = new File([blob], 'pothi-sahib.png', { type: 'image/png' });
                  if (navigator.canShare({ files: [file] })) {
                    try {
                      await navigator.share({ files: [file], title: info.bani.name });
                    } catch {}
                  } else {
                    announce('Sharing images is not supported on this device — use Download instead');
                  }
                } catch {
                  announce('Could not render the image');
                }
              },
            })
          : null,
        el('button', { text: '📋 Copy text', onclick: () => copyShareText(info) }),
      ]),
    ]),
  ]);
  redraw();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** Menu shown on long-press (touch) or right-click (desktop) over a line. */
function openLineActions(info) {
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: 'Line actions' }),
      el('div', { class: 'grow' }),
      el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
    ]),
    el('div', { class: 'panel-body small' }, [
      el('p', { class: 'muted', text: info.bani.name + ' · line ' + (info.lineIndex + 1) }),
      el('p', { lang: 'pa', text: info.text }),
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:.5rem' }, [
        el('button', {
          class: 'primary',
          text: '📝 Add note',
          onclick: () => {
            dlg.close();
            openFlagDialog(info);
          },
        }),
        el('button', { text: '💬 Share as text', onclick: () => shareLineAsText(info) }),
        el('button', {
          text: '🖼 Share card',
          onclick: () => {
            dlg.close();
            openShareDialog(info, { label: 'Share card' });
          },
        }),
      ]),
    ]),
  ]);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function lineInfoFromEvent(e) {
  const p = e.target.closest('.line');
  if (!p) return null;
  const bani = BY_SLUG.get(p.dataset.slug);
  const lineIndex = +p.dataset.i;
  if (!bani) return null;
  return { bani, lineIndex, text: bani.lines[lineIndex].t };
}

function readerBar() {
  barVisible = true; // reset when a new bar is created

  // ── speed badge ────────────────────────────────────────────
  const wpmBadge = el('span', {
    class: 'wpm-badge compact-hide',
    text: String(S.speed),
    'aria-live': 'polite',
    'aria-label': S.speed + ' of 100',
  });
  const updateWPM = (v) => {
    v = clampSpeed(v);
    wpmBadge.textContent = String(v);
    wpmBadge.setAttribute('aria-label', v + ' of 100');
    S.speed = v;
    save();
  };

  // ── font badge ─────────────────────────────────────────────
  const fontBadge = el('span', { class: 'font-badge compact-hide', text: S.size + ' px', 'aria-live': 'polite', 'aria-label': S.size + ' pixels' });
  const updateFont = (v) => {
    fontBadge.textContent = v + ' px';
    fontBadge.setAttribute('aria-label', v + ' pixels');
    S.size = v;
    save();
  };

  // ── play/pause ─────────────────────────────────────────────
  const play = el('button', {
    class: 'primary hit compact-hide',
    text: '▶',
    'aria-label': 'Start auto-scroll',
    onclick: toggleScroll,
  });
  playBtn = play;

  // ── bar: [logo ← ⚙] [grow] [− ▶ + ×] | [A− size A+] [grow] [🚩 ⛶ ? share] ──
  const barEl = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Reader controls' }, [
    // small brand mark - hidden automatically while fullscreen (see
    // :fullscreen in styles.css), so it never becomes a reading distraction
    logoMark('bar-logo'),
    // nav group
    el('button', { class: 'quiet hit', text: '←', 'aria-label': 'Back to home', onclick: () => go({ tab: 'home' }) }),
    el('button', { class: 'quiet hit', text: '⚙️', 'aria-label': 'Reading settings', onclick: openSettingsPanel }),
    // push controls toward centre
    el('div', { class: 'bar-grow' }),
    // speed group: − ▶ + ×
    el('button', { class: 'quiet hit', text: '−', 'aria-label': 'Decrease speed', onclick: () => updateWPM(S.speed - SPEED_STEP) }),
    play,
    el('button', { class: 'quiet hit', text: '+', 'aria-label': 'Increase speed', onclick: () => updateWPM(S.speed + SPEED_STEP) }),
    wpmBadge,
    // separator
    el('div', { class: 'bar-sep' }),
    // font group: A− size A+
    el('button', { class: 'quiet hit', text: 'A−', 'aria-label': 'Smaller text', onclick: () => updateFont(Math.max(14, S.size - 1)) }),
    fontBadge,
    el('button', { class: 'quiet hit', text: 'A+', 'aria-label': 'Larger text', onclick: () => updateFont(Math.min(72, S.size + 1)) }),
    // push utilities to far right
    el('div', { class: 'bar-grow' }),
    // utilities
    el('button', { class: 'quiet hit', text: '🚩', 'aria-label': 'Flag current line for review', onclick: () => openFlagDialog() }),
    (angChipEl = el('span', { class: 'ang-chip compact-hide', text: '', 'aria-hidden': 'true' })),
    el('button', {
      class: 'quiet hit',
      text: '⛶',
      'aria-label': 'Toggle full screen',
      onclick: () => {
        const fsEl = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)?.call(fsEl)?.catch?.(() => {});
        }
      },
    }),
    el('button', {
      class: 'quiet hit',
      text: '📤',
      'aria-label': 'Share this Bani',
      onclick: openBaniShareDialog,
    }),
    el('button', { class: 'quiet hit', text: '?', 'aria-label': 'Keyboard shortcuts', onclick: showShortcuts }),
  ]);

  // ── handle (shown when bar is hidden) ──────────────────────────
  const handle = el('button', {
    class: 'bar-handle',
    'aria-label': 'Show controls',
    onclick: () => {
      barVisible = true;
      barEl.classList.remove('bar-hidden');
      handle.classList.remove('visible');
      announce('Controls shown');
    },
  });
  document.body.append(handle);
  cleanup.push(() => handle.remove());

  return barEl;
}
/**
 * Floating settings button and the panel it opens. The panel sits over the text so a change
 * can be judged against the Bani being read; anything that needs the text rebuilt (paragraph
 * mode, headings, continuous reading) is applied when the panel is closed, and the reading
 * position is restored afterwards.
 */
function settingsFab() {
  return el('button', {
    class: 'fab',
    text: '⚙',
    'aria-label': 'Reading settings',
    onclick: openSettingsPanel,
  });
}

const STRUCTURAL = ['paragraph', 'showTitles', 'continuous'];
function openSettingsPanel() {
  stopScroll();
  const before = JSON.stringify(STRUCTURAL.map((k) => S[k]));
  const body = el('div', { class: 'panel-body' });
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: 'Settings' }),
      el('div', { class: 'grow' }),
      el('button', {
        class: 'quiet hit',
        text: '✕',
        'aria-label': 'Close',
        onclick: () => dlg.close(),
      }),
    ]),
    body,
  ]);
  const fill = () => {
    body.replaceChildren();
    buildSettings(body, () => {
      save();
      fill();
    });
  };
  fill();
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (JSON.stringify(STRUCTURAL.map((k) => S[k])) !== before) render();
  });
  document.body.append(dlg);
  dlg.showModal();
}

// ------------------------------------------------------- auto-scroll
let playBtn = null;
const cleanup = [];
function drainCleanup() {
  if (!cleanup.length) return;
  readGeneration++;
  while (cleanup.length) {
    const fn = cleanup.pop();
    try {
      fn();
    } catch (err) {
      console.error('Pothi Sahib: reader cleanup failed', err);
    }
  }
  currentLine = null;
}
function toggleScroll() {
  scroller ? stopScroll() : startScroll();
}

// While auto-scroll is running, a manual touch/wheel/pointer interaction
// takes priority: the animation loop goes inert (keeps ticking but stops
// moving the page) until the user has been idle for USER_SCROLL_IDLE_MS,
// then picks back up from wherever they left off - see the drift-resync in
// step() below. Listeners are only attached while scroller is active.
const USER_SCROLL_IDLE_MS = 700;
let userScrolling = false;
let userScrollIdleTimer = null;
function markUserScrolling() {
  userScrolling = true;
  clearTimeout(userScrollIdleTimer);
  userScrollIdleTimer = setTimeout(() => {
    userScrolling = false;
  }, USER_SCROLL_IDLE_MS);
}
const USER_SCROLL_EVENTS = ['touchstart', 'touchmove', 'wheel', 'pointerdown'];
// Keyboard keys that scroll the page natively; treat them like any other
// manual scroll so autoscroll yields instead of fighting PageDown & co.
const USER_SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
function onScrollKey(e) {
  if (USER_SCROLL_KEYS.includes(e.key)) markUserScrolling();
}

function startScroll() {
  if (scroller) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    announce('Auto-scroll is disabled because your device has reduced-motion enabled. Use the Settings to read manually.');
    return;
  }
  let last = null;
  let target = window.scrollY;
  const step = (t) => {
    const dt = last === null ? 0 : Math.min(t - last, 250);
    last = t;
    if (!userScrolling) {
      if (Math.abs(window.scrollY - target) > 8) target = window.scrollY;
      target += (wpmToPxPerSec(speedToWpm(S.speed), avgWPL) * dt) / 1000;
      window.scrollTo({ top: target, behavior: 'instant' });
      const doc = document.scrollingElement;
      if (Math.ceil(doc.scrollTop + window.innerHeight) >= doc.scrollHeight - 1) return stopScroll();
    }
    scroller = requestAnimationFrame(step);
  };
  scroller = requestAnimationFrame(step);
  for (const type of USER_SCROLL_EVENTS) document.addEventListener(type, markUserScrolling, { passive: true });
  document.addEventListener('keydown', onScrollKey);
  if (playBtn) {
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'Pause auto-scroll');
  }
  announce('Auto-scroll started');
  requestWakeLock();
}
function stopScroll() {
  if (scroller) cancelAnimationFrame(scroller);
  scroller = null;
  clearTimeout(userScrollIdleTimer);
  userScrolling = false;
  for (const type of USER_SCROLL_EVENTS) document.removeEventListener(type, markUserScrolling);
  document.removeEventListener('keydown', onScrollKey);
  if (playBtn) {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Start auto-scroll');
  }
  announce('Auto-scroll stopped');
}
// Tiny (2x2px, 1s) silent, black, looping mp4 - the classic "NoSleep" trick.
// A muted looping video keeps most mobile browsers from dimming/locking the
// screen even where the Wake Lock API itself is unavailable, which is the
// normal case here since this app is opened directly as a file:// page (not
// a secure context, which navigator.wakeLock requires).
const NOSLEEP_VIDEO_SRC =
  'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAG5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABZG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2V+IiMBEAAADAAQAAAMACDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFigAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAEAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAsUAAAABAAAAFHN0Y28AAAAAAAAAAQAAA0YAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAxAAAACGZyZWUAAALNbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAEGWIhAAV//73ye/Apuvb34E=';

/** A hidden, looped, muted video element used only to keep the screen awake. Created once and reused. */
function ensureWakeLockVideo() {
  if (wakeLockVideo) return wakeLockVideo;
  const v = el('video', {
    src: NOSLEEP_VIDEO_SRC,
    muted: true,
    loop: true,
    playsinline: true,
    style: 'position:fixed;width:1px;height:1px;bottom:0;right:0;opacity:0.01;pointer-events:none;',
  });
  v.muted = true; // some browsers only honour muted as a property, not the attribute
  document.body.append(v);
  wakeLockVideo = v;
  return v;
}

async function requestWakeLock() {
  if (!S.keepAwake) return;
  if (!wakeLock && navigator.wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } catch {}
  }
  if (!wakeLock) {
    // Wake Lock API unavailable or the request failed - fall back to the
    // muted-video trick so screen-awake still works from a file:// page.
    try {
      await ensureWakeLockVideo().play();
    } catch {}
  }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  if (wakeLockVideo) {
    wakeLockVideo.pause();
    wakeLockVideo.remove();
    wakeLockVideo = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopScroll();
    releaseWakeLock();
  } else {
    if (S.keepAwake && route.tab === 'read') {
      requestWakeLock();
    }
    checkReminders();
  }
});

// swipe right-to-left = back on touch devices
let swipeStartX = null;
document.addEventListener(
  'touchstart',
  (e) => {
    swipeStartX = e.touches[0]?.clientX ?? null;
  },
  { passive: true },
);
document.addEventListener(
  'touchend',
  (e) => {
    if (swipeStartX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? swipeStartX) - swipeStartX;
    swipeStartX = null;
    if (dx > 60 && route.tab === 'read') go({ tab: 'home' }); // swipe right = back
  },
  { passive: true },
);

// ── long-press (touch) / right-click (desktop) on a line = line actions menu ──
let longPressTimer = null;
let longPressFired = false;
document.addEventListener(
  'touchstart',
  (e) => {
    if (route.tab !== 'read') return;
    const info = lineInfoFromEvent(e);
    clearTimeout(longPressTimer);
    if (!info) return;
    longPressFired = false;
    longPressTimer = setTimeout(() => {
      longPressFired = true;
      openLineActions(info);
    }, 550);
  },
  { passive: true },
);
document.addEventListener('touchmove', () => clearTimeout(longPressTimer), { passive: true });
document.addEventListener('touchend', () => clearTimeout(longPressTimer), { passive: true });
document.addEventListener('contextmenu', (e) => {
  if (route.tab !== 'read') return;
  const info = lineInfoFromEvent(e);
  if (!info) return;
  e.preventDefault();
  openLineActions(info);
});

// ── tap = scroll toggle; double-tap/click = hide/show bar ──
function toggleBarVisibility() {
  barVisible = !barVisible;
  const bar = document.querySelector('.bar');
  const handle = document.querySelector('.bar-handle');
  if (bar) bar.classList.toggle('bar-hidden', !barVisible);
  if (handle) handle.classList.toggle('visible', !barVisible);
  announce(barVisible ? 'Controls shown' : 'Controls hidden — double-tap to show again');
}

// Desktop: single click = scroll, double-click = bar toggle
document.addEventListener('click', (e) => {
  if (route.tab !== 'read') return;
  if (e.target.closest('button, a, input, select, dialog, .bar, .bar-handle')) return;
  if (window.getSelection()?.toString()) return;
  toggleScroll();
});
document.addEventListener('dblclick', (e) => {
  if (route.tab !== 'read') return;
  if (e.target.closest('button, a, input, select, dialog, .bar, .bar-handle')) return;
  toggleBarVisibility();
});

// Mobile: track last tap time on touchend for double-tap detection
let lastTapTs = 0;
document.addEventListener(
  'touchend',
  (e) => {
    if (route.tab !== 'read') return;
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    if (e.target.closest('button, a, input, select, dialog, .bar, .bar-handle')) return;
    const now = Date.now();
    if (now - lastTapTs < 300) {
      lastTapTs = 0;
      toggleBarVisibility();
    } else {
      lastTapTs = now;
    }
  },
  { passive: true },
);
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (route.tab !== 'read') return;
  if (e.key === ' ') {
    e.preventDefault();
    toggleScroll();
  } else if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') {
    S.speed = clampSpeed(S.speed + SPEED_STEP);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => {
      b.textContent = String(S.speed);
      b.setAttribute('aria-label', S.speed + ' of 100');
    });
    announce('speed ' + S.speed + ' of 100');
  } else if (e.key === '-' || e.key === 'ArrowLeft') {
    S.speed = clampSpeed(S.speed - SPEED_STEP);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => {
      b.textContent = String(S.speed);
      b.setAttribute('aria-label', S.speed + ' of 100');
    });
    announce('speed ' + S.speed + ' of 100');
  } else if (e.key.toLowerCase() === 'h') {
    toggleBarVisibility();
  } else if (e.key === 'Escape') {
    stopScroll();
    go({ tab: 'home' });
  } else if (e.key === '?') {
    e.preventDefault();
    showShortcuts();
  } else if (e.key.toLowerCase() === 'l') {
    S.larivaar = !S.larivaar;
    save();
  } else if (e.key.toLowerCase() === 'f') {
    openFlagDialog();
  }
});

function showShortcuts() {
  const rows = [
    ['Space', 'Play / pause auto-scroll'],
    ['→ / +', 'Speed up'],
    ['← / −', 'Slow down'],
    ['H', 'Hide / show controls'],
    ['L', 'Toggle Larivaar'],
    ['F', 'Flag current line for review'],
    ['Esc', 'Exit reader'],
    ['?', 'Show this help'],
  ];
  const tbody = document.createElement('tbody');
  rows.forEach(([k, desc]) => {
    const tr = document.createElement('tr');
    const tdKey = document.createElement('td');
    const kbd = document.createElement('kbd');
    kbd.className = 'kbd';
    kbd.textContent = k;
    tdKey.append(kbd);
    const tdDesc = document.createElement('td');
    tdDesc.textContent = desc;
    tr.append(tdKey, tdDesc);
    tbody.append(tr);
  });
  const tbl = document.createElement('table');
  tbl.className = 'shortcuts-table';
  tbl.append(tbody);
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: 'Keyboard shortcuts' }),
      el('div', { class: 'grow' }),
      el('button', { class: 'quiet hit', text: '✕', 'aria-label': 'Close', onclick: () => dlg.close() }),
    ]),
    el('div', { class: 'panel-body small' }, [
      el('p', { class: 'muted', text: 'These shortcuts work while a Bani is open.' }),
      tbl,
      el('p', { class: 'muted', style: 'margin-top:.75rem', text: 'On touch: swipe right to go back to the home screen. Long-press a line for note/share options.' }),
    ]),
  ]);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- init
for (const b of document.querySelectorAll('nav.tabs button')) b.addEventListener('click', () => go({ tab: b.dataset.tab }));
backEl.addEventListener('click', () => go({ tab: 'home' }));
applyTheme();
render();
