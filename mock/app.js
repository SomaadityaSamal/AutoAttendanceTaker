const $ = id => document.getElementById(id);
const pollId = location.pathname.match(/^\/poll\/([a-f0-9-]+)$/)?.[1];
let current;
let busy = false;
let promptShown = false;
let name = localStorage.getItem('mock-name') || 'Test Participant';
let participant = localStorage.getItem('mock-participant');
if (!participant) { participant = crypto.randomUUID(); localStorage.setItem('mock-participant', participant); }

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error || 'Request failed');
  return value;
}
function failure(error) { $('error').textContent = error.message; $('error').hidden = false; $('connection').textContent = 'Disconnected'; }
function connected() { $('error').hidden = true; $('connection').textContent = 'Local session'; }
function showName() { $('screen-name').value = name; if (!$('name-dialog').open) $('name-dialog').showModal(); }
function render(state) {
  current = state;
  connected();
  if (!pollId) {
    const src = `/api/poll/${state.id}/qr.png`;
    if ($('qr').getAttribute('src') !== src) $('qr').src = src;
    $('participant-link').href = state.url;
    $('poll-id').textContent = `Session ${state.id.slice(0, 8)}`;
    $('count').textContent = state.count;
    $('percentage').textContent = state.count ? '100%' : '0%';
    $('bar').style.width = state.count ? '100%' : '0%';
    $('poll-state').textContent = state.open ? 'Open' : 'Paused';
    $('poll-open').checked = state.open;
    $('name-prompt').checked = state.namePrompt;
  } else {
    $('profile').textContent = `Responding as ${name}`;
    $('waiting').hidden = state.open || state.responded;
    $('answer').hidden = !state.open || state.responded;
    $('confirmation').hidden = !state.responded;
    if (state.namePrompt && !promptShown && !state.responded) { promptShown = true; showName(); }
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  try { render(await api(pollId ? `/api/poll/${pollId}?participant=${participant}` : '/api/current')); }
  catch (error) { failure(error); }
  finally { busy = false; }
}
async function command(button, action) {
  button.disabled = true;
  try { await action(); }
  catch (error) { failure(error); }
  finally { button.disabled = false; }
}
$('presenter').hidden = Boolean(pollId);
$('participant').hidden = !pollId;
$('new-poll').onclick = () => command($('new-poll'), async () => render(await api('/api/new', { open: $('poll-open').checked, namePrompt: $('name-prompt').checked })));
for (const id of ['poll-open', 'name-prompt']) $(id).onchange = () => command($(id), async () => render(await api('/api/settings', { open: $('poll-open').checked, namePrompt: $('name-prompt').checked })));
$('profile').onclick = showName;
$('cancel-name').onclick = () => $('name-dialog').close();
$('name-form').onsubmit = event => {
  event.preventDefault();
  const value = $('screen-name').value.trim();
  if (!value) { $('screen-name').setCustomValidity('Enter a name'); $('screen-name').reportValidity(); return; }
  name = value;
  localStorage.setItem('mock-name', name);
  $('profile').textContent = `Responding as ${name}`;
  $('name-dialog').close();
};
$('screen-name').oninput = () => $('screen-name').setCustomValidity('');
$('yes').onclick = () => command($('yes'), async () => render(await api(`/api/poll/${pollId}/response`, { participant, answer: 'Yes' })));
await refresh();
setInterval(refresh, 700);
