const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('popup loads the bundled catalog independently of optional local references', async () => {
  const repo = path.join(__dirname, '..');
  const [launch, dismiss] = [{ dataset: { mode: 'user' } }, {}];
  const context = vm.createContext({
    chrome: {
      tabs: { query: async () => [{ id: 1, url: 'https://discord.com/channels/@me' }] },
      runtime: { getURL: (file) => file },
      storage: { local: { get: async () => ({}) } },
      scripting: {
        executeScript: async ({ func, args }) => {
          if (func) context.invoke = () => vm.runInContext(`(${func})(...${JSON.stringify(args)})`, context);
          return [{ result: true }];
        },
      },
    },
    document: {
      querySelectorAll: () => [launch],
      querySelector: (selector) => selector === '#dismiss-first-run' ? dismiss : {},
    },
    fetch: async (file) => ({
      ok: fs.existsSync(path.join(repo, file)) && file !== 'reference-images.local.json',
      text: async () => '',
      json: async () => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8')),
    }),
    window: { close() {} },
  });

  vm.runInContext(fs.readFileSync(path.join(repo, 'src/popup.js'), 'utf8'), context);
  await launch.onclick();
  context.invoke();
  assert.equal(context.DiscordAuditBundledReferences?.length, 5);
  assert.ok(context.DiscordAuditBundledReferences.every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  assert.equal(context.DiscordAuditLocalReferences.length, 0);
});
