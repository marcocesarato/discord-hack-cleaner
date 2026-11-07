globalThis.DiscordScanState = {
  key: 'discordCleanupScanCheckpoint_v1',
  clean(value) {
    const source = value?.report;
    const core = globalThis.DiscordAudit;
    const referenceHashes = core.referenceHashes(source?.referenceHashes ?? source?.referenceSHA256);
    if (
      value?.version !== 1 ||
      !core.accountId(source?.author) ||
      (!referenceHashes.length && source?.detectSuspicious !== true) ||
      !['current', 'servers', 'dm', 'both'].includes(source.scope) ||
      (source.scope === 'current' && !/^\d+$/.test(source.currentServer || ''))
    ) {
      throw Error('Choose a valid Discord Hack Cleaner scan checkpoint.');
    }
    const start = Date.parse(source.start);
    const end = Date.parse(source.endExclusive);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw Error('The saved scan has an invalid incident window.');
    }
    const window = { start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString() };
    const inScope = (route) => core.inScope(route, source.scope, source.currentServer);
    const array = (value) => (Array.isArray(value) ? value : []);
    const channels = new Map();
    for (const item of array(source.channels)) {
      if (!inScope(item?.route)) continue;
      const route = core.route(item.route);
      channels.set(route, {
        route,
        status: String(item.status || 'Unverified').slice(0, 300),
        ...(Number.isSafeInteger(item.messagesInWindow) && item.messagesInWindow >= 0
          ? { messagesInWindow: item.messagesInWindow }
          : {}),
      });
    }
    const moderation = source.scope === 'current' && source.moderation === true;
    const matches = core
      .resultPlan(
        array(source.matches).filter((item) => item && typeof item === 'object'),
        referenceHashes,
        window,
        source.author,
        moderation,
      )
      .filter((match) => inScope(match.route))
      .map(({ id, author, hash, url, serverName, channelName, everyone }) => ({
        id,
        author,
        hash,
        url,
        time: new Date(core.timestamp(id)).toISOString(),
        ...(everyone === true ? { everyone: true } : {}),
        ...(typeof serverName === 'string' ? { serverName: serverName.slice(0, 120) } : {}),
        ...(typeof channelName === 'string' ? { channelName: channelName.slice(0, 120) } : {}),
      }));
    const legacyPending = !source.source ? [...channels.values()]
      .filter(({ status }) => /^(?:Unverified|Stopped|Reached the history scroll limit|No older messages loaded)/.test(status))
      .map(({ route }) => route) : [];
    const pending = [
      ...new Set(
        [...array(value.pending), ...legacyPending]
          .filter(inScope)
          .map((route) => core.route(route)),
      ),
    ];
    const cursors = {};
    const cursorCounts = {};
    for (const route of pending) {
      const id = core.accountId(value.cursors?.[route]);
      if (id && core.timestamp(id) >= start) {
        cursors[route] = id;
        const count = value.cursorCounts?.[route];
        if (Number.isSafeInteger(count) && count >= 0) cursorCounts[route] = count;
      }
    }
    const sourceKind = ['bot', 'archive', 'search'].includes(source.source) ? source.source : 'dom';
    const exactIds = new Set(matches.map((match) => match.id));
    const suspicious = new Map();
    for (const item of array(source.suspicious)) {
      const parts =
        typeof item?.url === 'string' &&
        item.url.match(/^https:\/\/discord\.com(\/channels\/(?:@me|\d+)\/\d+)\/(\d{17,20})$/);
      const reasons = core.reviewReasons(item?.reasons);
      if (
        source.detectSuspicious !== true ||
        !parts ||
        parts[2] !== item.id ||
        exactIds.has(item.id) ||
        !inScope(parts[1]) ||
        !core.inWindow(item.id, window) ||
        !reasons.length ||
        (!moderation && item.author !== source.author)
      )
        continue;
      suspicious.set(item.id, {
        id: item.id,
        url: item.url,
        author: core.accountId(item.author) || '',
        reasons,
      });
    }
    return {
      version: 1,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : null,
      finished: value.finished === true && pending.length === 0,
      pending,
      ...(Object.keys(cursors).length ? { cursors } : {}),
      ...(Object.keys(cursorCounts).length ? { cursorCounts } : {}),
      ...(sourceKind === 'bot' && core.inWindow(value.botCursor, window) ? { botCursor: value.botCursor } : {}),
      ...(sourceKind === 'bot' && value.botSearchDone === true ? { botSearchDone: true } : {}),
      ...(sourceKind === 'bot' ? {
        recentChecked: [...new Set(array(value.recentChecked).filter((id) => core.accountId(id)))].slice(0, 10000),
      } : {}),
      report: {
        author: source.author,
        ...window,
        scope: source.scope,
        currentServer: source.scope === 'current' ? source.currentServer : null,
        referenceHashes,
        moderation,
        source: sourceKind,
        ...(typeof source.scanStartedAt === 'string' && Number.isFinite(Date.parse(source.scanStartedAt))
          ? { scanStartedAt: new Date(source.scanStartedAt).toISOString() } : {}),
        ...(inScope(source.onlyRoute) ? { onlyRoute: core.route(source.onlyRoute) } : {}),
        channels: [...channels.values()],
        matches,
        detectSuspicious: source.detectSuspicious === true,
        scamDomains: core.scamDomains(array(source.scamDomains).join(' ')),
        suspicious: [...suspicious.values()],
        unverified: array(source.unverified)
          .filter((item) => item && typeof item.reason === 'string')
          .map((item) => ({
            reason: item.reason.slice(0, 300),
            ...(inScope(item.route) ? { route: core.route(item.route) } : {}),
            ...(/^\d{17,20}$/.test(item.id || '') ? { id: item.id } : {}),
            ...(/^\d{1,20}$/.test(item.server || '') ? { server: item.server } : {}),
          })),
        deletions: array(source.deletions)
          .filter((entry) => exactIds.has(entry?.id) && ['deleted', 'missing', 'unverified'].includes(entry.status))
          .map(({ id, status, verifiedAt, reason }) => ({
            id, status,
            ...(typeof verifiedAt === 'string' ? { verifiedAt: verifiedAt.slice(0, 40) } : {}),
            ...(typeof reason === 'string' ? { reason: reason.slice(0, 300) } : {}),
          })),
        complete: value.finished === true && pending.length === 0 && source.complete === true,
      },
    };
  },
};
