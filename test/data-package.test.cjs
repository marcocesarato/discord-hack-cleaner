const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deflateRawSync } = require('node:zlib');

function zip(files) {
  const entries = [];
  const directory = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path);
    const data = Buffer.from(JSON.stringify(content));
    const compressed = deflateRawSync(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    entries.push(header, name, compressed);
    directory.push(central, name);
    offset += header.length + name.length + compressed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(Buffer.concat(directory).length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([...entries, ...directory, end]);
}

test('Discord data import reads only message transcripts and their metadata', async () => {
  const context = vm.createContext({ TextDecoder, DecompressionStream });
  for (const name of ['core.js', 'data-package.js'])
    vm.runInContext(fs.readFileSync(`${__dirname}/../src/${name}`, 'utf8'), context);
  const dm = '100000000000000001';
  const channel = '100000000000000002';
  const guild = '100000000000000003';
  const file = zip({
    'account/user.json': { private: true },
    [`messages/c${dm}/channel.json`]: { id: dm, type: 'DM' },
    [`messages/c${dm}/messages.json`]: [{ ID: '100000000000000004', Contents: 'example' }],
    [`messages/c${channel}/channel.json`]: { id: channel, guild: { id: guild }, name: 'general' },
    [`messages/c${channel}/messages.json`]: [],
  });
  const entries = [];
  for await (const entry of context.readDiscordDataPackage(file)) entries.push(entry);
  assert.deepEqual(entries.map((entry) => entry.route), [`/channels/@me/${dm}`, `/channels/${guild}/${channel}`]);
  assert.equal(entries[0].messages[0].Contents, 'example');
  await assert.rejects(async () => {
    for await (const _ of context.readDiscordDataPackage(new Blob(['invalid']))) {}
  }, /ZIP/);
});
