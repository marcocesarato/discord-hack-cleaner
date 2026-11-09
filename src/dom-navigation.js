globalThis.createAuditDOMDriver = (
  active,
  progress,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  checkpoint = async () => {},
) => {
  const core = globalThis.DiscordAudit;
  const guildBar = () =>
    document
      .querySelector('[role="group"][aria-label="Server"], [role="group"][aria-label="Servers"]')
      ?.closest('nav') ||
    document.querySelector(
      '[role="group"][aria-label="Server"], [role="group"][aria-label="Servers"],nav[aria-label*="server" i],nav[aria-label*="servers" i],[role="navigation"][aria-label*="server" i]',
    );
  const channelBar = () =>
    document.getElementById('channels') || document.querySelector('nav[aria-label$="(server)"]');
  const scrolling = (root) => {
    if (!root) return [];
    const candidates = [
      root,
      ...root.querySelectorAll(
        '[class*="scroller"], [class*="scroll"], [style*="overflow"], [role="tree"], [role="list"]',
      ),
    ];
    for (let p = root.parentElement, depth = 0; p && depth < 4; p = p.parentElement, depth++) {
      candidates.push(p);
      if (p.tagName === 'NAV') break;
    }
    return [...new Set(candidates)].filter(
      (n) =>
        n.scrollHeight > n.clientHeight + 10 &&
        n.clientHeight > 0 &&
        /auto|scroll/.test(getComputedStyle(n).overflowY),
    );
  };
  const guildId = (node) => node.getAttribute('data-list-item-id')?.match(/^guildsnav___(\d+)$/)?.[1] || null;
  const guildNodes = () =>
    [...(guildBar()?.querySelectorAll('[data-list-item-id^="guildsnav___"]') || [])].filter((n) =>
      guildId(n),
    );
  const linkNodes = () => [
    ...document.querySelectorAll('nav a[href], [role="navigation"] a[href],#channels a[href]'),
  ];
  const expand = (root) => {
    if (!root) return;
    for (const node of root.querySelectorAll('[aria-expanded="false"]')) {
      if (node.matches('[role="treeitem"],button,[role="button"]') && !node.closest('[id^="chat-messages-"]'))
        node.click();
    }
  };
  async function traverse(getRoot, read, seek, expandFolders = true) {
    await checkpoint();
    if (!active()) return false;
    let root = getRoot();
    if (!root) return false;
    for (const s of scrolling(root)) s.scrollTop = 0;
    await wait(300);
    let unchanged = 0,
      last = '';
    for (let pass = 0; pass < 100 && active(); pass++) {
      root = getRoot();
      if (!root) return false;
      if (expandFolders) {
        expand(root);
        await wait(100);
      }
      read();
      if (seek?.()) return true;
      const scrolls = scrolling(root);
      const before = scrolls.map((s) => s.scrollTop);
      for (const s of scrolls)
        s.scrollTop = Math.min(s.scrollHeight, s.scrollTop + Math.max(150, s.clientHeight * 0.8));
      await wait(150);
      const signature = scrolls.map((s) => `${s.scrollTop}/${s.scrollHeight}`).join('|');
      unchanged = signature === last ? unchanged + 1 : 0;
      last = signature;
      const noMove = scrolls.every((s, i) => s.scrollTop === before[i]);
      if (unchanged >= 3 || (noMove && pass > 3)) break;
    }
    read();
    return !!seek?.();
  }
  async function until(predicate) {
    for (let i = 0; i < 30 && active(); i++) {
      if (predicate()) return true;
      await wait(150);
    }
    return false;
  }
  async function selectServer(id) {
    await checkpoint();
    if (!active()) return false;
    if (location.pathname.split('/')[2] === id) return true;
    const find = () => guildNodes().find((n) => guildId(n) === id);
    if (!find()) await traverse(guildBar, () => {}, find);
    const node = find();
    if (!node || !active()) return false;
    node.scrollIntoView({ block: 'nearest' });
    node.click();
    return until(() => location.pathname.split('/')[2] === id);
  }
  async function selectDM() {
    await checkpoint();
    if (!active()) return false;
    if (/^\/channels\/@me(?:\/|$)/.test(location.pathname)) return true;
    const home = () =>
      document.querySelector(
        'a[href="/channels/@me"],a[href="https://discord.com/channels/@me"],[data-list-item-id="guildsnav___home"]',
      );
    if (!home()) await traverse(guildBar, () => {}, home, false);
    const node = home();
    if (!node || !active()) return false;
    node.click();
    return until(() => location.pathname.startsWith('/channels/@me'));
  }
  const dmBar = () =>
    document.querySelector(
      'nav[aria-label*="privat" i],nav[aria-label*="direct" i],nav[aria-label*="messaggi" i]',
    ) || document.querySelector('[class*="privateChannels"]');
  return {
    describe(route) {
      const server = route.split('/')[2];
      const guild =
        server === '@me' ? null : document.querySelector(`[data-list-item-id="guildsnav___${server}"]`);
      const anchor = linkNodes().find((link) => core.route(link.getAttribute('href')) === route);
      const label = (node) =>
        (
          node?.closest('[data-dnd-name]')?.getAttribute('data-dnd-name') ||
          node?.getAttribute('aria-label') ||
          ''
        )
          .replace(/\s*\((?:text channel|canale testuale)\)\s*$/i, '')
          .trim()
          .slice(0, 120);
      return { serverName: label(guild), channelName: label(anchor) };
    },
    async servers() {
      const ids = new Set();
      progress('Finding servers in the sidebar…');
      await traverse(guildBar, () => guildNodes().forEach((n) => ids.add(guildId(n))));
      return [...ids].sort();
    },
    selectServer,
    selectDM,
    async channels(id) {
      const found = new Set();
      await traverse(channelBar, () => {
        const bar = channelBar();
        for (const a of bar?.querySelectorAll(
          'a[data-list-item-id^="channels___"][href],a[href^="/channels/"]',
        ) || []) {
          const r = core.route(a.getAttribute('href'));
          if (r?.split('/')[2] === id) found.add(r);
        }
        progress(`Finding channels · ${found.size} found…`);
      });
      return [...found].sort();
    },
    async dms() {
      const found = new Set();
      await traverse(
        dmBar,
        () => {
          for (const a of linkNodes()) {
            const r = core.route(a.getAttribute('href'));
            if (r?.startsWith('/channels/@me/')) found.add(r);
          }
        },
        null,
        false,
      );
      return [...found].sort();
    },
    async open(route, { textOnly = false } = {}) {
      await checkpoint();
      if (!active()) return false;
      if (core.pageRoute(location.pathname) === route) return true;
      const server = route.split('/')[2];
      if (server === '@me') {
        if (!(await selectDM())) return false;
      } else if (!(await selectServer(server))) return false;
      const find = () => linkNodes().find((a) => core.route(a.getAttribute('href')) === route);
      if (!find()) await traverse(server === '@me' ? dmBar : channelBar, () => {}, find, server !== '@me');
      const anchor = find();
      if (!anchor || !active()) return false;
      if (textOnly && server !== '@me') {
        const labels = [
          anchor.getAttribute('aria-label'),
          ...Array.from(anchor.querySelectorAll('[aria-label],title'), (node) =>
            node.getAttribute('aria-label') || node.textContent,
          ),
        ];
        if (core.channelType(labels) === 'other') return false;
      }
      anchor.scrollIntoView({ block: 'nearest' });
      anchor.click();
      return until(() => core.pageRoute(location.pathname) === route);
    },
  };
};
