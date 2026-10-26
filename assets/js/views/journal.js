// Journal: one entry per day with mood, energy and stress, notes and tags.
// Each save also stores a snapshot of the day (recovery, sleep, food, training, habits).
import { h, icon, fmt0, todayISO, shortDate, relDay, hoursMin, toast, confirmSheet, debounce } from '../ui.js';
import { get, post } from '../api.js';
import { loading, dateHead, dayLabel } from '../components.js';
import { addDays } from '../tdee.js';

const SCALES = [['mood', 'Mood', 'Low', 'Great'], ['energy', 'Energy', 'Drained', 'Energized'], ['stress', 'Stress', 'Calm', 'Overloaded']];
const DEFAULT_TAGS = ['Good sleep', 'Poor sleep', 'Training', 'Rest day', 'Sore', 'Hungry', 'Work stress', 'Social', 'Travel', 'Sick'];
const DRAFT = (d) => `ff_journal_draft_${d}`;

function contextText(c) {
  if (!c) return '';
  return [
    c.recovery != null ? `Recovery ${c.recovery}%` : null,
    c.sleep_hours != null ? `Sleep ${hoursMin(c.sleep_hours)}` : null,
    c.steps != null ? `${fmt0(c.steps)} steps` : null,
    ...(c.workouts || []),
    c.kcal != null ? `${fmt0(c.kcal)} kcal` : null,
    c.habits_total ? `Habits ${c.habits_done} of ${c.habits_total}` : null,
  ].filter(Boolean).join(' · ');
}

