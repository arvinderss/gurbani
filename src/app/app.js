'use strict';
// ---------------------------------------------------------------- data
const DATA = JSON.parse(document.getElementById('kosh-data').textContent);
const BANIS = DATA.banis;
const BY_SLUG = new Map(BANIS.map((b) => [b.slug, b]));
const cps = (s) => Array.from(s);

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
  paragraph: false,
  continuous: false,
  keepAwake: true,
  showTitles: true,
  size: 28,
  lh: 2.2,
  weight: 700,
  align: 'center',
  font: "'Noto Sans Gurmukhi', 'Nirmala UI', sans-serif",
  speed: 120, // words per minute (scales with font size)
  colors: {},
  favourites: [],
  pothis: [],
  positions: {},
  bookmarks: {},
  sehaj: {},
  flags: [], // reader-added "please review this line" notes; see § flags
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
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== false && v !== undefined) n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid);
  return n;
};
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

function go(r) {
  route = r;
  stopScroll();
  render();
  window.scrollTo(0, 0);
}

function render() {
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
  const q = el('input', {
    type: 'search',
    placeholder: 'Filter Banian, or search the text…',
    'aria-label': 'Filter Banian or search the text',
    style: 'width:100%;margin-bottom:.75rem',
    oninput: (e) => draw(e.target.value.trim().toLowerCase()),
  });
  const holder = el('div');
  view.append(q, holder);
  renderContinueReading();
  draw('');
  function renderContinueReading() {
    const inProgress = Object.entries(S.positions)
      .filter(([k]) => BY_SLUG.has(k))
      .sort((a, b) => b[1].at - a[1].at);
    const old = view.querySelector('.continue-reading');
    if (old) old.remove();
    if (!inProgress.length) return;
    const section = el('section', { class: 'continue-reading' }, [
      el('h2', { class: 'section', text: 'Continue Reading' }),
      el(
        'div',
        { class: 'card' },
        inProgress.map(([slug, pos]) => {
          const bani = BY_SLUG.get(slug);
          const pct = Math.round((pos.i / Math.max(1, bani.lines.length - 1)) * 100);
          return el('div', { class: 'row', style: 'margin: 0.5rem 0' }, [
            el(
              'button',
              {
                class: 'quiet',
                style: 'text-align:left;flex:1',
                onclick: () => go({ tab: 'read', slugs: [slug], key: slug, title: bani.name }),
              },
              [el('div', { text: bani.name }), el('div', { class: 'small muted', text: pct + '% · ' + timeAgo(pos.at) })],
            ),
            el('button', {
              class: 'quiet hit',
              text: '✕',
              'aria-label': 'Remove ' + bani.name + ' from Continue Reading',
              onclick: () => {
                delete S.positions[slug];
                save();
                renderContinueReading();
              },
            }),
          ]);
        }),
      ),
    ]);
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
      if (nitnem.length) holder.append(group('ਨਿਤਨੇਮ ਬਾਣੀਆਂ · Nitnem Baniya', nitnem, true));
    }
    if (favs.length && !filter) holder.append(group('★ Favourites', favs));
    for (const [g, items] of groups) holder.append(group(g, items));
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
  function group(name, items, readAll) {
    return el('section', {}, [
      el('h2', { class: 'section', text: name }),
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
        items.map((b) =>
          el('li', {}, [
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
                  text: b.lines.length + ' lines · ' + b.state.toLowerCase(),
                }),
              ],
            ),
          ]),
        ),
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
  const sh = (icon, text) => {
    const h = el('h2', { class: 'section' });
    const ic = el('em', { class: 'sec-ic', 'aria-hidden': 'true', text: icon });
    h.append(ic, document.createTextNode(' ' + text));
    return h;
  };

  // ── 📖 READING ─────────────────────────────────────
  view.append(sh('📖', 'Reading'));
  view.append(
    el(
      'div',
      { class: 'card' },
      [
        srow(
          'ਲ',
          'Larivaar',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.larivaar),
            'aria-label': 'Larivaar',
            onclick: (ev) => {
              S.larivaar = !S.larivaar;
              ev.currentTarget.setAttribute('aria-checked', String(S.larivaar));
              rerender();
            },
          }),
          'Continuous Gurmukhi — no spaces between words',
        ),
        srow(
          '🌈',
          'Larivaar Assist',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.larivaarAssist),
            'aria-label': 'Larivaar assist',
            onclick: (ev) => {
              S.larivaarAssist = !S.larivaarAssist;
              ev.currentTarget.setAttribute('aria-checked', String(S.larivaarAssist));
              rerender();
            },
          }),
          'Colour alternate words so the eye can separate them',
        ),
        srow(
          '¶',
          'Paragraph Mode',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.paragraph),
            'aria-label': 'Paragraph mode',
            onclick: (ev) => {
              S.paragraph = !S.paragraph;
              ev.currentTarget.setAttribute('aria-checked', String(S.paragraph));
              rerender();
            },
          }),
          'Group lines into blocks rather than one line each',
        ),
        srow(
          '📜',
          'Continuous Reading',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.continuous),
            'aria-label': 'Continuous reading',
            onclick: (ev) => {
              S.continuous = !S.continuous;
              ev.currentTarget.setAttribute('aria-checked', String(S.continuous));
              rerender();
            },
          }),
          'Hide headings and provenance for undisturbed paath',
        ),
        srow(
          '∼',
          'Vishraam Marks',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.vishraam),
            'aria-label': 'Show vishraams',
            onclick: (ev) => {
              S.vishraam = !S.vishraam;
              ev.currentTarget.setAttribute('aria-checked', String(S.vishraam));
              rerender();
            },
          }),
          'Pause marks from the source — never added to the text',
        ),
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
        srow(
          '#',
          'Section Titles',
          el('button', {
            class: 'sw',
            role: 'switch',
            'aria-checked': String(!!S.showTitles),
            'aria-label': 'Show titles',
            onclick: (ev) => {
              S.showTitles = !S.showTitles;
              ev.currentTarget.setAttribute('aria-checked', String(S.showTitles));
              rerender();
            },
          }),
          'Section headings inside a Bani',
        ),
      ].filter(Boolean),
    ),
  );

  // ── 🎨 APPEARANCE ──────────────────────────────────
  view.append(sh('🎨', 'Appearance'));
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
  view.append(themes);
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
  view.append(colours);
  view.append(
    el('button', {
      class: 'quiet small',
      text: '↺ Reset custom colours',
      onclick: () => {
        S.colors = {};
        rerender();
      },
    }),
  );

  // ── Aa TYPOGRAPHY ──────────────────────────────────────
  view.append(sh('Aa', 'Typography'));
  view.append(
    el('div', { class: 'card' }, [
      el('p', {
        class: 'text',
        style: 'margin:.5rem 0;font-size:calc(var(--size)*.75)',
        text: 'ੰ ਸ੍ਰੀ ਵਾਹਿਗੁਰੂ ਜੀ ਕੀ ਫਤਿਹ',
      }),
      srow('📐', 'Text size', num(() => S.size, (v) => (S.size = v), 1, 14, 72, (v) => v + ' px')),
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
    ]),
  );

  // ── ⚡ SPEED & SCROLLING ──────────────────────────────
  view.append(sh('⚡', 'Speed & Scrolling'));
  view.append(
    el('div', { class: 'card' }, [
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
          num(() => S.speed, (v) => (S.speed = v), 5, 20, 300, (v) => v + ' wpm'),
        ]),
      ),
      srow(
        '☀',
        'Keep Screen Awake',
        el('button', {
          class: 'sw',
          role: 'switch',
          'aria-checked': String(!!S.keepAwake),
          'aria-label': 'Keep screen awake',
          onclick: (ev) => {
            S.keepAwake = !S.keepAwake;
            ev.currentTarget.setAttribute('aria-checked', String(S.keepAwake));
            rerender();
          },
        }),
        'Prevents screen dimming while reading',
      ),
    ]),
  );

  // ── 🚩 REVIEW FLAGS ─────────────────────────────────
  // Notes a reader has left on specific lines while reading (see the 🚩
  // button in the reader toolbar). These stay on this device only - export
  // them and hand the text to whoever maintains the content.
  view.append(sh('🚩', 'My Flags'));
  view.append(buildFlagsCard(rerender));

  // ── 🕘 CHANGELOG ───────────────────────────────────
  view.append(sh('🕘', 'Changelog'));
  view.append(buildChangelogCard());

  // ── 💾 DATA ────────────────────────────────────────
  view.append(sh('💾', 'Backup & Restore'));
  view.append(
    el('div', { class: 'card' }, [
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
            if (!confirm('Reset all settings to defaults? Your Pothis, bookmarks and flags are kept.')) return;
            const keep = {
              favourites: S.favourites,
              pothis: S.pothis,
              positions: S.positions,
              bookmarks: S.bookmarks,
              sehaj: S.sehaj,
              flags: S.flags,
            };
            S = { ...DEFAULTS, ...keep };
            rerender();
          },
        }),
      ]),
    ]),
  );

  // ── ℹ ABOUT ───────────────────────────────────────────
  view.append(sh('ℹ️', 'About'));
  const total = BANIS.reduce((n, b) => n + b.lines.length, 0);
  view.append(
    el('div', { class: 'card small muted' }, [
      el('p', { text: 'Pothi Sahib — single-file build. ' + BANIS.length + ' Banian, ' + total + ' lines.' }),
      el('p', { text: 'Built ' + new Date(DATA.builtAt).toLocaleString() + '.' }),
      el('p', {
        text:
          'Text adopted from: ' +
          [...new Set(BANIS.map((b) => b.source.name).filter(Boolean))].join(', ') +
          '. Where a Bani is marked PROVISIONAL, it has been adopted from a source and not yet reviewed line by line against printed editions — see Changelog above for what has already been checked.',
      }),
      el('p', { text: [...new Set(BANIS.map((b) => b.source.attribution).filter(Boolean))].join(' ') }),
      el('p', { text: 'Nothing here is sent anywhere. No account, no analytics, no network requests.' }),
    ]),
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
      el('p', { text: "No flags yet. While reading, use the 🚩 button (or press F) to flag the line you're on for review." }),
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
function importBackup() {
  const input = el('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.format !== 'pothi-sahib-backup/1') throw new Error('not a Pothi Sahib backup');
      S = { ...DEFAULTS, ...parsed.settings };
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
let avgWPL = 6; // average words per line; set in renderRead, used in startScroll
let barVisible = true; // whether the floating reader bar is shown
let currentLine = null; // { bani, lineIndex, text } for the line nearest the top of the viewport - used by the flag button

/** Count average words per line across a list of Banis. */
function calcAvgWPL(list) {
  let tw = 0,
    tl = 0;
  for (const b of list) {
    for (const line of b.lines) {
      tw += Math.max(1, line.w.length);
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
function renderRead() {
  const list = route.slugs.map((s) => BY_SLUG.get(s)).filter(Boolean);
  avgWPL = calcAvgWPL(list); // update global so startScroll can use it
  titleEl.textContent = route.title;
  const wrap = el('div', { class: 'text', lang: 'pa' });
  let globalIndex = 0;
  const indexOfLine = [];
  for (const b of list) {
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
      globalIndex++;
    });
  }
  // Progress bar
  const prog = el('div', {
    class: 'progress-bar',
    role: 'progressbar',
    'aria-label': 'Reading progress',
    'aria-valuenow': '0',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    style: 'width:0',
  });
  document.body.append(prog);
  cleanup.push(() => prog.remove());
  view.append(wrap, readerBar());
  view.style.paddingBottom = '0'; // body padding-bottom clears fixed bar

  // restore position, or jump to a searched line
  const key = route.key;
  requestAnimationFrame(() => {
    let target = null;
    if (route.jump !== undefined) target = indexOfLine[route.jump];
    else if (S.positions[key]) target = indexOfLine[S.positions[key].i];
    if (target) target.scrollIntoView({ block: 'center' });
  });

  // remember the topmost visible line, and track it for the flag button
  const io = new IntersectionObserver(
    (entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b2) => a.boundingClientRect.top - b2.boundingClientRect.top)[0];
      if (!top) return;
      const i = indexOfLine.indexOf(top.target);
      S.positions[key] = { i, at: Date.now() };
      if (route.slugs.length === 1) S.positions[route.slugs[0]] = { i: +top.target.dataset.i, at: Date.now() };
      const bani = BY_SLUG.get(top.target.dataset.slug);
      const lineIndex = +top.target.dataset.i;
      currentLine = bani ? { bani, lineIndex, text: bani.lines[lineIndex].t } : null;
      // update progress bar
      const pct = Math.round((i / Math.max(1, indexOfLine.length - 1)) * 100);
      prog.style.width = pct + '%';
      prog.setAttribute('aria-valuenow', String(pct));
      try {
        localStorage.setItem(KEY, JSON.stringify(S));
      } catch {}
    },
    { rootMargin: '-15% 0px -70% 0px' },
  );
  indexOfLine.forEach((p) => io.observe(p));
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
  (line.w.length ? line.w : [[0, chars.length]]).forEach(([s, e], idx) => {
    if (s > prev) nodes.push(el('span', { class: 'gap', text: slice(prev, s) }));
    const kind = vish.get(idx);
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

/** Prompt for a short note on the line currently at the top of the reader, and save it to S.flags. */
function openFlagDialog() {
  if (!currentLine) {
    announce('No line in view to flag yet');
    return;
  }
  const { bani, lineIndex, text } = currentLine;
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

function readerBar() {
  barVisible = true; // reset when a new bar is created

  // ── speed badge ────────────────────────────────────────────
  const fmtWPM = (v) => v + ' wpm';
  const wpmBadge = el('span', { class: 'wpm-badge', text: fmtWPM(S.speed), 'aria-live': 'polite', 'aria-label': S.speed + ' words per minute' });
  const updateWPM = (v) => {
    wpmBadge.textContent = fmtWPM(v);
    wpmBadge.setAttribute('aria-label', v + ' words per minute');
    S.speed = v;
    save();
  };

  // ── font badge ─────────────────────────────────────────────
  const fontBadge = el('span', { class: 'font-badge', text: S.size + ' px', 'aria-live': 'polite', 'aria-label': S.size + ' pixels' });
  const updateFont = (v) => {
    fontBadge.textContent = v + ' px';
    fontBadge.setAttribute('aria-label', v + ' pixels');
    S.size = v;
    save();
  };

  // ── play/pause ─────────────────────────────────────────────
  const play = el('button', {
    class: 'primary hit',
    text: '▶',
    'aria-label': 'Start auto-scroll',
    onclick: toggleScroll,
  });
  playBtn = play;

  // ── bar: [← ⚙] [grow] [− ▶ + wpm] | [A− size A+] [grow] [🚩 ⛶ ? share] ──
  const barEl = el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Reader controls' }, [
    // nav group
    el('button', { class: 'quiet hit', text: '←', 'aria-label': 'Back to home', onclick: () => go({ tab: 'home' }) }),
    el('button', { class: 'quiet hit', text: '⚙️', 'aria-label': 'Reading settings', onclick: openSettingsPanel }),
    // push controls toward centre
    el('div', { class: 'bar-grow' }),
    // speed group: − ▶ + wpm
    el('button', { class: 'quiet hit', text: '−', 'aria-label': 'Decrease speed (−5 wpm)', onclick: () => updateWPM(Math.max(20, S.speed - 5)) }),
    play,
    el('button', { class: 'quiet hit', text: '+', 'aria-label': 'Increase speed (+5 wpm)', onclick: () => updateWPM(Math.min(300, S.speed + 5)) }),
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
    el('button', { class: 'quiet hit', text: '🚩', 'aria-label': 'Flag current line for review', onclick: openFlagDialog }),
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
function toggleScroll() {
  scroller ? stopScroll() : startScroll();
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
    if (Math.abs(window.scrollY - target) > 8) target = window.scrollY;
    target += (wpmToPxPerSec(S.speed, avgWPL) * dt) / 1000;
    window.scrollTo({ top: target, behavior: 'instant' });
    const doc = document.scrollingElement;
    if (Math.ceil(doc.scrollTop + window.innerHeight) >= doc.scrollHeight - 1) return stopScroll();
    scroller = requestAnimationFrame(step);
  };
  scroller = requestAnimationFrame(step);
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
  if (playBtn) {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'Start auto-scroll');
  }
  announce('Auto-scroll stopped');
}
async function requestWakeLock() {
  if (!S.keepAwake || wakeLock || !navigator.wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => (wakeLock = null));
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopScroll();
  else if (S.keepAwake && route.tab === 'read') requestWakeLock();
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
    S.speed = Math.min(300, S.speed + 5);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => (b.textContent = S.speed + ' wpm'));
    announce(S.speed + ' words per minute');
  } else if (e.key === '-' || e.key === 'ArrowLeft') {
    S.speed = Math.max(20, S.speed - 5);
    save();
    document.querySelectorAll('.wpm-badge').forEach((b) => (b.textContent = S.speed + ' wpm'));
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
    ['→ / +', 'Speed up (+5 wpm)'],
    ['← / −', 'Slow down (−5 wpm)'],
    ['H', 'Hide / show controls'],
    ['L', 'Toggle Larivaar'],
    ['F', 'Flag current line for review'],
    ['Esc', 'Exit reader'],
    ['?', 'Show this help'],
  ];
  const tbody = document.createElement('tbody');
  rows.forEach(([k, desc]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><kbd class="kbd">${k}</kbd></td><td>${desc}</td>`;
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
      el('p', { class: 'muted', style: 'margin-top:.75rem', text: 'On touch: swipe right to go back to the home screen.' }),
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
