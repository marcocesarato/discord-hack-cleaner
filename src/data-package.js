globalThis.readDiscordDataPackage = async function* (file) {
  const maxEntry = 24 * 1024 * 1024;
  const decoder = new TextDecoder();
  const read = async (offset, size) => new DataView(await file.slice(offset, offset + size).arrayBuffer());
  const bytes = (view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const tailSize = Math.min(file.size, 65557);
  const tail = await read(file.size - tailSize, tailSize);
  let end = tailSize - 22;
  while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50 || end + 22 + tail.getUint16(end + 20, true) !== tailSize)) end--;
  if (end < 0 || tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true))
    throw Error('Choose the original Discord data package ZIP.');
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (count === 65535 || size > maxEntry || offset + size > file.size - tailSize + end)
    throw Error('The data package ZIP directory is too large or invalid.');
  const directory = await read(offset, size);
  const folders = new Map();
  for (let i = 0, position = 0; i < count; i++) {
    if (position + 46 > size || directory.getUint32(position, true) !== 0x02014b50)
      throw Error('The data package ZIP directory is invalid.');
    const length = directory.getUint16(position + 28, true);
    const next = position + 46 + length + directory.getUint16(position + 30, true) + directory.getUint16(position + 32, true);
    if (next > size) throw Error('The data package ZIP directory is truncated.');
    const name = decoder.decode(bytes(directory).subarray(position + 46, position + 46 + length));
    const match = name.match(/(?:^|\/)messages\/c?(\d{17,20})\/(channel|messages)\.json$/i);
    if (match) {
      const id = match[1];
      const kind = match[2].toLowerCase();
      const folder = folders.get(id) || {};
      if (folder[kind]) throw Error('Duplicate channel files in the Discord data package.');
      folder[kind] = {
        method: directory.getUint16(position + 10, true),
        flags: directory.getUint16(position + 8, true),
        compressed: directory.getUint32(position + 20, true),
        expanded: directory.getUint32(position + 24, true),
        offset: directory.getUint32(position + 42, true),
      };
      folders.set(id, folder);
    }
    position = next;
  }
  if (!folders.size) throw Error('No Discord message JSON files were found in the package.');
  async function readJSON(entry) {
    if (!entry || (entry.flags & 1) || entry.compressed > maxEntry || entry.expanded > maxEntry ||
        entry.offset + 30 > offset || ![0, 8].includes(entry.method))
      throw Error('Channel JSON is missing or exceeds the supported 24 MB limit.');
    const header = await read(entry.offset, 30);
    if (header.getUint32(0, true) !== 0x04034b50) throw Error('Invalid ZIP entry.');
    const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    if (start + entry.compressed > offset) throw Error('Invalid ZIP entry size.');
    const input = file.slice(start, start + entry.compressed);
    const stream = entry.method === 8 ? input.stream().pipeThrough(new DecompressionStream('deflate-raw')) : input.stream();
    const reader = stream.getReader();
    let total = 0;
    let content = '';
    const textDecoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > entry.expanded) {
        await reader.cancel();
        throw Error('Invalid expanded ZIP entry size.');
      }
      content += textDecoder.decode(value, { stream: true });
    }
    if (total !== entry.expanded) throw Error('Truncated ZIP entry.');
    return JSON.parse(content + textDecoder.decode());
  }
  for (const [channel, folder] of folders) {
    try {
      const details = await readJSON(folder.channel);
      const messages = await readJSON(folder.messages);
      const guild = DiscordAudit.accountId(details.guild?.id || details.guild_id || details.guildId);
      if (!Array.isArray(messages) || String(details.id) !== channel ||
          (!guild && ![1, 3, 'DM', 'GROUP_DM'].includes(details.type)))
        throw Error('Invalid channel metadata or transcript.');
      yield { route: `/channels/${guild || '@me'}/${channel}`, channelName: details.name, messages };
    } catch (error) {
      yield { error: `Channel ${channel}: ${error.message}` };
    }
  }
};
