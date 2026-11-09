async function openPanel(mode) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https:\/\/discord\.com\/channels\//.test(tab.url || ''))
      throw Error('Open Discord in this tab, then try again.');
    const stylesheet = await fetch(chrome.runtime.getURL('src/ui.css'));
    if (!stylesheet.ok) throw Error('Could not load the panel theme. Reload the extension and try again.');
    const loadReferences = (file) =>
      fetch(chrome.runtime.getURL(file))
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => []);
    const [bundledReferences, localReferences] = await Promise.all([
      loadReferences('src/reference-images.json'),
      loadReferences('reference-images.local.json'),
    ]);
    const [existing] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (css, mode, bundledReferences, localReferences) => {
        globalThis.DiscordAuditStyles = css;
        globalThis.DiscordAuditMode = mode;
        globalThis.DiscordAuditBundledReferences = Array.isArray(bundledReferences) ? bundledReferences : [];
        globalThis.DiscordAuditLocalReferences = Array.isArray(localReferences) ? localReferences : [];
        return globalThis.DiscordAuditPanel?.show(mode) === true;
      },
      args: [await stylesheet.text(), mode, bundledReferences, localReferences],
    });
    if (!existing?.result) {
      const files = [
        'core.js',
        'scan-state.js',
        'cache.js',
        'navigation.js',
        'dom-navigation.js',
        'data-package.js',
        'report-model.js',
        'scanner.js',
      ];
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: files.map((file) => 'src/' + file),
      });
    }
    window.close();
  } catch (e) {
    document.querySelector('#status').textContent = e.message;
  }
}
for (const button of document.querySelectorAll('[data-mode]'))
  button.onclick = () => openPanel(button.dataset.mode);
const firstRun = document.querySelector('#first-run');
const guideSeenKey = 'discordCleanupRecoveryGuideSeen_v1';
chrome.storage.local
  .get(guideSeenKey)
  .then((items) => {
    firstRun.hidden = items[guideSeenKey] === true;
  })
  .catch(() => {
    firstRun.hidden = false;
  });
document.querySelector('#dismiss-first-run').onclick = async () => {
  firstRun.hidden = true;
  try {
    await chrome.storage.local.set({ [guideSeenKey]: true });
  } catch {
    document.querySelector('#status').textContent = 'Could not save the recovery guide preference.';
  }
};
