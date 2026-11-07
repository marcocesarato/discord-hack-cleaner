const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const idAt = (date) => String((BigInt(Date.parse(date)) - 1420070400000n) << 22n);
const server = '100000000000000001';
const channel = '100000000000000002';
const author = '100000000000000003';
const other = '100000000000000004';
const attachment = `https://cdn.discordapp.com/attachments/${channel}/100000000000000005/scam.png`;
const hash = 'a'.repeat(64);
const options = {
  server, author, channel, references: [hash],
  start: '2026-11-05T00:00:00.000Z', endExclusive: '2026-11-08T00:00:00.000Z',
};
const first = idAt('2026-11-07T11:00:00Z');
const second = idAt('2026-11-07T10:00:00Z');
const third = idAt('2026-11-07T09:00:00Z');

function loadBot() {
  const context = vm.createContext({
    URL, URLSearchParams, setTimeout: (fn) => fn(), AbortSignal,
    Date: class extends Date { static now() { return Date.parse('2026-11-07T12:00:00Z'); } },
  });
  for (const file of ['core.js', 'bot.js']) vm.runInContext(fs.readFileSync(`${__dirname}/../src/${file}`, 'utf8'), context);
  return vm.runInContext('({ botSearch, botDelete, createBotRequest, canModerateChannel })', context);
}

const row = (id, who = author) => ({ id, author: { id: who }, channel_id: channel, attachments: [{ url: attachment }] });
const match = (id) => ({ id, author, hash, url: `https://discord.com/channels/${server}/${channel}/${id}` });

test('bot search uses the incident boundary, author, attachments, and approved channel scope', async () => {
  const { botSearch } = loadBot();
  const result = await botSearch(async (path) => {
    const params = new URL(path, 'https://discord.com').searchParams;
    assert.equal(params.get('max_id'), first);
    assert.equal(params.get('author_id'), author);
    assert.equal(params.get('has'), 'file');
    assert.equal(params.get('channel_id'), channel);
    return { messages: [[row(first)], [row(second)], [row(third, other)]], total_results: 3 };
  }, { ...options, before: first }, [channel]);
  assert.equal(result.next, second);
  assert.deepEqual(Array.from(result.rows, (row) => row.id), [second]);
  await assert.rejects(botSearch(async () => assert.fail(), { ...options, onlyChannel: other }, [channel]), /approved/);
});

test('bot deletion rechecks current author and attachments and only sends the selected valid IDs', async () => {
  const { botDelete } = loadBot();
  const writes = [];
  const result = await botDelete(async (path, method, body) => {
    if (method) {
      writes.push({ path, method, body });
      return null;
    }
    const id = path.split('/').at(-1);
    return id === channel ? { guild_id: server } : row(id, id === third ? other : author);
  }, { ...options, matches: [match(first), match(second), match(third)] }, async () => hash);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'POST');
  assert.deepEqual(Array.from(writes[0].body.messages), [first, second]);
  assert.equal(result.results.find((entry) => entry.id === third).status, 'unverified');
  await assert.rejects(botDelete(async () => ({ guild_id: other }), {
    ...options, matches: [match(first)],
  }, async () => hash), /outside/);
});

test('a channel overwrite can revoke or grant moderation despite the base guild permissions', () => {
  const { canModerateChannel } = loadBot();
  const role = other;
  const roles = [{ id: server, permissions: '66560' }, { id: role, permissions: '8192' }];
  const member = { user: { id: author }, roles: [role] };
  const base = { guild_id: server, type: 0, permission_overwrites: [] };
  assert.equal(canModerateChannel(server, roles, member, base), true);
  const deny = { id: author, type: 1, deny: '8192', allow: '0' };
  assert.equal(canModerateChannel(server, roles, member, { ...base, permission_overwrites: [deny] }), false);
  const allow = { id: author, type: 1, deny: '0', allow: '8192' };
  assert.equal(canModerateChannel(server, roles, { ...member, roles: [] }, { ...base, permission_overwrites: [allow] }), true);
});

test('a search waits and retries on an index build or rate limit', async () => {
  const { createBotRequest } = loadBot();
  const statuses = [202, 429, 200];
  const request = createBotRequest(async (url, options) => {
    assert.match(url, /^https:\/\/discord\.com\/api\/v10\//);
    assert.equal(options.headers.authorization, 'Bot fixture');
    return new Response(JSON.stringify({ retry_after: 0.01 }), { status: statuses.shift() });
  }, 'fixture');
  assert.equal((await request('/guilds/example/messages/search')).retry_after, 0.01);
  assert.equal(statuses.length, 0);
});
