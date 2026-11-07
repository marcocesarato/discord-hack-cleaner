let entries = [],
  index = 0,
  messageTab = null,
  busy = false;
const $ = (selector) => document.querySelector(selector);
function render() {
  $('#viewer').hidden = !entries.length;
  if (!entries.length) return;
  const entry = entries[index];
  $('#position').textContent =
    `Message ${index + 1} of ${entries.length} · ${entries.filter((row) => row.reviewed).length} reviewed · ID ${entry.id}`;
  $('#date').textContent =
    new Date(entry.time).toLocaleString('en-GB', { timeZone: 'Europe/Rome' }) + ' · Rome time';
  $('#message-link').href = entry.url;
  $('#message-link').textContent = entry.url;
  $('#reviewed').checked = entry.reviewed;
  $('#previous').disabled = busy || index === 0;
  $('#next').disabled = busy || index === entries.length - 1;
  $('#open').disabled = busy;
}
$('#choose-report').onclick = () => $('#report-file').click();
$('#report-file').onchange = async () => {
  if (busy) return;
  try {
    const file = $('#report-file').files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw Error('Choose a report under 10 MB.');
    const imported = DiscordReport.parse(await file.text());
    if ($('#report-file').files[0] !== file) return;
    entries = imported.entries;
    index = 0;
    $('#report-name').textContent = file.name;
    $('#status').textContent =
      `${entries.length} valid links · ${imported.ignored} duplicate or invalid entries skipped.`;
    $('#open-status').textContent = '';
    render();
  } catch (e) {
    $('#status').textContent = e.message;
  }
};
async function openMessage(step = 0) {
  if (busy || !entries.length) return;
  index = Math.min(entries.length - 1, Math.max(0, index + step));
  busy = true;
  $('#report-file').disabled = true;
  $('#choose-report').disabled = true;
  render();
  try {
    const url = entries[index].url;
    if (messageTab !== null) {
      try {
        await chrome.tabs.update(messageTab, { url, active: true });
      } catch {
        messageTab = null;
      }
    }
    if (messageTab === null) {
      const tab = await chrome.tabs.create({ url, active: true });
      messageTab = tab.id;
    }
    $('#open-status').textContent =
      'Message opened in Discord. Return here when you’re ready for the next one.';
  } catch (e) {
    $('#open-status').textContent = 'Could not open the message. ' + e.message;
  } finally {
    busy = false;
    $('#report-file').disabled = false;
    $('#choose-report').disabled = false;
    render();
  }
}
$('#open').onclick = () => openMessage();
$('#previous').onclick = () => openMessage(-1);
$('#next').onclick = () => openMessage(1);
$('#reviewed').onchange = () => {
  entries[index].reviewed = $('#reviewed').checked;
  render();
};
$('#export').onclick = () => {
  const blob = new Blob([JSON.stringify(DiscordReport.export(entries), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'discord-review-progress.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
