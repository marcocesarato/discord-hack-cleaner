const { test } = require('node:test'),
  a = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const ctx = {};
vm.createContext(ctx);
if (fs.existsSync(__dirname + '/../src/cache.js'))
  vm.runInContext(fs.readFileSync(__dirname + '/../src/cache.js', 'utf8'), ctx);
test('cache contains only valid server IDs, channel routes and timestamps; no credentials', () => {
  a.equal(typeof ctx.DiscordAuditCache, 'object');
  const c = ctx.DiscordAuditCache;
  const result = c.clean({
    servers: { ids: ['111', '111', 'bad'], updatedAt: 100 },
    channels: {
      111: { routes: ['/channels/111/222', '/channels/999/222', 'https://evil.test'], updatedAt: 100 },
    },
    token: 'secret',
  });
  a.deepEqual(Array.from(result.servers.ids), ['111']);
  a.deepEqual(Array.from(result.channels['111'].routes), ['/channels/111/222']);
  a.equal(JSON.stringify(result).includes('secret'), false);
  a.equal(c.fresh(result.servers, 1000), true);
  a.equal(c.fresh(result.servers, 100 + 86400001), false);
  a.equal(c.fresh(result.servers, 99), false);
});
test('cached census skips HTML enumeration, refresh forces it, empty results do not become valid cache', async () => {
  const c = ctx.DiscordAuditCache;
  let reads = 0;
  let writes = 0;
  let channelReads = 0;
  const now = Date.now();
  const cache = c.clean({
    servers: { ids: ['111'], updatedAt: now },
    channels: { 111: { routes: ['/channels/111/222'], updatedAt: now } },
  });
  const driver = {
    servers: async () => {
      reads++;
      return ['333'];
    },
    channels: async () => {
      channelReads++;
      return [];
    },
  };
  const wrapper = c.wrap(
    driver,
    cache,
    async () => {
      writes++;
    },
    () => true,
    false,
  );
  a.equal((await wrapper.servers())[0], '111');
  a.equal((await wrapper.channels('111'))[0], '/channels/111/222');
  a.equal(reads + channelReads, 0);
  await c
    .wrap(
      driver,
      cache,
      async () => {
        writes++;
      },
      () => true,
      true,
    )
    .servers();
  a.equal(reads, 1);
  a.equal(writes, 1);
  await wrapper.channels('999');
  a.equal(cache.channels['999'], undefined);
});
