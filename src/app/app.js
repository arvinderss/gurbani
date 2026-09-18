'use strict';
// ---------------------------------------------------------------- data
const DATA = JSON.parse(document.getElementById('kosh-data').textContent);
const BANIS = DATA.banis;
const BY_SLUG = new Map(BANIS.map((b) => [b.slug, b]));
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
  theme: 'light',
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
  lh: 2.2,
  weight: 700,
  align: 'center',
  font: "'Noto Sans Gurmukhi', 'Nirmala UI', sans-serif",
  speed: 120, // words per minute (scales with font size)
  colors: {},
  favourites: [],
  pothis: [],
  bookmarks: {},
  sehaj: {},
  flags: [], // reader-added "please review this line" notes; see § flags
  baniLog: [], // { slug, start, end, stage, i } - one row per reading arc, all derived views read this; see § bani log
  sampuranWindowDays: 90, // how many days a completed Bani stays in the Completed list, 30/60/90/180/365
  openCats: {}, // which collapsible <details> categories the user has toggled, by id
};
const KEY = 'pothi-sahib-standalone';
let S = load();
function load() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
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
/**
 * The app's mark: a simple open book (an offline "Pothi" being read), no
 * religious iconography - deliberate, given what the app displays. Uses
 * currentColor so it re-themes with the rest of the UI; see .logo-mark in
 * styles.css for sizing/colour, and the separate static favicon in
 * head.html (which can't reach page CSS, so it hardcodes a colour).
 */
