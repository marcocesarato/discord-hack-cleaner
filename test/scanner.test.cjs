const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settingsKey = 'discordCleanupSettings_v1';
const checkpointKey = 'discordCleanupScanCheckpoint_v1';
const userId = '100000000000000001';

async function mountScanner({
  storage = {},
  onOpen = () => {},
  upload = true,
  configure = true,
  owner = false,
  secondMatch = false,
  extraChannel = false,
  failingChannel = true,
  defaultHashes = [],
  bundledHashes = [],
  saveCheckpointError = () => null,
  confirmClose = () => false,
} = {}) {
  const controls = [];
  function element(tag) {
    return {
      tag,
      children: [],
      textContent: '',
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      attachShadow() {
        return element('shadow');
      },
      setAttribute() {},
      remove() {
        this.removed = true;
      },
      style: {},
    };
  }
  const routes = owner
    ? ['/channels/111/1154', '/channels/222/9999']
    : Array.from({ length: 155 }, (_, index) => `/channels/@me/${1000 + index}`);
  const matchRoute = owner ? routes[0] : routes.at(-1);
  if (extraChannel) routes.push('/channels/@me/1155');
  const location = { pathname: '/channels/@me', href: 'https://discord.com/channels/@me' };
  const historyCalls = [];
  let scrolled = false;
  const messageId = String((BigInt(Date.parse('2026-07-03T10:16:00Z')) - 1420070400000n) << 22n);
  const author = owner ? '100000000000000002' : userId;
  const attachment = 'https://cdn.discordapp.com/attachments/1154/456/1.webp';
  const nonmatchingAttachment = 'https://cdn.discordapp.com/attachments/1154/455/other.webp';
  const message = {
    id: `chat-messages-1154-${messageId}`,
    querySelectorAll(selector) {
      return selector.startsWith('img')
        ? [{ src: `https://cdn.discordapp.com/avatars/${author}/test.png`, closest: () => null }]
        : [{ href: nonmatchingAttachment }, { href: attachment }];
    },
  };
  const messages = secondMatch
    ? [message, { ...message, id: `chat-messages-1154-${BigInt(messageId) + (60000n << 22n)}` }]
    : [message];
  const batch = { routes, issues: [], label: owner ? 'Server' : 'DM' };
  const visited = [];
  const selectedServers = [];
  const messagesToWorker = [];
  const context = vm.createContext({
    DiscordAuditMode: owner ? 'owner' : 'user',
    DiscordAuditBundledReferences: bundledHashes,
    DiscordAuditLocalReferences: defaultHashes,
    URL,
    location,
    setTimeout: (callback) => callback(),
    history: {
      state: { idx: 0 },
      pushState(state, _title, path) {
        historyCalls.push(path);
        location.pathname = path;
      },
    },
    PopStateEvent: class {},
    dispatchEvent() {},
    confirm: confirmClose,
    crypto: { subtle: { digest: async () => new Uint8Array(32).fill(0xaa) } },
    document: {
      body: element('body'),
      createTextNode: (text) => text,
      getElementById: (id) =>
        id === 'message-content-' + messageId
          ? { textContent: '@everyone' }
          : messages.some((row) => row.id === id && location.pathname.endsWith('/' + id.split('-').at(-1)))
            ? {
                scrollIntoView() {
                  scrolled = true;
                },
              }
            : null,
      querySelector: (selector) => selector.includes('channelWelcome') ? {} : null,
      querySelectorAll(selector) {
        if (selector === '[id^="chat-messages-"]' && location.pathname === matchRoute) return messages;
        if (!owner) return [];
        if (selector.startsWith('nav a'))
          return [
            {
              getAttribute: (attr) => (attr === 'href' ? matchRoute : 'text channel'),
              querySelectorAll: () => [],
            },
          ];
        if (selector.includes('channelTextArea'))
          return [
            {
              closest: () => null,
              getClientRects: () => [{}],
              getAttribute: () => 'true',
              hasAttribute: () => false,
            },
          ];
        return [];
      },
      createElement(tag) {
        const node = element(tag);
        controls.push(node);
        return node;
      },
    },
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] }),
          set: async (values) => {
            if (checkpointKey in values) {
              const error = saveCheckpointError();
              if (error) throw error;
            }
            Object.assign(storage, structuredClone(values));
          },
        },
      },
      runtime: {
        sendMessage: async ({ type, url, author, token, section }) => {
          messagesToWorker.push({ type, author, token, section });
          if (type === 'attachmentHash') return { hash: (url === attachment ? 'aa' : 'cc').repeat(32) };
          if (type === 'listOwnedServers') return { servers: [{ id: '111', name: 'Owned server' }] };
          if (type === 'saveOAuthToken') return { ok: true };
          return { cache: { servers: { ids: [] }, channels: {} } };
        },
      },
    },
    createAuditNavigation: () => ({
      discover: async () => batch,
      async *batches() {
        yield batch;
      },
    }),
    createAuditDOMDriver: () => ({
      describe: () => ({ channelName: 'Test conversation' }),
      async selectServer(server) {
        selectedServers.push(server);
        location.pathname = `/channels/${server}`;
        return true;
      },
      async open(route) {
        visited.push(route);
        if (failingChannel && route === routes[1]) throw Error('Simulated navigation failure');
        location.pathname = route;
        onOpen(route, controls);
        return true;
      },
    }),
    DiscordAuditCache: { wrap: (driver) => driver, clean: (cache) => cache },
  });
  for (const name of ['core.js', 'scan-state.js', 'report-model.js', 'scanner.js']) {
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${name}`, 'utf8'), context);
  }
  await new Promise((resolve) => setImmediate(resolve));
  if (configure && !storage[settingsKey]) {
    const account = controls.find((node) => node.id === 'discord-user-id');
    account.value = userId;
    controls.find((node) => node.id === 'scan-scope').value = 'dm';
    const [startTime, endTime] = controls.filter((node) => node.type === 'datetime-local');
    startTime.value = context.DiscordAudit.localInput('2026-07-03T10:00:00Z');
    endTime.value = context.DiscordAudit.localInput('2026-07-03T10:30:00Z');
    await controls.find((node) => node.title === 'Save settings').onclick();
  }
  const file = controls.find((node) => node.accept === 'image/*');
  if (upload) {
    file.files = [{ size: 1, arrayBuffer: async () => new Uint8Array([1]) }];
    await file.onchange();
  }
  return {
    controls,
    visited,
    routes,
    historyCalls,
    selectedServers,
    messagesToWorker,
    didScroll: () => scrolled,
    button: (label) => controls.find((node) => node.textContent === label || node.title === label),
  };
}

test('clean install has no account or reference images and local settings survive a new panel', async () => {
  const clean = await mountScanner({ upload: false, configure: false });
  await clean.button('Start scan').onclick();
  assert.ok(clean.button('Save your Discord user ID in Settings before scanning.'));
  assert.ok(clean.button('No images selected'));
  const storage = {};
  await mountScanner({ storage });
  const restored = await mountScanner({ storage, upload: false, configure: false });
  await restored.button('Start scan').onclick();
  assert.ok(restored.button('Open message'));
  assert.ok(
    restored.controls.some((node) => node.className === 'mention-tag' && node.children.includes('@everyone')),
  );
  assert.deepEqual(storage[checkpointKey].report.referenceHashes, ['aa'.repeat(32)]);
});

test('scanner uses the selected dates beyond channel 150 and continues after a channel error', async () => {
  const { controls, visited, routes, button } = await mountScanner();
  await button('Start scan').onclick();
  assert.deepEqual(visited, routes);
  assert.ok(controls.some((node) => node.textContent.startsWith('Exact match')));
  assert.deepEqual(
    controls.filter((node) => node.className === 'result-name').map((node) => node.textContent),
    ['Direct messages', 'Test conversation'],
  );
  assert.deepEqual(
    controls.filter((node) => node.className === 'result-count').map((node) => node.textContent),
    ['1', '1'],
  );
});

test('scan results open in a separate panel beside the scanner', async () => {
  const panel = await mountScanner();
  await panel.button('Start scan').onclick();
  const results = panel.controls.find((node) => node.id === 'cleanup-results');
  const body = panel.controls.find((node) => node.id === 'cleanup-panel-body');
  const matches = panel.controls.find((node) => node.className === 'match-list');
  assert.equal(results.hidden, true);
  assert.ok(results.children[1].children.includes(matches));
  panel.button('Results · 1').onclick();
  assert.equal(results.hidden, false);
  assert.notEqual(body.hidden, true);
  panel.button('Settings').onclick();
  assert.equal(results.hidden, true);
  panel.button('Results · 1').onclick();
  assert.equal(panel.controls.find((node) => node.id === 'cleanup-settings').hidden, true);
  panel.button('Close results').onclick();
  assert.equal(results.hidden, true);
});

test('the default panel keeps search and data import in a closed disclosure', async () => {
  const panel = await mountScanner();
  const body = panel.controls.find((node) => node.id === 'cleanup-panel-body');
  const footer = panel.controls.find((node) => node.className === 'panel-footer');
  const tools = body.children.find((node) => node.className === 'scan-tools');
  assert.equal(tools.tag, 'details');
  assert.ok(!tools.open);
  assert.ok(tools.children[1].children.some((section) => section.children.some((row) =>
    row.children.includes(panel.button('Copy Discord search')))));
  assert.ok(footer.children.at(-1).children.includes(panel.button('Start scan')));
  assert.ok(footer.children.at(-1).children.includes(panel.button('Results')));
  assert.equal(panel.button('Pause').hidden, true);
  assert.equal(panel.button('Stop').hidden, true);
});

test('pause preserves the channel queue, stop saves it, and a new panel resumes it', async () => {
  const storage = {};
  const first = await mountScanner({
    storage,
    onOpen(route, controls) {
      if (route.endsWith('/1000')) controls.find((node) => node.textContent === 'Pause').onclick();
      if (route.endsWith('/1002')) controls.find((node) => node.textContent === 'Stop').onclick();
    },
  });
  const run = first.button('Start scan').onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.visited.length, 1);
  assert.ok(first.button('Resume'));
  first.button('Resume').onclick();
  await run;
  const checkpoint = storage[checkpointKey];
  assert.equal(checkpoint.finished, false);
  assert.deepEqual(checkpoint.pending.slice(0, 2), ['/channels/@me/1001', '/channels/@me/1002']);
  delete storage[settingsKey];
  const next = await mountScanner({ storage, upload: false, configure: false, failingChannel: false });
  assert.equal(next.button('Resume saved scan').disabled, false);
  await next.button('Resume saved scan').onclick();
  assert.deepEqual(next.visited, next.routes.slice(1));
  assert.equal(storage[checkpointKey].report.matches.length, 1);
  assert.equal(storage[checkpointKey].report.matches[0].channelName, 'Test conversation');
  assert.equal(storage[checkpointKey].finished, true);
});

test('Stop releases a paused scan without starting another channel', async () => {
  const first = await mountScanner({
    onOpen(route, controls) {
      if (route.endsWith('/1000')) controls.find((node) => node.textContent === 'Pause').onclick();
    },
  });
  const run = first.button('Start scan').onclick();
  await new Promise((resolve) => setImmediate(resolve));
  first.button('Stop').onclick();
  await run;
  assert.equal(first.visited.length, 1);
  assert.equal(first.button('Start scan').disabled, false);
});

test('opening a match after a scan uses same-document history and waits for the message row', async () => {
  const panel = await mountScanner({ secondMatch: true });
  await panel.button('Start scan').onclick();
  const nav = panel.controls.find((node) => node.className === 'match-nav');
  assert.equal(nav.hidden, true);
  const link = panel.button('Open message');
  let prevented = false;
  await link.onclick({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.deepEqual(panel.historyCalls, [new URL(link.href).pathname]);
  assert.equal(panel.didScroll(), true);
  const panelBody = panel.controls.find((node) => node.className === 'panel-body');
  const panelFooter = panel.controls.find((node) => node.className === 'panel-footer');
  const position = panel.controls.find((node) => node.className === 'match-position');
  assert.equal(panelBody.hidden, true);
  assert.equal(nav.hidden, false);
  assert.equal(panelFooter.hidden, true);
  assert.equal(position.textContent, '1 / 2');
  await panel.button('›').onclick();
  assert.equal(position.textContent, '2 / 2');
  assert.equal(panel.historyCalls.length, 2);
  assert.equal(panel.button('›').disabled, true);
  await panel.button('‹').onclick();
  assert.equal(position.textContent, '1 / 2');
  assert.equal(panel.historyCalls.length, 3);
  panel.button('Expand').onclick();
  assert.equal(panelBody.hidden, false);
  assert.equal(nav.hidden, true);
  assert.equal(panelFooter.hidden, false);
});

test('the empty collapsed toolbar hides match navigation and closing requires confirmation', async () => {
  let confirmed = false;
  const panel = await mountScanner({ confirmClose: () => confirmed });
  const host = panel.controls.find((node) => node.id === 'discord-exact-audit');
  panel.button('Collapse').onclick();
  assert.equal(panel.controls.find((node) => node.className === 'match-nav').hidden, true);
  assert.equal(panel.button('Close').hidden, undefined);
  panel.button('Close').onclick();
  assert.equal(host.removed, undefined);
  confirmed = true;
  panel.button('Close').onclick();
  assert.equal(host.removed, true);
});

test('results contain review actions and settings contain the save and FAQ controls', async () => {
  const panel = await mountScanner();
  const settings = panel.controls.find((node) => node.id === 'cleanup-settings');
  const [header, body] = settings.children;
  assert.ok(header.children[1].children.includes(panel.button('Save settings')));
  assert.ok(header.children[1].children.includes(panel.button('Close settings')));
  const results = panel.controls.find((node) => node.id === 'cleanup-results');
  assert.ok(results.children[1].children.some((node) => node.children.includes(panel.button('Review selected matches'))));
  await panel.button('How to get an OAuth2 access token').onclick();
  assert.equal(panel.messagesToWorker.at(-1).section, 'oauth2');
  await panel.button('FAQ').onclick();
  assert.equal(panel.messagesToWorker.at(-1).section, undefined);
});

test('owner mode scans all authors in the selected owned server only', async () => {
  const panel = await mountScanner({ owner: true });
  await panel.button('Start scan').onclick();
  assert.deepEqual(panel.visited, []);
  const token = panel.controls.find((node) => node.id === 'discord-oauth-token');
  token.value = 'test';
  await panel.button('Save settings').onclick();
  assert.equal(token.value, '');
  assert.ok(
    panel.messagesToWorker.some((message) => message.type === 'saveOAuthToken' && message.author === userId),
  );
  await panel.button('Load owned servers').onclick();
  await panel.button('Start scan').onclick();
  assert.deepEqual(panel.selectedServers, ['111']);
  assert.deepEqual(panel.visited, ['/channels/111/1154']);
  assert.equal(new URL(panel.button('Open message').href).pathname.split('/')[2], '111');
  assert.ok(panel.controls.some((node) => node.children.includes('Other author')));
  assert.equal(panel.button('Delete selected with bot…').hidden, true);
});

test('a completed scan displays saved matches when the panel opens', async () => {
  const storage = {};
  const first = await mountScanner({ storage, failingChannel: false });
  await first.button('Start scan').onclick();
  const reopened = await mountScanner({ storage, upload: false, configure: false });
  assert.ok(reopened.button('Open message'));
  assert.ok(reopened.button('Finished scan restored.'));
  assert.equal(reopened.button('Resume saved scan').disabled, true);
  assert.equal(reopened.button('Save in browser').disabled, false);
});

test('import restores checkpoint matches and accepts a report without replacing the checkpoint', async () => {
  const source = {};
  await (await mountScanner({ storage: source, failingChannel: false })).button('Start scan').onclick();
  const storage = {};
  const panel = await mountScanner({ storage, upload: false, configure: false });
  const savedSection = panel.controls.find(
    (node) => node.tag === 'details' && node.children[0]?.textContent === 'Saved scan',
  );
  assert.ok(savedSection.children[1].children[1].children.includes(panel.button('Import scan or report')));
  const input = panel.controls.find((node) => node.accept === '.json,application/json');
  const importFile = async (value) => {
    input.files = [{ size: 11 * 1024 * 1024, text: async () => JSON.stringify(value) }];
    await input.onchange();
  };
  await importFile(source[checkpointKey]);
  assert.equal(storage[checkpointKey].report.matches.length, 1);
  assert.ok(panel.button('Finished scan restored.'));
  await importFile({ matches: source[checkpointKey].report.matches });
  assert.ok(panel.button('Report imported for review · 1 match · 0 skipped entries.'));
  assert.equal(storage[checkpointKey].report.matches.length, 1);
  assert.equal(panel.button('Delete selected with bot…').hidden, true);
  panel.button('Show saved scan').onclick();
  assert.ok(panel.button('Finished scan restored.'));
});

test('a browser save error preserves the checkpoint and can be retried', async () => {
  const storage = {};
  let fail = true;
  const panel = await mountScanner({
    storage,
    saveCheckpointError: () => fail && Error('QUOTA_BYTES quota exceeded'),
  });
  await panel.button('Start scan').onclick();
  assert.equal(storage[checkpointKey], undefined);
  assert.ok(
    panel.button(
      'Browser save failed. QUOTA_BYTES quota exceeded Use Export scan state to keep your progress.',
    ),
  );
  assert.equal(panel.button('Export scan state').disabled, false);
  fail = false;
  await panel.button('Save in browser').onclick();
  assert.ok(panel.button('Scan saved in this browser.'));
  assert.equal(storage[checkpointKey].report.matches.length, 1);
  const reopened = await mountScanner({ storage, upload: false });
  assert.ok(reopened.button('Open message'));
});

test('local default images allow a scan without an upload', async () => {
  const panel = await mountScanner({ upload: false, defaultHashes: ['aa'.repeat(32)] });
  assert.ok(panel.button('1 default images'));
  await panel.button('Start scan').onclick();
  assert.ok(panel.button('Open message'));
});

test('bundled and local references are merged without counting duplicates', async () => {
  const storage = {};
  const bundled = 'aa'.repeat(32);
  const local = 'bb'.repeat(32);
  const panel = await mountScanner({ storage, upload: false, bundledHashes: [bundled], defaultHashes: [bundled, local] });
  assert.ok(panel.button('2 default images'));
  await panel.button('Start scan').onclick();
  assert.deepEqual(storage[checkpointKey].report.referenceHashes, [bundled, local]);
  assert.ok(panel.button('Open message'));
});

test('suspicious-only scans retain review results without adding exact matches', async () => {
  const storage = {};
  const panel = await mountScanner({ storage, upload: false });
  const option = panel.controls.find(
    (node) => node.textContent === 'Flag suspicious messages',
  );
  const label = panel.controls.find((node) => node.children.includes(option));
  label.children[0].checked = true;
  await panel.button('Start scan').onclick();
  assert.ok(panel.button('Suspicious messages · 1'));
  assert.equal(storage[checkpointKey].report.matches.length, 0);
  assert.deepEqual(storage[checkpointKey].report.suspicious[0].reasons, ['Mass mention + image attachment']);
  assert.equal(panel.button('Review selected matches').disabled, true);
  const reopened = await mountScanner({ storage, upload: false, configure: false });
  assert.ok(reopened.button('Suspicious messages · 1'));
});

test('match count stays visible while opening the next channel', async () => {
  const snapshots = [];
  const panel = await mountScanner({
    extraChannel: true,
    onOpen(route, controls) {
      if (!route.endsWith('/1000') && !route.endsWith('/1155')) return;
      const count = controls.find((node) => node.className === 'progress-matches');
      const status = controls.find((node) => node.className === 'status');
      snapshots.push([count.hidden, count.textContent, status.textContent.endsWith('Opening…')]);
    },
  });
  await panel.button('Start scan').onclick();
  assert.deepEqual(snapshots, [
    [false, '0 matches found', true],
    [false, '1 match found', true],
  ]);
});
