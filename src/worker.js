importScripts('core.js', 'cache.js', 'moderation.js', 'bot.js');

const activeBotDeletes = new Set();

async function attachmentHash(url) {
  const maxBytes = 20 * 1024 * 1024;
  if (!DiscordAudit.attachment(url)) throw Error('Attachment URL is not allowed.');
  const stall = new AbortController();
  let timer;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(), 10000);
  };
  reset();
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([AbortSignal.timeout(28000), stall.signal]),
    });
    if (!response.ok) throw Error(`Attachment returned HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw Error('Attachment exceeds 20 MB.');
    const reader = response.body.getReader();
    reset();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      reset();
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error('Attachment exceeds 20 MB.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } finally {
    clearTimeout(timer);
  }
}

async function handleMessage(message) {
  const { type, author } = message;
  if (type === 'attachmentHash') return { hash: await attachmentHash(message.url) };
  if (type === 'openReportViewer' || type === 'openRecoveryGuide') {
    const page = type === 'openReportViewer' ? 'src/report.html' : 'src/guide.html';
    const section = type === 'openRecoveryGuide' && message.section === 'oauth2' ? '#oauth2' : '';
    await chrome.tabs.create({ url: chrome.runtime.getURL(page) + section });
    return { ok: true };
  }
  if (type === 'saveOAuthToken' && !author) {
    const token = typeof message.token === 'string' ? message.token.trim() : '';
    const identity = await oauthGet(fetch, token, '/users/@me');
    if (!DiscordAudit.accountId(identity?.id)) throw Error('Discord did not return a valid account ID.');
    await handleMessage({ type, author: identity.id, token });
    return { ok: true, author: identity.id };
  }
  if (!DiscordAudit.accountId(author)) throw Error('Enter your Discord user ID first.');

  const storage = chrome.storage.local;
  if (['botStatus', 'saveBot', 'forgetBot', 'authorizeBot', 'botSearch', 'botRecentChannels', 'botRecent', 'botDelete'].includes(type)) {
    const session = chrome.storage.session;
    const key = `discordCleanupBot_${author}`;
    const accessKey = `discordCleanupBotAccess_${author}`;
    if (type === 'botStatus') return { saved: !!(await session?.get(key))?.[key] };
    if (!session) throw Error('This browser does not support session-only bot credentials.');
    if (type === 'forgetBot') {
      await session.remove([key, accessKey]);
      return { ok: true };
    }
    if (type === 'saveBot') {
      if (typeof message.token !== 'string' || !/^[a-z0-9_.-]{20,512}$/i.test(message.token))
        throw Error('Enter a valid Discord bot token.');
      const bot = await createBotRequest(fetch, message.token)('/users/@me');
      if (bot?.bot !== true) throw Error('This credential does not belong to a Discord bot.');
      await session.remove(accessKey);
      await session.set({ [key]: message.token });
      return { ok: true };
    }
    const token = (await session.get(key))[key];
    if (!token || typeof message.server !== 'string' || !/^\d{1,20}$/.test(message.server))
      throw Error('Configure a bot and choose a server first.');
    const request = createBotRequest(fetch, token);
    const verify = async () => {
      const oauthKey = `discordCleanupOAuth_v1_${author}`;
      const oauth = (await storage.get(oauthKey))[oauthKey];
      return createModerationCheck(fetch)({ server: message.server, token: oauth, author, includeGuildPermissions: true });
    };
    const authorize = async () => {
      const permissions = await verify();
      const guild = await request('/guilds/' + message.server);
      if (guild?.id !== message.server) throw Error('The bot is not installed in this server.');
      const channels = permissions.administrator ? null : await moderatorChannels(request, message.server, author);
      if (channels && (!channels.length || (message.onlyChannel && !channels.includes(message.onlyChannel))))
        throw Error('No channels with View Channel, Read Message History and Manage Messages could be verified.');
      const access = { server: message.server, channels, until: Date.now() + 15 * 60000 };
      await session.set({ [accessKey]: access });
      return access;
    };
    if (type === 'authorizeBot') {
      await authorize();
      return { allowed: true };
    }
    let access = (await session.get(accessKey))[accessKey];
    if (access?.server !== message.server)
      throw Error('Bot access needs to be verified again. Resume the scan.');
    if (access.until <= Date.now() && type !== 'botDelete') access = await authorize();
    if (type === 'botSearch') return botSearch(request, message, access.channels);
    if (type === 'botRecentChannels') {
      const result = await botRecentChannels(request, message.server);
      return { channels: result.channels.filter((id) => !access.channels || access.channels.includes(id)) };
    }
    if (type === 'botRecent') {
      if (access.channels && !access.channels.includes(message.channel))
        throw Error('This channel is outside the approved moderation scope.');
      return botRecent(request, message);
    }
    if (activeBotDeletes.has(author)) throw Error('Another deletion batch is already running for this account.');
    activeBotDeletes.add(author);
    try {
      const permissions = await verify();
      if (!DiscordAudit.accountId(message.channel)) throw Error('Choose a valid channel.');
      if (!permissions.administrator &&
          !(await moderatorChannels(request, message.server, author, message.channel)).includes(message.channel))
        throw Error('Your account cannot moderate this channel.');
      return await botDelete(request, message, attachmentHash);
    } finally {
      activeBotDeletes.delete(author);
    }
  }
  if (
    [
      'verifyModeration',
      'listOwnedServers',
      'saveOAuthToken',
      'oauthTokenStatus',
      'forgetOAuthToken',
    ].includes(type)
  ) {
    const key = `discordCleanupOAuth_v1_${author}`;
    if (type === 'forgetOAuthToken') {
      await storage.remove(key);
      return { ok: true };
    }
    if (type === 'oauthTokenStatus') return { saved: typeof (await storage.get(key))[key] === 'string' };
    const supplied = typeof message.token === 'string' ? message.token.trim() : '';
    if (type === 'saveOAuthToken' && !supplied) throw Error('Enter an OAuth2 access token to save.');
    const token = supplied || (await storage.get(key))[key];
    const check = type === 'verifyModeration' ? createModerationCheck(fetch) : createOwnedServerList(fetch);
    try {
      const result = await check({ author, token, server: message.server });
      if (supplied) await storage.set({ [key]: supplied });
      return type === 'saveOAuthToken' ? { ok: true } : result;
    } catch (error) {
      if (!supplied && error.status === 401) await storage.remove(key);
      throw error;
    } finally {
      message.token = '';
    }
  }

  const key = `discordCleanupCache_v2_${author}`;
  if (type === 'auditCacheClear') {
    await storage.remove(key);
    return { cache: DiscordAuditCache.clean(null) };
  }
  if (type === 'auditCacheWrite') {
    const cache = DiscordAuditCache.clean(message.cache);
    await storage.set({ [key]: cache });
    return { cache };
  }
  return { cache: DiscordAuditCache.clean((await storage.get(key))[key]) };
}

const messageTypes = new Set([
  'attachmentHash',
  'openReportViewer',
  'openRecoveryGuide',
  'verifyModeration',
  'listOwnedServers',
  'saveOAuthToken',
  'oauthTokenStatus',
  'forgetOAuthToken',
  'auditCacheRead',
  'auditCacheWrite',
  'auditCacheClear',
  'botStatus',
  'saveBot',
  'forgetBot',
  'authorizeBot',
  'botSearch',
  'botRecentChannels',
  'botRecent',
  'botDelete',
]);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!messageTypes.has(message?.type)) return;
  if (!sender.tab?.url?.startsWith('https://discord.com/channels/') || sender.frameId !== 0) {
    reply({ error: 'Open the extension from a Discord tab.' });
    return;
  }
  handleMessage(message)
    .then(reply)
    .catch((error) => reply({ error: error.message }));
  return true;
});