const logoMark = (className) =>
  el('span', { class: 'logo-mark' + (className ? ' ' + className : ''), 'aria-hidden': 'true' }, [
    (() => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 64 64');
      svg.setAttribute('focusable', 'false');
      const mk = (tag, attrs) => {
        const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
      };
      const solid = (d, extra) => mk('path', Object.assign({ d, fill: 'currentColor' }, extra));
      svg.append(
        mk('circle', { cx: '32', cy: '25', r: '25', fill: 'none', stroke: 'currentColor', 'stroke-width': '1', opacity: '.13' }),
        mk('ellipse', { cx: '32', cy: '24', rx: '22', ry: '13.5', fill: 'currentColor', opacity: '.14' }),
        mk('ellipse', { cx: '32', cy: '54', rx: '17', ry: '3', fill: 'currentColor', opacity: '.14' }),
        solid('M32 30 C41 29 52 30 55 34 C57 37.5 58 48 55 52 C53 56 44 57 32 55 Z', { opacity: '.5' }),
        solid('M32 30 C23 29 12 30 9 34 C7 37.5 6 48 9 52 C11 56 20 57 32 55 Z', { opacity: '.5' }),
        mk('g', { stroke: 'currentColor', 'stroke-width': '1.1', 'stroke-linecap': 'round', fill: 'none', opacity: '.45' }).append(
          mk('path', { d: 'M50 36.5 L50.6 50.6' }),
          mk('path', { d: 'M45 34.5 L45.4 52.4' }),
          mk('path', { d: 'M41 33.6 L41.2 53.2' }),
          mk('path', { d: 'M14 36.5 L13.4 50.6' }),
          mk('path', { d: 'M19 34.5 L18.6 52.4' }),
          mk('path', { d: 'M23 33.6 L22.8 53.2' })
        ),
        mk('g', { stroke: 'currentColor', 'stroke-width': '1.4', 'stroke-linecap': 'round', fill: 'none', opacity: '.8' })
          .append(
            mk('path', { d: 'M32 31 L32 15', opacity: '.9' }),
            mk('path', { d: 'M24.5 31.5 L16 16', opacity: '.7' }),
            mk('path', { d: 'M39.5 31.5 L48 16', opacity: '.7' }),
            mk('path', { d: 'M18 34 L9 25', opacity: '.55' }),
            mk('path', { d: 'M46 34 L55 25', opacity: '.55' })
          ),
        solid('M32 33.5 C40 32.5 49 32.5 52.5 36.5 C54.5 39 55.5 47.5 52.5 50.5 C50.5 53.5 42.5 54.8 32 52.6 Z'),
        solid('M32 33.5 C24 32.5 15 32.5 11.5 36.5 C9.5 39 8.5 47.5 11.5 50.5 C13.5 53.5 21.5 54.8 32 52.6 Z'),
        mk('g', { fill: 'currentColor', opacity: '.9' }).append(
          mk('rect', { x: '36', y: '40.5', width: '9', height: '1.6', rx: '.8' }),
          mk('rect', { x: '37', y: '45.5', width: '7', height: '1.6', rx: '.8' }),
          mk('rect', { x: '19', y: '40.5', width: '9', height: '1.6', rx: '.8' }),
          mk('rect', { x: '20', y: '45.5', width: '7', height: '1.6', rx: '.8' })
        ),
        solid('M29.6 15.6 L32 13.2 L34.4 15.6 L32 20.5 Z'),
        solid('M30.2 20.5 L33.8 20.5 L33.8 39 L32 35.8 L30.2 39 Z'),
        solid('M16 3.8 L17.1 7.9 L21.2 9 L17.1 10.1 L16 14.2 L14.9 10.1 L10.8 9 L14.9 7.9 Z'),
        solid('M32 1.8 L33.1 5.9 L37.2 7 L33.1 8.1 L32 12.2 L30.9 8.1 L26.8 7 L30.9 5.9 Z'),
        solid('M48 3.8 L49.1 7.9 L53.2 9 L49.1 10.1 L48 14.2 L46.9 10.1 L42.8 9 L46.9 7.9 Z')
      );
      return svg;
    })(),
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

/**
 * Full-text search across every line of every Bani. Supports plain
 * substring matching, and (since Gurbani is often recalled by its opening
 * letters) matching against the first letter of each word - so typing
 * "ਸਸਸਸ" finds a line whose four words each begin with those letters.
 * Capped so a broad query (e.g. a single common letter) stays fast and the
 * results list stays usable.
 */
function searchLines(query, limit = 40) {
  const q = query.trim();
  if (!q) return [];
  const byFirstLetters = cps(q).every((c) => !NON_LETTER.has(c) && !/\s/.test(c));
  const results = [];
  for (const b of BANIS) {
    ensureBaniLines(b);
    if (!b.lines) continue;
    for (let i = 0; i < b.lines.length; i++) {
      const line = b.lines[i];
      const hit = line.t.includes(q) || (byFirstLetters && firstLetters(line.t).includes(q));
      if (!hit) continue;
      results.push({ bani: b, lineIndex: i, text: line.t });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function renderHome() {
  titleEl.textContent = 'Pothi Sahib';
  // Full-text search scans all 137k+ lines; debounced so fast typing
  // doesn't trigger a scan per keystroke.
  let searchTimer = null;
  const q = el('input', {
    type: 'search',
    placeholder: 'Filter Banian, or search the text…',
    'aria-label': 'Filter Banian or search the text',
    style: 'width:100%;margin-bottom:.75rem',
    oninput: (e) => {
      const value = e.target.value.trim().toLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => draw(value), 150);
    },
  });
  const holder = el('div');
  view.append(el('div', { class: 'home-hero' }, [logoMark('home-hero-logo')]), q, holder);
  renderContinueReading();
  draw('');
  renderCompletedBanis();
  renderBookmarksArchive();

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
    view.prepend(section);
  }
  function draw(filter) {
    holder.replaceChildren();
    const favs = BANIS.filter((b) => S.favourites.includes(b.slug));
    const groups = new Map();
    for (const b of BANIS) {
      if (filter && !(b.name.toLowerCase().includes(filter) || b.slug.includes(filter))) continue;
      groups.set(b.granth, [...(groups.get(b.granth) ?? []), b]);
    }
    if (!filter) {
      const nitnem = NITNEM.map((s) => BY_SLUG.get(s)).filter(Boolean);
      if (nitnem.length) holder.append(group('home-nitnem', 'ਨਿਤਨੇਮ ਬਾਣੀਆਂ · Nitnem Baniya', nitnem, true));
    }
    if (favs.length && !filter) holder.append(group('home-favs', '★ Bookmarked (Favourites)', favs));
    for (const [g, items] of groups) holder.append(group('home-granth-' + g, g, items));
    if (!groups.size) holder.append(el('p', { class: 'muted', text: 'Nothing matches.' }));

    // Full-text results only once the query is meaningfully specific -
    // this is separate from the name filter above, which always runs.
    if (filter.length >= 2) {
      const hits = searchLines(filter);
      if (hits.length) {
        holder.append(
          el('section', {}, [
            el('h2', { class: 'section', text: 'Matching lines' }),
            el(
              'ul',
              { class: 'list' },
              hits.map((h) =>
                el('li', {}, [
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
                      el('div', { class: 'small muted', text: h.bani.name }),
                    ],
                  ),
                ]),
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
      sel(
        S.font,
        [
          ["'Noto Sans Gurmukhi', 'Nirmala UI', sans-serif", 'Noto Sans Gurmukhi'],
          ["'Nirmala UI', sans-serif", 'Nirmala UI'],
          ["'Gurbani Akhar', 'Noto Sans Gurmukhi', sans-serif", 'Gurbani Akhar'],
          ["'Mukta Mahee', sans-serif", 'Mukta Mahee'],
          ['serif', 'System serif'],
        ],
        (v) => (S.font = v),
      ),
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
  const speedScroll = el('div', { class: 'card' }, [
    el('p', {
      class: 'small muted',
      style: 'margin:.2rem 0 .5rem',
      text: 'Speed is in words per minute — it auto-adjusts for font size so you always read the same number of words per minute, not pixels.',
    }),
    srow(
      '⚡',
      'Reading speed',
      el('div', { class: 'row' }, [
        el(
          'div',
          { class: 'wpm-presets' },
          [
            [40, 'Meditative'],
            [70, 'Slow'],
            [120, 'Normal'],
            [180, 'Fast'],
          ].map(([v, t]) =>
            el('button', {
              text: t + ' ' + v,
              class: S.speed === v ? 'primary' : '',
              onclick: () => {
                S.speed = v;
                rerender();
              },
            }),
          ),
        ),
        num(() => S.speed, (v) => (S.speed = v), 10, 20, 300, (v) => v + ' wpm'),
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
        onclick: () => {
          if (!confirm('Reset all settings to defaults? Your Pothis, bookmarks, flags and reading history are kept.')) return;
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

  view.append(
    catDetails('set-typography', 'Aa', 'Typography', typography, true),
    catDetails('set-behaviour', '🖐', 'Reading Behaviour', readingBehaviour, true),
    catDetails('set-vishraam', '∼', 'Vishraam', vishraam, true),
    catDetails('set-appearance', '🎨', 'Appearance & Colours', appearance, true),
    catDetails('set-speed', '⚡', 'Speed & Scrolling', speedScroll, false),
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

// ── changelog: every Bani's history, newest first ──────────────────
function buildChangelogCard() {
  const entries = [];
  for (const b of BANIS) {
    for (const h of b.history || []) entries.push({ ...h, bani: b.name });
  }
  entries.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
  if (!entries.length) return el('div', { class: 'card small muted' }, [el('p', { text: 'No history recorded yet.' })]);
  return el(
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
}

// ── review flags: notes a reader left on specific lines ────────────
function buildFlagsCard(rerender) {
  if (!S.flags.length)
    return el('div', { class: 'card small muted' }, [
      el('p', { text: "No flags yet. While reading, long-press (or right-click) a line and choose Add note, or press F for the line currently in view." }),
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
  const toolbar = el('div', { class: 'row', style: 'margin-bottom:.5rem' }, [
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
          alert(text);
        }
      },
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
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'pothi-sahib-backup.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== 'pothi-sahib-backup/1') throw new Error('not a Pothi Sahib backup');
      S = { ...DEFAULTS, ...sanitizeSettings(parsed.settings) };
      save();
      render();
      alert('Restored.');
    } catch (e) {
      alert('Could not restore: ' + e.message);
    }
  });
  input.click();
}

// ---------------------------------------------------------------- read
let scroller = null;
let wakeLock = null;
let wakeLockVideo = null; // muted looping <video> fallback, for when navigator.wakeLock is unavailable (e.g. opened as a file:// page, which isn't a secure context)
let avgWPL = 6; // average words per line; set in renderRead, used in startScroll
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

/** Share a line's text via the OS share sheet, falling back to clipboard/alert. */
async function shareLineAsText(info) {
  const text = info.text + '\n— ' + info.bani.name + ' · Pothi Sahib';
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
    alert(text);
  }
}

/** Draw a line onto a bordered, themed canvas image for sharing. */
function renderLineImage(info, orientation) {
  const W = orientation === 'landscape' ? 1600 : 1080;
  const H = orientation === 'landscape' ? 1000 : 1600;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const bg = currentVar('--bg');
  const fg = currentVar('--gurbani');
  const accent = currentVar('--accent');

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // decorative double border with small corner accents
  const margin = Math.round(W * 0.07);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.round(W * 0.006);
  ctx.strokeRect(margin, margin, W - margin * 2, H - margin * 2);
  const inner = margin + Math.round(W * 0.02);
  ctx.lineWidth = Math.max(1, Math.round(W * 0.0015));
  ctx.strokeRect(inner, inner, W - inner * 2, H - inner * 2);
  const cornerR = Math.round(W * 0.014);
  for (const [cx, cy] of [
    [margin, margin],
    [W - margin, margin],
    [margin, H - margin],
    [W - margin, H - margin],
  ]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = accent;
    ctx.fillRect(-cornerR / 2, -cornerR / 2, cornerR, cornerR);
    ctx.restore();
  }

  // main text: word-wrap, then shrink-to-fit the available box
  const textAreaW = W - inner * 2 - Math.round(W * 0.08);
  const textAreaH = H - inner * 2 - Math.round(H * 0.18);
  const words = info.text.split(/\s+/).filter(Boolean);
  let fontSize = Math.round(W * 0.09);
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
  } while (fontSize > 20 && (lines.length * lineHeight > textAreaH || lines.some((l) => ctx.measureText(l).width > textAreaW)));
  ctx.font = fontSize + 'px ' + S.font;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const totalTextH = lines.length * lineHeight;
  let y = H / 2 - totalTextH / 2 + lineHeight / 2 - Math.round(H * 0.03);
  for (const l of lines) {
    ctx.fillText(l, W / 2, y);
    y += lineHeight;
  }

  // attribution
  ctx.font = Math.round(W * 0.028) + 'px system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(info.bani.name, W / 2, H - inner - Math.round(H * 0.05));
  ctx.font = Math.round(W * 0.02) + 'px system-ui, sans-serif';
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.7;
  ctx.fillText('Pothi Sahib', W / 2, H - inner - Math.round(H * 0.022));
  ctx.globalAlpha = 1;
  return canvas;
}

function openShareImageDialog(info) {
  let orientation = 'portrait';
  const img = document.createElement('img');
  img.style.cssText = 'max-width:100%;border-radius:.4rem;margin:.5rem 0;';
  const redraw = () => {
    img.src = renderLineImage(info, orientation).toDataURL('image/png');
  };
  const portraitBtn = el('button', { class: 'primary', text: 'Portrait' });
  const landscapeBtn = el('button', { text: 'Landscape' });
  portraitBtn.addEventListener('click', () => {
    orientation = 'portrait';
    portraitBtn.className = 'primary';
    landscapeBtn.className = '';
    redraw();
  });
  landscapeBtn.addEventListener('click', () => {
    orientation = 'landscape';
    landscapeBtn.className = 'primary';
    portraitBtn.className = '';
    redraw();
  });
  const dlg = el('dialog', { class: 'settings-panel' }, [
    el('div', { class: 'panel-head' }, [
      el('strong', { text: 'Share as image' }),
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
          onclick: () => {
            renderLineImage(info, orientation).toBlob((blob) => {
              const url = URL.createObjectURL(blob);
              const a = el('a', { href: url, download: 'pothi-sahib-line.png' });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
          },
        }),
        navigator.canShare
          ? el('button', {
              text: '📤 Share',
              onclick: () => {
                renderLineImage(info, orientation).toBlob(async (blob) => {
                  const file = new File([blob], 'pothi-sahib-line.png', { type: 'image/png' });
                  if (navigator.canShare({ files: [file] })) {
                    try {
                      await navigator.share({ files: [file], title: info.bani.name });
                    } catch {}
                  } else {
                    announce('Sharing images is not supported on this device — use Download instead');
                  }
                });
              },
            })
          : null,
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
          text: '🖼 Share as image',
          onclick: () => {
            dlg.close();
            openShareImageDialog(info);
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
  const fmtWPM = (v) => v + ' wpm';
  const wpmBadge = el('span', { class: 'wpm-badge compact-hide', text: fmtWPM(S.speed), 'aria-live': 'polite', 'aria-label': S.speed + ' words per minute' });
  const updateWPM = (v) => {
    wpmBadge.textContent = fmtWPM(v);
    wpmBadge.setAttribute('aria-label', v + ' words per minute');
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

  // ── bar: [logo ← ⚙] [grow] [− ▶ + wpm] | [A− size A+] [grow] [🚩 ⛶ ? share] ──
  const barEl = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Reader controls' }, [
    // small brand mark - hidden automatically while fullscreen (see
    // :fullscreen in styles.css), so it never becomes a reading distraction
    logoMark('bar-logo'),
    // nav group
    el('button', { class: 'quiet hit', text: '←', 'aria-label': 'Back to home', onclick: () => go({ tab: 'home' }) }),
    el('button', { class: 'quiet hit', text: '⚙️', 'aria-label': 'Reading settings', onclick: openSettingsPanel }),
    // push controls toward centre
    el('div', { class: 'bar-grow' }),
    // speed group: − ▶ + wpm
    el('button', { class: 'quiet hit', text: '−', 'aria-label': 'Decrease speed (−10 wpm)', onclick: () => updateWPM(Math.max(20, S.speed - 10)) }),
    play,
    el('button', { class: 'quiet hit', text: '+', 'aria-label': 'Increase speed (+10 wpm)', onclick: () => updateWPM(Math.min(300, S.speed + 10)) }),
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
    el('button', {
      class: 'quiet hit',
      text: '⛶',
      'aria-label': 'Toggle full screen',
      onclick: () => {
        const fsEl = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        } else {
          (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)?.call(fsEl);
        }
      },
    }),
    navigator.share
      ? el('button', {
          class: 'quiet hit',
          text: '📤',
          'aria-label': 'Share this Bani',
          onclick: () => navigator.share({ title: route.title, text: route.title + ' — Pothi Sahib' }).catch(() => {}),
        })
      : null,
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
      target += (wpmToPxPerSec(S.speed, avgWPL) * dt) / 1000;
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
  } else if (S.keepAwake && route.tab === 'read') {
    requestWakeLock();
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
    S.speed = Math.min(300, S.speed + 10);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => (b.textContent = S.speed + ' wpm'));
    announce(S.speed + ' words per minute');
  } else if (e.key === '-' || e.key === 'ArrowLeft') {
    S.speed = Math.max(20, S.speed - 10);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => (b.textContent = S.speed + ' wpm'));
    announce(S.speed + ' words per minute');
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
    ['→ / +', 'Speed up (+10 wpm)'],
    ['← / −', 'Slow down (−10 wpm)'],
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
