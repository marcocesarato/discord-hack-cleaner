const store = {
  discordCleanupSettings_v1: {
    author: '100000000000000003',
    scope: 'current',
    from: '2026-11-06T03:00',
    to: '2026-11-06T08:00',
  },
};

globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => ({ [key]: store[key] }),
      set: async (values) => Object.assign(store, values),
    },
  },
  runtime: {
    sendMessage: async ({ type }) => {
      if (type === 'auditCacheRead') return { cache: { servers: { ids: [], updatedAt: 0 }, channels: {} } };
      if (type === 'botStatus' || type === 'oauthTokenStatus') return { saved: false };
      return { error: 'This preview uses example data.' };
    },
  },
};

const attachShadow = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) {
  if (this.id === 'discord-exact-audit') return this;
  return attachShadow.call(this, options);
};

const styles = await fetch('/src/ui.css');
if (!styles.ok) throw Error('Could not load the scanner styles.');
const panelStyles = (await styles.text()).replace(/:host\(([^)]+)\)/g, ':scope$1').replace(/:host|:root/g, ':scope');
const style = document.createElement('style');
style.textContent = `@scope (#discord-exact-audit) { ${panelStyles} }`;
document.head.append(style);

try {
  for (const file of [
    'core.js', 'scan-state.js', 'cache.js', 'navigation.js', 'dom-navigation.js',
    'data-package.js', 'report-model.js', 'scanner.js',
  ]) await import('/src/' + file);
} finally {
  Element.prototype.attachShadow = attachShadow;
}