export async function render(root, params) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params[0] || '') ? params[0] : todayISO();
  root.replaceChildren(loading());
  const [{ entry, context }, listRes] = await Promise.all([get('journal', { date }), get('journal/list', { limit: 30 })]);
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT(date)) || 'null'); } catch {}
  const e = { mood: null, energy: null, stress: null, body: '', tags: [], ...(entry || {}), ...(draft || {}) };
  const saveDraft = debounce(() => { try { localStorage.setItem(DRAFT(date), JSON.stringify({ mood: e.mood, energy: e.energy, stress: e.stress, body: e.body, tags: e.tags })); } catch {} }, 400);
  const clearDraft = () => { try { localStorage.removeItem(DRAFT(date)); } catch {} };

  const scales = SCALES.map(([k, label, lo, hi]) => {
    const btns = h('div', { class: 'scale' });
    const draw = () => btns.replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { type: 'button', 'aria-pressed': String(e[k] === n), 'aria-label': `${label} ${n} of 5`, onclick: () => { e[k] = e[k] === n ? null : n; draw(); saveDraft(); } }, n)));
    draw();
    return h('fieldset', { class: 'scale-set' }, h('legend', null, label), btns, h('div', { class: 'scale-ends' }, h('span', null, lo), h('span', null, hi)));
  });

  const body = h('textarea', { id: 'jr-body', rows: 7, placeholder: 'How did today go? Anything about training, food, sleep or mood worth remembering?', oninput: () => { e.body = body.value; saveDraft(); } }, e.body || '');
  const allTags = [...new Set([...e.tags, ...listRes.tags, ...DEFAULT_TAGS])].slice(0, 24);
  const tagBox = h('div', { class: 'pills' });
  const tagIn = h('input', { class: 'input', id: 'jr-tag', placeholder: 'New tag', maxlength: 32, style: { height: '36px', width: '140px' } });
  const drawTags = () => tagBox.replaceChildren(...allTags.map(t => h('button', { class: 'pill', type: 'button', 'aria-pressed': String(e.tags.includes(t)), onclick: () => {
    e.tags = e.tags.includes(t) ? e.tags.filter(x => x !== t) : [...e.tags, t]; drawTags(); saveDraft();
  } }, t)), h('form', { style: { display: 'inline-flex', gap: '6px' }, onsubmit: (ev) => {
    ev.preventDefault();
    const t = tagIn.value.trim();
    if (!t) return;
    if (!allTags.includes(t)) allTags.unshift(t);
    if (!e.tags.includes(t)) e.tags.push(t);
    tagIn.value = ''; drawTags(); saveDraft();
  } }, h('label', { class: 'sr', for: 'jr-tag' }, 'Add a tag'), tagIn, h('button', { class: 'btn sm', type: 'submit', style: { height: '36px' } }, 'Add')));
  drawTags();

  const status = h('span', { class: 'small muted', role: 'status' }, entry ? `Saved ${new Date(entry.updated_at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}` : draft ? 'Draft, not saved yet' : '');
  const save = async () => {
    if (!e.body.trim() && !e.mood && !e.energy && !e.stress && !e.tags.length) { toast('Write something or pick a mood first', 'error'); return; }
    try {
      const r = await post('journal/save', { date, mood: e.mood, energy: e.energy, stress: e.stress, body: e.body, tags: e.tags });
      clearDraft();
      toast('Entry saved');
      status.textContent = `Saved ${new Date(r.entry.updated_at * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
      render(root, [date]);
    } catch (err) { toast(err.message, 'error'); }
  };

  const ctx = entry?.context || context;
  const editor = h('section', { class: 'card', 'aria-label': `Entry for ${shortDate(date)}` },
    ...scales,
    h('label', { class: 'field', for: 'jr-body' }, 'Entry', body),
    h('div', { class: 'field' }, h('span', null, 'Tags'), tagBox),
    contextText(ctx) ? h('div', { class: 'context-box' }, h('span', { class: 'tiny muted', style: { fontWeight: 600 } }, entry ? 'Saved with this entry' : 'Will be saved with this entry'), h('span', { class: 'small' }, contextText(ctx))) : null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      h('button', { class: 'btn primary', onclick: save }, entry ? 'Update entry' : 'Save entry'), status,
      entry ? h('button', { class: 'btn sm ghost danger', style: { marginLeft: 'auto' }, onclick: async () => {
        if (!(await confirmSheet('Delete this entry?', `Delete your journal entry for ${shortDate(date)}?`))) return;
        await post('journal/delete', { date }); clearDraft(); toast('Entry deleted'); render(root, [date]);
      } }, 'Delete') : null));

  const listBox = h('div', { class: 'list' });
  const drawList = (entries) => listBox.replaceChildren(...(entries.length ? entries.map(x => h('a', { class: 'journal-row', href: `#/journal/${x.date}`, 'aria-current': x.date === date ? 'true' : null },
    h('span', { class: 'jr-head' }, h('span', { class: 'title' }, relDay(x.date)),
      h('span', { class: 'small muted' }, [x.mood ? `Mood ${x.mood}` : null, x.context?.recovery != null ? `Recovery ${x.context.recovery}%` : null].filter(Boolean).join(' · '))),
    x.body ? h('span', { class: 'small muted jr-text' }, x.body) : null,
    x.tags.length ? h('span', { class: 'tiny muted' }, x.tags.join(', ')) : null)) : [h('p', { class: 'note' }, 'No entries yet.')]));
  drawList(listRes.entries);
  const search = h('input', { type: 'search', placeholder: 'Search entries and tags', 'aria-label': 'Search journal' });
  search.addEventListener('input', debounce(async () => drawList((await get('journal/list', { limit: 50, q: search.value.trim() })).entries), 300));

  root.replaceChildren(
    dateHead({ eyebrow: dayLabel(date), title: 'Journal', prev: `#/journal/${addDays(date, -1)}`, next: date < todayISO() ? `#/journal/${addDays(date, 1)}` : null }),
    h('div', { class: 'row' },
      h('div', { class: 'grow-3 stack' }, editor),
      h('section', { class: 'card grow-2', 'aria-label': 'Past entries' },
        h('h2', null, 'Past entries'),
        h('label', { class: 'search' }, icon('search'), search),
        listBox)));
}

