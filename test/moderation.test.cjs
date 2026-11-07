const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({ AbortSignal });
for (const file of ['core.js', 'moderation.js']) {
  if (fs.existsSync(__dirname + '/../src/' + file))
    vm.runInContext(fs.readFileSync(__dirname + '/../src/' + file, 'utf8'), ctx);
}
const user = '100000000000000001';
const server = '111';
const token = 'fixture-access-token';
test('moderation requires the configured user and owner or server-level moderation permissions', async () => {
  const guild = (permissions, owner = false) => ({ id: server, owner, permissions });
  for (const permitted of [guild('0', true), guild('8'), guild('8192')]) {
    const check = ctx.createModerationCheck(async (url) => ({
      status: 200,
      json: async () => (url.endsWith('/@me') ? { id: user } : [permitted]),
    }));
    assert.equal((await check({ server, token, author: user })).allowed, true);
  }
  for (const [account, permissions] of [
    ['999', '8192'],
    [user, '32'],
    [user, '0'],
  ]) {
    const check = ctx.createModerationCheck(async (url) => ({
      status: 200,
      json: async () => (url.endsWith('/@me') ? { id: account } : [guild(permissions)]),
    }));
    await assert.rejects(() => check({ server, token, author: user }));
  }
});
test('moderation results allow review of other authors but the deletion plan excludes them', () => {
  const hash = 'a'.repeat(64);
  const id = String((BigInt(Date.parse('2025-01-15T03:16:00Z')) - 1420070400000n) << 22n);
  const match = { id, author: '999', hash, url: `https://discord.com/channels/${server}/222/${id}` };
  const window = { start: '2025-01-15T02:00:00Z', endExclusive: '2025-01-15T07:00:00Z' };
  assert.equal(ctx.DiscordAudit.resultPlan([match], [hash], window, user, true).length, 1);
  assert.equal(ctx.DiscordAudit.deletionPlan([match], [hash], window, user).length, 0);
});
test('owner launcher lists only owned servers for the configured account', async () => {
  const guilds = [
    { id: '111', name: 'Owned', owner: true, permissions: '0' },
    { id: '222', name: 'Admin only', owner: false, permissions: '8' },
  ];
  const fetch = async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${token}`);
    return { status: 200, json: async () => (url.endsWith('/@me') ? { id: user } : guilds) };
  };
  const result = await ctx.createOwnedServerList(fetch)({ token, author: user });
  assert.deepEqual(
    Array.from(result.servers, (item) => item.id),
    ['111'],
  );
});
