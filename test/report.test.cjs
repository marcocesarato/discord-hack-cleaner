const { test } = require('node:test'),
  a = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const ctx = {};
vm.createContext(ctx);
if (fs.existsSync(__dirname + '/../src/report-model.js'))
  vm.runInContext(fs.readFileSync(__dirname + '/../src/report-model.js', 'utf8'), ctx);
const id = '1568429504223776838',
  url = `https://discord.com/channels/937410232966082571/1150874817516548258/${id}`;
test('report import validates Discord message links, deduplicates and discards other fields', () => {
  a.equal(typeof ctx.DiscordReport, 'object');
  const result = ctx.DiscordReport.parse(
    JSON.stringify({
      token: 'secret',
      matches: [
        { id, url },
        { id, url },
        { id, url: 'https://evil.test/' },
        { id, url: 'javascript:alert(1)' },
        { id: '999', url },
      ],
    }),
  );
  a.equal(result.entries.length, 1);
  a.equal(result.entries[0].url, url);
  a.equal(result.ignored, 4);
  a.equal(JSON.stringify(result).includes('secret'), false);
});
test('DM links and manual review flags survive export, invalid schema fails', () => {
  const result = ctx.DiscordReport.parse(
    JSON.stringify({
      matches: [{ id, url: `https://discord.com/channels/@me/1150874817516548258/${id}` }],
      manualReview: { [id]: true },
    }),
  );
  a.equal(result.entries[0].reviewed, true);
  a.throws(() => ctx.DiscordReport.parse('{"channels":[]}'));
  a.throws(() => ctx.DiscordReport.parse('not json'));
});
