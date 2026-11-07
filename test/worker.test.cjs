const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const author = '100000000000000001';
const otherAuthor = '100000000000000002';
const token = 'fixture-oauth-access-token';
const sender = { tab: { url: 'https://discord.com/channels/@me' }, frameId: 0 };

function mountWorker({ fetchBot, guildPermissions } = {}) {
  let receive;
  const saved = {};
  const session = {};
  const context = vm.createContext({
    AbortSignal,
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: saved[key] }),
          set: async (values) => Object.assign(saved, structuredClone(values)),
          remove: async (key) => delete saved[key],
        },
        session: {
          get: async (key) => ({ [key]: session[key] }),
          set: async (values) => Object.assign(session, structuredClone(values)),
          remove: async (keys) => {
            for (const key of [keys].flat()) delete session[key];
          },
        },
      },
      runtime: { onMessage: { addListener: (listener) => (receive = listener) } },
    },
    fetch: async (url, options) => {
      if (options.headers.authorization.startsWith('Bot ')) return fetchBot(url, options);
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return {
        status: 200,
        json: async () =>
          url.endsWith('/@me') ? { id: author } : [
            guildPermissions ? { id: '123', permissions: guildPermissions } : { id: '123', name: 'Owned', owner: true },
          ],
      };
    },
    importScripts: (...files) => files.forEach(load),
  });
  function load(file) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
  }
  load('worker.js');
  return (message) => new Promise((resolve) => receive(message, sender, resolve));
}

test('only verified OAuth2 credentials are reused for the same account and can be forgotten', async () => {
  const send = mountWorker();
  assert.ok((await send({ type: 'saveOAuthToken', author: otherAuthor, token })).error);
  assert.equal((await send({ type: 'oauthTokenStatus', author: otherAuthor })).saved, false);
  const first = await send({ type: 'saveOAuthToken', author, token });
  assert.equal(first.ok, true);
  assert.equal(JSON.stringify(first).includes(token), false);
  assert.equal((await send({ type: 'oauthTokenStatus', author })).saved, true);
  assert.equal((await send({ type: 'listOwnedServers', author })).servers[0].id, '123');
  assert.ok((await send({ type: 'listOwnedServers', author: otherAuthor })).error);
  assert.equal((await send({ type: 'forgetOAuthToken', author })).ok, true);
  assert.equal((await send({ type: 'oauthTokenStatus', author })).saved, false);
  assert.ok((await send({ type: 'listOwnedServers', author })).error);
});

test('cache reads and clearing are scoped to the configured user', async () => {
  const send = mountWorker();
  const cache = { servers: { ids: ['123'], updatedAt: 100 } };
  await send({ type: 'auditCacheWrite', author, cache });
  assert.equal((await send({ type: 'auditCacheRead', author })).cache.servers.ids[0], '123');
  assert.equal((await send({ type: 'auditCacheRead', author: otherAuthor })).cache.servers.ids.length, 0);
  await send({ type: 'auditCacheClear', author: otherAuthor });
  assert.equal((await send({ type: 'auditCacheRead', author })).cache.servers.ids.length, 1);
});

test('an OAuth2 token can resolve the account ID without a copied ID', async () => {
  const send = mountWorker();
  const result = await send({ type: 'saveOAuthToken', token });
  assert.equal(result.author, author);
  assert.equal((await send({ type: 'oauthTokenStatus', author })).saved, true);
});

test('bot deletion checks fresh channel permission before reading or deleting messages', async () => {
  const channel = '100000000000000005';
  const calls = [];
  let allow = true;
  const send = mountWorker({
    guildPermissions: '8192',
    fetchBot: async (url, options) => {
      const path = new URL(url).pathname.replace('/api/v10', '');
      calls.push([options.method, path]);
      const metadata = { id: channel, guild_id: '123', type: 0,
        permission_overwrites: allow ? [] : [{ id: author, type: 1, allow: '0', deny: '8192' }] };
      const body = {
        '/users/@me': { bot: true },
        '/guilds/123': { id: '123' },
        '/guilds/123/roles': [{ id: '123', permissions: '74752' }],
        [`/guilds/123/members/${author}`]: { user: { id: author }, roles: [] },
        '/guilds/123/channels': [metadata],
        [`/channels/${channel}`]: metadata,
      }[path];
      assert.ok(body, path);
      return new Response(JSON.stringify(body), { status: 200 });
    },
  });
  await send({ type: 'saveOAuthToken', author, token });
  assert.equal((await send({ type: 'saveBot', author, token: 'fixture-bot-token-value' })).ok, true);
  assert.equal((await send({ type: 'authorizeBot', author, server: '123' })).allowed, true);
  allow = false;
  const result = await send({ type: 'botDelete', author, server: '123', channel });
  assert.match(result.error, /cannot moderate/);
  assert.ok(calls.every(([method, path]) => method === 'GET' && !path.includes('/messages')));
});
