const { test } = require('node:test');
const a = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
process.env.TZ = 'Europe/Rome';
const window = { start: '2025-01-15T02:00:00Z', endExclusive: '2025-01-15T07:00:00Z' };
const author = '100000000000000001';
const scope = { URL };
vm.createContext(scope);
if (fs.existsSync(__dirname + '/../src/core.js'))
  vm.runInContext(fs.readFileSync(__dirname + '/../src/core.js', 'utf8'), scope);
test('message IDs give exact UTC timestamps and fixed incident boundaries', () => {
  a.equal(typeof scope.DiscordAudit, 'object');
  const c = scope.DiscordAudit;
  const id = (t) => String((BigInt(Date.parse(t)) - 1420070400000n) << 22n);
  a.equal(c.inWindow(id('2025-01-15T02:00:00Z'), window), true);
  a.equal(c.inWindow(id('2025-01-15T07:00:00Z'), window), false);
  a.equal(c.inWindow(id('2025-01-15T01:59:59Z'), window), false);
  a.equal(c.inWindow('invalid', window), false);
});
test('browser-local dates convert to UTC and use an exclusive end', () => {
  const c = scope.DiscordAudit;
  const range = c.windowFromLocal('2026-07-03T12:00', '2026-07-03T12:30');
  const id = (t) => String((BigInt(Date.parse(t)) - 1420070400000n) << 22n);
  a.equal(range.start, '2026-07-03T10:00:00.000Z');
  a.equal(c.inWindow(id('2026-07-03T10:00:00Z'), range), true);
  a.equal(c.inWindow(id('2026-07-03T10:30:00Z'), range), false);
  a.throws(() => c.windowFromLocal('2026-03-29T02:30', '2026-03-29T04:00'));
  a.throws(() => c.windowFromLocal('2026-10-25T02:30', '2026-10-25T04:00'));
  a.throws(() => c.windowFromLocal('2026-07-03T12:30', '2026-07-03T12:00'));
});
test('match requires exact author, incident time and full reference hash', () => {
  const c = scope.DiscordAudit,
    hash = 'a'.repeat(64);
  const row = {
    author,
    id: String((BigInt(Date.parse('2025-01-15T03:16:00Z')) - 1420070400000n) << 22n),
    hash,
  };
  a.equal(c.matches(row, hash, window, author), true);
  a.equal(c.matches(row, ['b'.repeat(64), hash], window, author), true);
  a.equal(c.matches(row, ['b'.repeat(64), 'c'.repeat(64)], window, author), false);
  a.equal(c.matches({ ...row, author: '' }, hash, window, author), false);
  a.equal(c.matches({ ...row, author: '100000000000000002' }, hash, window, author), false);
  a.equal(c.matches({ ...row, hash: 'b'.repeat(64) }, hash, window, author), false);
  a.equal(c.matches(row, '', window, author), false);
});
test('route and attachment URL allowlists reject external and nonattachment URLs', () => {
  const c = scope.DiscordAudit;
  a.equal(c.route('/channels/@me/123'), '/channels/@me/123');
  a.equal(c.route('https://evil.example/channels/@me/123'), null);
  a.equal(c.route('/channels/123/456/789'), null);
  a.equal(c.attachment('https://cdn.discordapp.com/attachments/123/456/1.webp?ex=123'), true);
  a.equal(c.attachment('https://cdn.discordapp.com.evil.example/attachments/1'), false);
  a.equal(c.attachment('https://cdn.discordapp.com/avatars/123/a.webp'), false);
});
test('scope separates DMs and server routes and rejects invalid choices', () => {
  const c = scope.DiscordAudit;
  a.equal(c.inScope('/channels/@me/123', 'dm'), true);
  a.equal(c.inScope('/channels/111/123', 'dm'), false);
  a.equal(c.inScope('/channels/@me/123', 'servers'), false);
  a.equal(c.inScope('/channels/111/123', 'servers'), true);
  a.equal(c.inScope('/channels/111/123', 'both'), true);
  a.equal(c.inScope('/channels/@me/123', 'both'), true);
  a.equal(c.inScope('/channels/111/123', 'unknown'), false);
  a.equal(c.inScope('https://evil.test/channels/111/123', 'both'), false);
});
test('current scope excludes other servers and DMs even when discovered later', () => {
  const c = scope.DiscordAudit;
  a.equal(c.inScope('/channels/111/123', 'current', '111'), true);
  a.equal(c.inScope('/channels/222/123', 'current', '111'), false);
  a.equal(c.inScope('/channels/@me/123', 'current', '111'), false);
  a.equal(c.inScope('/channels/111/123', 'current'), false);
});
test('server eligibility requires text channel and an explicitly enabled composer', () => {
  const c = scope.DiscordAudit;
  const allowed = { textChannel: true, editorPresent: true, editable: true, disabled: false };
  a.equal(c.writableTextChannel(allowed), true);
  for (const property of ['textChannel', 'editorPresent', 'editable'])
    a.equal(c.writableTextChannel({ ...allowed, [property]: false }), false);
  a.equal(c.writableTextChannel({ ...allowed, disabled: true }), false);
  a.equal(c.writableTextChannel({ ...allowed, textChannel: undefined }), false);
  a.equal(c.writableTextChannel({ ...allowed, disabled: undefined }), false);
});
test('deletion plan contains only verified unique message links and matching evidence', () => {
  const c = scope.DiscordAudit,
    hash = 'a'.repeat(64);
  const id = String((BigInt(Date.parse('2025-01-15T03:16:00Z')) - 1420070400000n) << 22n);
  const match = { id, author, hash, url: `https://discord.com/channels/111/222/${id}` };
  a.equal(c.deletionPlan([match, match], hash, window, author).length, 1);
  a.equal(c.deletionPlan([{ ...match, author: '' }], hash, window, author).length, 0);
  a.equal(
    c.deletionPlan([{ ...match, url: `https://evil.test/channels/111/222/${id}` }], hash, window, author)
      .length,
    0,
  );
  a.equal(
    c.deletionPlan([{ ...match, url: 'https://discord.com/channels/111/222/999' }], hash, window, author)
      .length,
    0,
  );
  a.equal(c.deletionPlan([match], 'b'.repeat(64), window, author).length, 0);
});

test('suspicious detection combines signals and matches known domain boundaries', () => {
  const core = scope.DiscordAudit;
  const domains = core.scamDomains('SCAM.test, scam.test, not-a-domain');
  a.deepEqual(Array.from(domains), ['scam.test']);
  const detect = (text, attachments = [], links = []) =>
    Array.from(core.suspiciousReasons({ text, attachments, links }, domains));

  a.deepEqual(detect('@everyone'), []);
  a.deepEqual(detect('free nitro'), []);
  a.deepEqual(detect('https://scam.test.example.org/'), []);
  a.deepEqual(detect('https://trusted.test/scam.test'), []);
  a.deepEqual(detect('@here', ['https://cdn.example.test/banner.WEBP?sig=x']), ['Mass mention + image attachment']);
  a.deepEqual(detect('free nitro https://example.test/promo'), ['Scam phrase + link']);
  a.deepEqual(detect('Review this', [], ['https://promo.scam.test/']), ['Known scam domain']);
});
