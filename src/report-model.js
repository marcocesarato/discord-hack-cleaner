globalThis.DiscordReport = {
  parse(text) {
    return this.read(JSON.parse(text));
  },
  read(source) {
    if (!source || !Array.isArray(source.matches) || source.matches.length > 50000)
      throw Error('Choose a Discord Hack Cleaner JSON report with up to 50,000 matches.');
    const entries = new Map();
    let ignored = 0;
    for (const match of source.matches) {
      const parts =
        typeof match?.url === 'string'
          ? match.url.match(/^https:\/\/discord\.com\/channels\/(?:@me|\d{1,20})\/\d{1,20}\/(\d{17,20})$/)
          : null;
      if (!parts || parts[1] !== match.id || entries.has(match.id)) {
        ignored++;
        continue;
      }
      const time = Number((BigInt(match.id) >> 22n) + 1420070400000n);
      entries.set(match.id, {
        id: match.id,
        url: match.url,
        time: new Date(time).toISOString(),
        reviewed: source.manualReview?.[match.id] === true,
        ...(typeof match.serverName === 'string' ? { serverName: match.serverName.slice(0, 120) } : {}),
        ...(typeof match.channelName === 'string' ? { channelName: match.channelName.slice(0, 120) } : {}),
      });
    }
    return { entries: [...entries.values()], ignored };
  },
  export(entries) {
    return {
      matches: entries.map(({ id, url }) => ({ id, url })),
      manualReview: Object.fromEntries(entries.map((entry) => [entry.id, entry.reviewed === true])),
    };
  },
};
