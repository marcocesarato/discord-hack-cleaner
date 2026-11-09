globalThis.DiscordAudit = Object.freeze({
  accountId(value) {
    return typeof value === 'string' && /^\d{17,20}$/.test(value) ? value : null;
  },
  localInput(instant) {
    const date = new Date(instant);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  },
  windowFromLocal(start, endExclusive) {
    const formatInput = this.localInput;
    function toInstant(value, label) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        throw Error(`Choose a valid ${label} date and time.`);
      const wallTime = Date.parse(value + ':00Z');
      if (!Number.isFinite(wallTime)) throw Error(`Choose a valid ${label} date and time.`);
      const offsets = new Set(
        [-86400000, 0, 86400000].map((delta) => new Date(wallTime + delta).getTimezoneOffset()),
      );
      const candidates = [...offsets]
        .map((offset) => wallTime + offset * 60000)
        .filter((time) => formatInput(time) === value);
      if (candidates.length !== 1)
        throw Error(`Choose a different ${label} time. This local time is invalid or ambiguous.`);
      return candidates[0];
    }
    const startTime = toInstant(start, 'start');
    const endTime = toInstant(endExclusive, 'end');
    if (endTime <= startTime) throw Error('End must be later than start.');
    return { start: new Date(startTime).toISOString(), endExclusive: new Date(endTime).toISOString() };
  },
  timestamp(id) {
    if (!/^\d{17,20}$/.test(String(id))) return NaN;
    try {
      return Number((BigInt(id) >> 22n) + 1420070400000n);
    } catch {
      return NaN;
    }
  },
  inWindow(id, window) {
    const time = this.timestamp(id);
    return time >= Date.parse(window?.start) && time < Date.parse(window?.endExclusive);
  },
  matches(row, reference, window, author) {
    return (
      this.accountId(author) !== null &&
      row.author === author &&
      this.inWindow(row.id, window) &&
      this.referenceMatches(row.hash, reference)
    );
  },
  referenceMatches(hash, reference) {
    return (
      typeof hash === 'string' &&
      /^[a-f0-9]{64}$/.test(hash) &&
      (Array.isArray(reference) ? reference.includes(hash) : hash === reference)
    );
  },
  referenceHashes(reference) {
    const hashes = Array.isArray(reference) ? reference : [reference];
    if (!hashes.every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) return [];
    return [...new Set(hashes)];
  },
  route(value) {
    const m = String(value).match(/^(?:https:\/\/discord\.com)?(\/channels\/(?:@me|\d+)\/\d+)\/?$/);
    return m ? m[1] : null;
  },
  pageRoute(path) {
    return this.route(String(path).replace(/^(\/channels\/(?:@me|\d+)\/\d+)\/\d+\/?$/, '$1'));
  },
  inScope(value, scope, currentServer) {
    const route = this.route(value);
    if (scope === 'current')
      return !!route && /^\d+$/.test(String(currentServer)) && route.split('/')[2] === currentServer;
    if (!route || !['dm', 'servers', 'both'].includes(scope)) return false;
    const dm = route.startsWith('/channels/@me/');
    return scope === 'both' || (scope === 'dm' ? dm : !dm);
  },
  channelType(labels) {
    for (const label of labels) {
      const text = String(label || '').trim().toLowerCase();
      const kind = text.match(/\(([^()]+)\)$/)?.[1] || text;
      if (/^(?:text channel|announcement channel|canale testuale|canale di annunci|textkanal|ankündigungskanal)$/.test(kind))
        return 'text';
      if (/^(?:voice channel|stage channel|forum channel|thread|forum|canale vocale|canale palco|canale forum|sprachkanal|bühnenkanal)$/.test(kind))
        return 'other';
    }
    return null;
  },
  deletionPlan(matches, reference, window, author) {
    return this.resultPlan(matches, reference, window, author, false);
  },
  scamDomains(value) {
    const domains = String(value ?? '')
      .toLowerCase()
      .split(/[\s,]+/);
    return [
      ...new Set(
        domains.filter((domain) => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)),
      ),
    ].slice(0, 100);
  },
  suspiciousReasons({ text, attachments, links }, domains) {
    const reasons = [];
    const mention = /(?:^|\s)@(everyone|here)\b/i.test(text);
    if (mention && attachments.some((url) => /\.(?:png|jpe?g|webp|gif|avif)(?:\?|$)/i.test(url))) {
      reasons.push('Mass mention + image attachment');
    }
    const urls = [...links, ...(text.match(/https?:\/\/[^\s<>]+/gi) || [])];
    const hosts = urls.flatMap((value) => {
      try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) ? [url.hostname.toLowerCase().replace(/\.$/, '')] : [];
      } catch {
        return [];
      }
    });
    if (hosts.some((host) => domains.some((domain) => host === domain || host.endsWith('.' + domain)))) {
      reasons.push('Known scam domain');
    }
    if (
      hosts.length &&
      /\b(?:free nitro|claim (?:your|now)|crypto giveaway|cash bonus|gift card)\b/i.test(text)
    ) {
      reasons.push('Scam phrase + link');
    }
    return reasons;
  },
  reviewReasons(value) {
    return ['Mass mention + image attachment', 'Known scam domain', 'Scam phrase + link'].filter(
      (reason) => Array.isArray(value) && value.includes(reason),
    );
  },
  resultPlan(matches, reference, window, author, includeOthers) {
    if (!this.accountId(author)) return [];
    const unique = new Map();
    for (const match of matches) {
      const parsed = String(match.url).match(/^https:\/\/discord\.com(\/channels\/(?:@me|\d+)\/\d+)\/(\d+)$/);
      const permittedAuthor =
        match.author === author ||
        (includeOthers &&
          parsed &&
          !parsed[1].startsWith('/channels/@me/') &&
          typeof match.author === 'string' &&
          /^\d{0,20}$/.test(match.author));
      if (
        parsed &&
        parsed[2] === match.id &&
        permittedAuthor &&
        this.inWindow(match.id, window) &&
        this.referenceMatches(match.hash, reference)
      )
        unique.set(match.id, { ...match, route: parsed[1] });
    }
    return [...unique.values()];
  },
  attachment(value) {
    return /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\d+\/\d+\/[^\s#]+$/.test(
      String(value),
    );
  },
  originalAttachment(value) {
    if (!this.attachment(value)) return null;
    const url = new URL(value);
    url.hostname = 'cdn.discordapp.com';
    // Gallery images can point at a resized proxy. Keep the attachment signature and request the original bytes.
    for (const parameter of [...url.searchParams.keys()]) {
      if (!['ex', 'is', 'hm'].includes(parameter)) url.searchParams.delete(parameter);
    }
    return this.attachment(url.href) ? url.href : null;
  },
});
