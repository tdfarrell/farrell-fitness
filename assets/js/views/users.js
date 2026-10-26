// Users (admins only): add people, reset passwords, pause or delete accounts.
import { h, icon, timeAgo, openSheet, toast, confirmSheet } from '../ui.js';
import { get, post } from '../api.js';
import { state } from '../store.js';
import { pageHead, loading } from '../components.js';

const initial = (u) => (u.name || u.username).trim().charAt(0).toUpperCase();
function subText(u) {
  if (u.disabled) return `@${u.username} · paused`;
  if (u.last_seen_at == null) return `@${u.username} · ${u.must_change_pw ? 'hasn’t signed in yet' : 'no recent activity'}`;
  return `@${u.username} · ${Date.now() / 1000 - u.last_seen_at < 600 ? 'active now' : `active ${timeAgo(u.last_seen_at)}`}`;
}
function tag(u) {
  if (u.disabled) return ['Paused', 'tag-paused'];
  if (u.is_admin) return ['Admin', 'tag-admin'];
  if (u.must_change_pw) return ['New', 'tag-new'];
  return ['Member', ''];
}

export async function render(root) {
  if (!state.user?.is_admin) {
    root.replaceChildren(pageHead('Settings', 'Users'), h('section', { class: 'card' }, h('p', { class: 'note' }, 'Only admins can manage users.')));
    return;
  }
  root.replaceChildren(loading());
  let { users } = await get('admin/users');
  const listEl = h('section', { class: 'card', 'aria-label': 'People', style: { padding: '4px 16px', gap: 0 } });
  const draw = () => listEl.replaceChildren(...users.map((u, i) => {
    const [t, cls] = tag(u);
    return h('button', { class: 'user-row', style: { borderTop: i ? '1px solid var(--rule)' : '0' }, onclick: () => openUser(u) },
      h('span', { class: 'avatar' + (u.is_admin ? ' admin' : ''), 'aria-hidden': 'true' }, initial(u)),
      h('span', { class: 'main' }, h('span', { class: 'title' }, u.name, u.me ? h('span', { class: 'muted', style: { fontWeight: 500 } }, ' (you)') : null), h('span', { class: 'small muted' }, subText(u))),
      h('span', { class: 'badge ' + cls }, t),
      icon('right', 18));
  }));
  const update = (r) => { users = r.users; draw(); };

  function showPassword(u, pw, created) {
    openSheet({
      title: created ? `${u.name} is set up` : `New password for ${u.name}`,
      body: h('div', { class: 'stack' },
        h('p', { class: 'note' }, `Give ${u.name} their username and this temporary password. It’s shown only once. They choose their own the first time they sign in.`),
        h('div', { class: 'temp-pw' },
          h('span', { class: 'small muted' }, 'Username'), h('span', { class: 'mono' }, u.username),
          h('span', { class: 'small muted' }, 'Temporary password'), h('span', { class: 'mono' }, pw)),
        h('button', { class: 'btn block', onclick: async () => {
          try { await navigator.clipboard.writeText(`Farrell Fitness\nAddress: ${location.origin}${location.pathname}\nUsername: ${u.username}\nTemporary password: ${pw}`); toast('Copied'); }
          catch { toast('Copy didn’t work. Select the text instead.', 'error'); }
        } }, 'Copy sign-in details')),
    });
  }

  function openUser(u) {
    const act = async (route, body, msg) => {
      try { const r = await post(route, { id: u.id, ...body }); update(r); s.close(); if (msg) toast(msg); return r; }
      catch (e) { toast(e.message, 'error'); return null; }
    };
    const s = openSheet({
      title: u.name,
      body: h('div', { class: 'stack' },
        h('p', { class: 'note' }, subText(u)),
        h('label', { class: 'field', for: 'us-name' }, 'Name', h('input', { id: 'us-name', value: u.name, onchange: async (e) => {
          try { update(await post('admin/users/update', { id: u.id, name: e.target.value })); toast('Saved'); } catch (err) { toast(err.message, 'error'); }
        } })),
        u.me ? h('p', { class: 'note small' }, 'Change your own password in Settings. Another admin can change your admin access.') : h('div', { class: 'stack', style: { gap: '8px' } },
          h('button', { class: 'btn block', onclick: async () => {
            if (!(await confirmSheet(`Reset ${u.name}’s password?`, 'They’re signed out everywhere and get a temporary password to change on their next sign-in.', 'Reset'))) return;
            const r = await act('admin/users/reset', {});
            if (r) showPassword(u, r.temp_password, false);
          } }, 'Reset password'),
          h('button', { class: 'btn block', onclick: () => act('admin/users/update', { is_admin: !u.is_admin }, u.is_admin ? 'No longer an admin' : 'Now an admin') }, u.is_admin ? 'Remove admin access' : 'Make admin'),
          h('button', { class: 'btn block', onclick: () => act('admin/users/signout', {}, 'Signed out on every device') }, 'Sign out everywhere'),
          h('button', { class: 'btn block', onclick: () => act('admin/users/update', { disabled: !u.disabled }, u.disabled ? 'Account turned back on' : 'Account paused') }, u.disabled ? 'Turn account back on' : 'Pause account'),
          h('button', { class: 'btn block danger', onclick: () => { s.close(); confirmDelete(u); } }, 'Delete account and data'))),
    });
  }

  function confirmDelete(u) {
    const input = h('input', { id: 'ud-confirm', autocomplete: 'off', autocapitalize: 'none' });
    const s = openSheet({
      title: `Delete ${u.name}?`,
      body: h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        try { update(await post('admin/users/delete', { id: u.id, confirm: input.value })); s.close(); toast(`${u.name} deleted`); }
        catch (err) { toast(err.message, 'error'); }
      } },
        h('p', { class: 'note' }, `This permanently deletes ${u.name}’s account with every log, photo, WHOOP connection and reminder. It can’t be undone. Nightly backups keep a copy for up to 30 days.`),
        h('label', { class: 'field', for: 'ud-confirm' }, `Type ${u.username} to confirm`, input),
        h('button', { class: 'btn primary block danger-fill', type: 'submit' }, 'Delete permanently')),
    });
  }

  const nameIn = h('input', { id: 'nu-name', autocomplete: 'off', placeholder: 'Jordan' });
  const userIn = h('input', { id: 'nu-user', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'jordan' });
  let userTouched = false;
  nameIn.addEventListener('input', () => { if (!userTouched) userIn.value = nameIn.value.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 32); });
  userIn.addEventListener('input', () => { userTouched = true; });
  const adminCb = h('input', { type: 'checkbox', id: 'nu-admin' });
  const seedCb = h('input', { type: 'checkbox', id: 'nu-seed', checked: true });
  const addForm = h('form', { class: 'card', 'aria-label': 'Add a user', onsubmit: async (e) => {
    e.preventDefault();
    const btn = addForm.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await post('admin/users/create', { name: nameIn.value.trim(), username: userIn.value.trim(), is_admin: adminCb.checked, seed: seedCb.checked });
      update(r);
      showPassword(r.user, r.temp_password, true);
      nameIn.value = ''; userIn.value = ''; adminCb.checked = false; seedCb.checked = true; userTouched = false;
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
  } },
    h('h2', null, 'Add a user'),
    h('label', { class: 'field', for: 'nu-name' }, 'Name', nameIn),
    h('label', { class: 'field', for: 'nu-user' }, 'Username', userIn),
    h('p', { class: 'note small' }, 'The app makes a temporary password and shows it once. They choose their own the first time they sign in.'),
    h('label', { class: 'check-row', for: 'nu-admin' }, adminCb, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Admin'), h('span', { class: 'small muted' }, 'Can add and manage users'))),
    h('label', { class: 'check-row', for: 'nu-seed' }, seedCb, h('span', { class: 'main' }, h('span', { class: 'title' }, 'Start with the exercise library'), h('span', { class: 'small muted' }, 'The starter exercises and four routines'))),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Create user'));

  draw();
  root.replaceChildren(
    pageHead('Settings, admins only', 'Users'),
    h('div', { class: 'stack', style: { maxWidth: '640px' } },
      listEl, addForm,
      h('section', { class: 'card', style: { gap: '6px' } },
        h('h2', null, 'Everyone’s data is their own'),
        h('p', { class: 'note' }, 'Each person has their own food log, training, body, health, photos, WHOOP connection and reminders. Admins see names and when someone was last active, never anyone else’s data.'))));
}
