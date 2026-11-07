const botPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const discordEpoch = 1420070400000;
const twoWeeks = 14 * 86400000;
const botCooldowns = new Map();

function createBotRequest(fetch, token) {
  return async (path, method = 'GET', body) => {
    const route = method + ' ' + path.split('?')[0].replace(/(\/messages\/)\d+$/, '$1:id');
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = Math.max(botCooldowns.get(route) || 0, botCooldowns.get('global') || 0) - Date.now();
      if (wait > 20000) throw Error('Discord requested a longer cooldown. Resume after it ends.');
      if (wait > 0) await botPause(wait);
      const response = await fetch('https://discord.com/api/v10' + path, {
        method,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: { authorization: 'Bot ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(12000),
      });
      const reset = Number(response.headers.get('x-ratelimit-reset-after'));
      if (response.headers.get('x-ratelimit-remaining') === '0' && reset > 0)
        botCooldowns.set(route, Date.now() + reset * 1000);
      if (response.status === 204) return null;
      if (response.status === 429 || response.status === 202) {
        const details = await response.json().catch(() => ({}));
        const retry = Number(response.headers.get('retry-after') || details.retry_after);
        const key = details.global || response.headers.get('x-ratelimit-global') === 'true' ? 'global' : route;
        botCooldowns.set(key, Date.now() + (retry > 0 ? retry * 1000 : 1000));
        continue;
      }
      if (method === 'GET' && response.status >= 500 && attempt === 0) {
        await botPause(750);
        continue;
      }
      if (response.ok) return response.json();
      const error = Error(`Discord bot request failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    throw Error('Discord is rate limiting or indexing this search. Resume the saved scan later.');
  };
}

function botWindow(message) {
  const start = Date.parse(message.start);
  const end = Date.parse(message.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < discordEpoch || end <= start)
    throw Error('Choose a valid Discord incident window.');
  return { start: message.start, endExclusive: message.endExclusive };
}

function botRow(message) {
  const core = DiscordAudit;
  const author = core.accountId(message?.author?.id);
  if (!author || !core.accountId(message.id) || !core.accountId(message.channel_id)) return null;
  return {
    id: message.id,
    author,
    channel: message.channel_id,
    attachments: (Array.isArray(message.attachments) ? message.attachments : [])
      .map((item) => core.originalAttachment(item?.url))
      .filter(Boolean),
    text: typeof message.content === 'string' ? message.content : '',
    links: [],
    everyone: message.mention_everyone === true,
  };
}

function canModerateChannel(guild, roles, member, channel) {
  if (channel.guild_id !== guild || ![0, 5, 15, 16].includes(channel.type) ||
      !Array.isArray(channel.permission_overwrites) || !Array.isArray(member.roles)) return false;
  const ids = new Set(member.roles);
  const bits = (value) => typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : 0n;
  let permissions = roles.reduce((all, role) =>
    role.id === guild || ids.has(role.id) ? all | bits(role.permissions) : all, 0n);
  const required = (1n << 10n) | (1n << 13n) | (1n << 16n);
  if ((permissions & (1n << 3n)) !== 0n) return true;
  if (Date.parse(member.communication_disabled_until) > Date.now()) return false;
  const overwrites = channel.permission_overwrites;
  const apply = (entries) => {
    const allow = entries.reduce((all, entry) => all | bits(entry.allow), 0n);
    const deny = entries.reduce((all, entry) => all | bits(entry.deny), 0n);
    permissions = (permissions & ~deny) | allow;
  };
  apply(overwrites.filter((entry) => entry.type === 0 && entry.id === guild));
  apply(overwrites.filter((entry) => entry.type === 0 && ids.has(entry.id)));
  apply(overwrites.filter((entry) => entry.type === 1 && entry.id === member.user?.id));
  return (permissions & required) === required;
}

async function moderatorChannels(request, server, author, channelId) {
  const [roles, member, result] = await Promise.all([
    request(`/guilds/${server}/roles`),
    request(`/guilds/${server}/members/${author}`),
    request(channelId ? '/channels/' + channelId : `/guilds/${server}/channels`),
  ]);
  const channels = channelId ? [result] : result;
  if (member?.user?.id !== author || !Array.isArray(roles) || !Array.isArray(channels))
    throw Error('Discord could not verify channel permissions.');
  return channels.filter((channel) => DiscordAudit.accountId(channel?.id) &&
    canModerateChannel(server, roles, member, channel)).map((channel) => channel.id);
}

async function botSearch(request, message, approvedChannels) {
  const window = botWindow(message);
  const from = (BigInt(Date.parse(window.start) - discordEpoch) << 22n) - 1n;
  const to = BigInt(Date.parse(window.endExclusive) - discordEpoch) << 22n;
  const before = DiscordAudit.accountId(message.before) ? BigInt(message.before) : to;
  if (before > to || before <= from) return { rows: [], next: null };
  const query = new URLSearchParams({
    min_id: String(from < 0n ? 0n : from), max_id: String(before),
    sort_by: 'timestamp', sort_order: 'desc', limit: '25',
  });
  if (!message.moderation) query.append('author_id', message.author);
  const channels = DiscordAudit.accountId(message.onlyChannel) ? [message.onlyChannel] : approvedChannels;
  if (channels?.some((id) => approvedChannels && !approvedChannels.includes(id)))
    throw Error('This channel is outside the approved moderation scope.');
  for (const id of channels || []) query.append('channel_id', id);
  if (!message.detectSuspicious) query.append('has', 'file');
  const data = await request(`/guilds/${message.server}/messages/search?${query}`);
  if (!Array.isArray(data?.messages)) throw Error('Discord returned an invalid search page.');
  const rows = data.messages.flat().map(botRow).filter((row) =>
    row && BigInt(row.id) < before && DiscordAudit.inWindow(row.id, window) &&
    (!channels || channels.includes(row.channel)) &&
    (message.moderation || row.author === message.author),
  );
  const oldest = rows.reduce((id, row) => BigInt(row.id) < id ? BigInt(row.id) : id, before);
  if (!rows.length && (data.total_results > 0 || data.doing_deep_historical_index))
    throw Error('Discord has not returned all indexed messages. Resume this scan later.');
  return { rows, next: oldest < before ? String(oldest) : null };
}

async function botRecentChannels(request, server) {
  const channels = await request('/guilds/' + server + '/channels');
  const active = await request('/guilds/' + server + '/threads/active');
  if (!Array.isArray(channels) || !Array.isArray(active?.threads)) throw Error('Invalid server channel list.');
  return { channels: [...new Set([
    ...channels.filter((channel) => [0, 5, 10, 11, 12].includes(channel.type)),
    ...active.threads,
  ].filter((channel) => channel.guild_id === server && DiscordAudit.accountId(channel.id)).map((channel) => channel.id))] };
}

async function botRecent(request, message) {
  const window = botWindow(message);
  if (!DiscordAudit.accountId(message.channel)) throw Error('Choose a valid text channel.');
  const channel = await request('/channels/' + message.channel);
  if (channel?.guild_id !== message.server) throw Error('This channel is outside the approved server.');
  const before = (BigInt(Date.parse(window.endExclusive) - discordEpoch) << 22n).toString();
  const data = await request(`/channels/${message.channel}/messages?limit=100&before=${before}`);
  if (!Array.isArray(data)) throw Error('Invalid recent message page.');
  return { rows: data.map(botRow).filter((row) =>
    row && row.channel === message.channel && DiscordAudit.inWindow(row.id, window) &&
    (message.moderation || row.author === message.author),
  ) };
}

async function botDelete(request, message, hashAttachment) {
  const core = DiscordAudit;
  const window = botWindow(message);
  const references = core.referenceHashes(message.references);
  if (!references.length || !core.accountId(message.channel) ||
      !Array.isArray(message.matches) || !message.matches.length || message.matches.length > 25)
    throw Error('Choose a valid batch of verified matches.');
  const matches = core.resultPlan(message.matches, references, window, message.author, message.moderation === true);
  const route = `/channels/${message.server}/${message.channel}`;
  if (matches.length !== message.matches.length || matches.some((row) => row.route !== route))
    throw Error('The selection does not match this server and channel.');
  const channel = await request('/channels/' + message.channel);
  if (channel?.guild_id !== message.server || channel.thread_metadata?.archived)
    throw Error('This channel is outside the approved server or is archived.');
  const results = [];
  const eligible = [];
  let index = 0;
  async function verifySelected() {
    while (index < matches.length) {
      const match = matches[index++];
      try {
        const current = await request(`/channels/${message.channel}/messages/${match.id}`);
        const row = botRow(current);
        if (row?.id !== match.id || row.author !== match.author || row.channel !== message.channel)
          throw Error('Message identity changed.');
        let verified = false;
        for (const url of row.attachments) {
          const hash = await hashAttachment(url).catch(() => null);
          if (core.matches({ ...row, hash }, references, window, match.author)) {
            verified = true;
            break;
          }
        }
        if (!verified) throw Error('Attachment could not be verified.');
        eligible.push(match.id);
      } catch (error) {
        results.push({ id: match.id, status: error.status === 404 ? 'missing' : 'unverified', reason: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(matches.length, 3) }, verifySelected));
  const bulk = eligible.filter((id) => Date.now() - core.timestamp(id) < twoWeeks - 60000);
  const bulkIds = new Set(bulk.length >= 2 ? bulk : []);
  if (bulkIds.size) {
    try {
      await request(`/channels/${message.channel}/messages/bulk-delete`, 'POST', { messages: bulk });
      for (const id of bulk) results.push({ id, status: 'deleted' });
    } catch (error) {
      for (const id of bulk) results.push({ id, status: 'unverified', reason: error.message });
    }
  }
  for (const id of eligible) {
    if (bulkIds.has(id)) continue;
    try {
      await request(`/channels/${message.channel}/messages/${id}`, 'DELETE');
      results.push({ id, status: 'deleted' });
    } catch (error) {
      results.push({ id, status: error.status === 404 ? 'missing' : 'unverified', reason: error.message });
    }
  }
  return { results };
}
