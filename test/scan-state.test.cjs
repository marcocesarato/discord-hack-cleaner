const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
for (const name of ['core.js', 'scan-state.js']) {
  if (fs.existsSync(__dirname + '/../src/' + name))
    vm.runInContext(fs.readFileSync(__dirname + '/../src/' + name, 'utf8'), context);
}
test('checkpoint keeps only in-scope routes and resumable scan data', () => {
  const report = {
    author: '100000000000000001',
    start: '2025-01-15T02:00:00Z',
    endExclusive: '2025-01-15T07:00:00Z',
    scope: 'current',
    currentServer: '111',
    referenceSHA256: 'aa'.repeat(32),
    channels: [{ route: '/channels/111/222', status: 'Stopped' }],
    matches: [],
    token: 'do-not-store',
  };
  const restored = context.DiscordScanState.clean({
    version: 1,
    report,
    pending: ['/channels/111/222', '/channels/333/444'],
    token: 'do-not-store',
  });
  assert.equal(restored.report.channels[0].status, 'Stopped');
  assert.deepEqual(Array.from(restored.pending), ['/channels/111/222']);
  assert.equal(JSON.stringify(restored).includes('do-not-store'), false);
  assert.throws(() =>
    context.DiscordScanState.clean({ version: 1, report: { ...report, endExclusive: report.start } }),
  );
});

test('suspicious-only checkpoints keep vetted review results separate from exact matches', () => {
  const author = '100000000000000001';
  const snowflake = (timestamp) =>
    String((BigInt(Date.parse(timestamp)) - 1420070400000n) << 22n);
  const result = (timestamp, route = '/channels/111/222', changes = {}) => {
    const id = snowflake(timestamp);
    return {
      id,
      author,
      url: 'https://discord.com' + route + '/' + id,
      reasons: ['Known scam domain', 'Injected reason'],
      ...changes,
    };
  };
  const valid = result('2025-01-15T03:00:00Z');
  const report = {
    author,
    start: '2025-01-15T02:00:00Z',
    endExclusive: '2025-01-15T07:00:00Z',
    scope: 'current',
    currentServer: '111',
    detectSuspicious: true,
    scamDomains: ['SCAM.test', 'scam.test', 'invalid'],
    referenceHashes: [],
    matches: [valid],
    suspicious: [
      valid,
      result('2025-01-15T04:00:00Z', '/channels/333/222'),
      result('2025-01-15T05:00:00Z', '/channels/111/222', { author: '100000000000000002' }),
      result('2025-01-15T06:00:00Z', '/channels/111/222', { reasons: ['Injected reason'] }),
      result('2025-01-15T07:00:00Z'),
    ],
  };
  const restored = context.DiscordScanState.clean({ version: 1, report }).report;
  assert.equal(restored.matches.length, 0);
  assert.deepEqual(Array.from(restored.scamDomains), ['scam.test']);
  assert.equal(restored.suspicious.length, 1);
  assert.equal(restored.suspicious[0].id, valid.id);
  assert.deepEqual(Array.from(restored.suspicious[0].reasons), ['Known scam domain']);
});
