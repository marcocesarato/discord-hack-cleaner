const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = {};
vm.createContext(context);
if (fs.existsSync(__dirname + '/../src/navigation.js'))
  vm.runInContext(fs.readFileSync(__dirname + '/../src/navigation.js', 'utf8'), context);
test('server scope selects every discovered server and collects its channels without manual selection', async () => {
  assert.equal(typeof context.createAuditNavigation, 'function');
  const selected = [];
  const driver = {
    servers: async () => ['111', '222'],
    selectServer: async (id) => {
      selected.push(id);
      return true;
    },
    channels: async (id) => [`/channels/${id}/123`],
    selectDM: async () => {
      throw Error('DM must not open');
    },
    dms: async () => [],
  };
  const nav = context.createAuditNavigation(driver, () => true);
  const result = await nav.discover('servers');
  assert.deepEqual(selected, ['111', '222']);
  assert.deepEqual(Array.from(result.routes), ['/channels/111/123', '/channels/222/123']);
});
test('DM scope skips servers and both includes DMs, reporting failed server selection', async () => {
  let serverCalls = 0;
  const driver = {
    servers: async () => {
      serverCalls++;
      return ['111'];
    },
    selectServer: async () => false,
    channels: async () => [],
    selectDM: async () => true,
    dms: async () => ['/channels/@me/333'],
  };
  const nav = context.createAuditNavigation(driver, () => true);
  assert.equal((await nav.discover('dm')).routes[0], '/channels/@me/333');
  assert.equal(serverCalls, 0);
  const both = await nav.discover('both');
  assert.equal(serverCalls, 1);
  assert.equal(both.issues.length, 1);
  assert.equal(both.routes[0], '/channels/@me/333');
});
test('stop prevents further server selections', async () => {
  let active = true;
  const selected = [];
  const driver = {
    servers: async () => ['111', '222'],
    selectServer: async (id) => {
      selected.push(id);
      active = false;
      return true;
    },
    channels: async () => [],
    selectDM: async () => true,
    dms: async () => [],
  };
  await context.createAuditNavigation(driver, () => active).discover('servers');
  assert.deepEqual(selected, ['111']);
});
test('current server scope collects only that server without selecting others or DMs', async () => {
  const calls = [];
  const driver = {
    servers: async () => {
      throw Error('No enumeration');
    },
    selectServer: async () => {
      throw Error('No switching');
    },
    channels: async (id) => {
      calls.push(id);
      return [`/channels/${id}/123`];
    },
    selectDM: async () => {
      throw Error('No DM');
    },
  };
  const result = await context.createAuditNavigation(driver, () => true).discover('current', '222');
  assert.deepEqual(calls, ['222']);
  assert.deepEqual(Array.from(result.routes), ['/channels/222/123']);
  const invalid = await context.createAuditNavigation(driver, () => true).discover('current', '@me');
  assert.equal(invalid.routes.length, 0);
  assert.equal(invalid.issues.length, 1);
});
test('fresh cached routes are available before opening or enumerating any server', async () => {
  const driver = {
    servers: async () => ['111', '222'],
    cachedChannels: (id) => (id === '111' ? ['/channels/111/123'] : null),
    selectServer: async () => {
      throw Error('Navigation is only needed for scanning or a cache miss');
    },
  };
  const batches = context.createAuditNavigation(driver, () => true).batches('servers');
  const first = await batches.next();
  assert.deepEqual(Array.from(first.value.routes), ['/channels/111/123']);
  await batches.return();
});
test('a failed census is reported and later servers still yield routes', async () => {
  const driver = {
    servers: async () => ['111', '222'],
    selectServer: async () => true,
    channels: async (id) => {
      if (id === '111') throw Error('Census timed out');
      return ['/channels/222/123'];
    },
  };
  const result = await context.createAuditNavigation(driver, () => true).discover('servers');
  assert.equal(result.issues[0].server, '111');
  assert.deepEqual(Array.from(result.routes), ['/channels/222/123']);
});
