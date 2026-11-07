async function oauthGet(fetch, token, path, signal = AbortSignal.timeout(15000)) {
  if (typeof token !== 'string' || !/^[a-z0-9_-]{10,512}$/i.test(token))
    throw Error('Enter a Discord OAuth2 access token with identify and guilds scopes.');
  const response = await fetch('https://discord.com/api/v10' + path, {
    method: 'GET',
    headers: { authorization: 'Bearer ' + token },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (response.status !== 200) {
    const error = Error(
      response.status === 401
        ? 'The Discord OAuth2 access token is invalid or expired. Enter a fresh token.'
        : `Discord permission check failed with HTTP ${response.status}.`,
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function* verifiedGuilds(fetch, token, author) {
  const signal = AbortSignal.timeout(15000);
  const get = (path) => oauthGet(fetch, token, path, signal);
  const account = await get('/users/@me');
  if (account?.id !== author) throw Error('The OAuth2 access token belongs to a different Discord account.');
  let after = '';
  while (true) {
    const guilds = await get('/users/@me/guilds?limit=200' + (after ? '&after=' + after : ''));
    if (!Array.isArray(guilds)) throw Error('Discord returned an invalid server list.');
    yield* guilds;
    if (guilds.length < 200) return;
    const next = guilds.at(-1)?.id;
    if (typeof next !== 'string' || !/^\d{1,20}$/.test(next) || (after && BigInt(next) <= BigInt(after))) {
      throw Error('Discord returned an invalid server list cursor.');
    }
    after = next;
  }
}

globalThis.createModerationCheck =
  (fetch) =>
  async ({ server, token, author, includeGuildPermissions = false }) => {
    if (typeof server !== 'string' || !/^\d{1,20}$/.test(server))
      throw Error('Choose a server to verify moderation permissions.');
    for await (const guild of verifiedGuilds(fetch, token, author)) {
      if (guild?.id !== server) continue;
      const permissions = /^\d+$/.test(String(guild.permissions)) ? BigInt(guild.permissions) : 0n;
      const administrator = 1n << 3n;
      const manageMessages = 1n << 13n;
      if (includeGuildPermissions)
        return { administrator: guild.owner === true || (permissions & administrator) !== 0n };
      if (guild.owner === true || (permissions & (administrator | manageMessages)) !== 0n)
        return { allowed: true };
      throw Error('This server requires ownership, Administrator or Manage Messages.');
    }
    throw Error('The current server could not be verified for this account.');
  };

globalThis.createOwnedServerList =
  (fetch) =>
  async ({ token, author }) => {
    const servers = new Map();
    for await (const guild of verifiedGuilds(fetch, token, author)) {
      if (guild?.owner === true && typeof guild.id === 'string' && /^\d{1,20}$/.test(guild.id)) {
        servers.set(guild.id, {
          id: guild.id,
          name: typeof guild.name === 'string' && guild.name ? guild.name : `Server ${guild.id}`,
        });
      }
    }
    return { servers: [...servers.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  };
