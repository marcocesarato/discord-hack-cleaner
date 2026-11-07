globalThis.DiscordAuditCache = {
  clean(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = { version: 1, servers: { ids: [], updatedAt: 0 }, channels: {} };
    const stamp = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
    result.servers = {
      ids: [
        ...new Set(
          (Array.isArray(source.servers?.ids) ? source.servers.ids : []).filter(
            (id) => typeof id === 'string' && /^\d{1,20}$/.test(id),
          ),
        ),
      ]
        .sort()
        .slice(0, 500),
      updatedAt: stamp(source.servers?.updatedAt),
    };
    for (const [id, entry] of Object.entries(source.channels || {}).slice(0, 500)) {
      if (!/^\d{1,20}$/.test(id)) continue;
      const routes = [
        ...new Set(
          (Array.isArray(entry?.routes) ? entry.routes : []).filter(
            (route) => typeof route === 'string' && new RegExp(`^/channels/${id}/\\d{1,20}$`).test(route),
          ),
        ),
      ]
        .sort()
        .slice(0, 1000);
      if (routes.length) result.channels[id] = { routes, updatedAt: stamp(entry.updatedAt) };
    }
    return result;
  },
  fresh(entry, now = Date.now()) {
    return (
      !!entry &&
      Number.isFinite(entry.updatedAt) &&
      entry.updatedAt > 0 &&
      now >= entry.updatedAt &&
      now - entry.updatedAt < 86400000
    );
  },
  wrap(driver, cache, save, active, refresh = false, progress = () => {}) {
    const self = this;
    const cachedChannels = (id) => {
      const entry = cache.channels[id];
      return !refresh && self.fresh(entry) && entry.routes.length ? entry.routes : null;
    };
    return {
      ...driver,
      cachedChannels,
      async servers() {
        if (!refresh && self.fresh(cache.servers) && cache.servers.ids.length) {
          progress(`Using ${cache.servers.ids.length} cached servers`);
          return cache.servers.ids;
        }
        const ids = await driver.servers();
        if (active() && ids.length) {
          cache.servers = { ids, updatedAt: Date.now() };
          await save(self.clean(cache));
        }
        return ids;
      },
      async channels(id) {
        const routesInCache = cachedChannels(id);
        if (routesInCache) {
          progress(`Using ${routesInCache.length} cached channels`);
          return routesInCache;
        }
        const routes = await driver.channels(id);
        if (active() && routes.length) {
          cache.channels[id] = { routes, updatedAt: Date.now() };
          await save(self.clean(cache));
        }
        return routes;
      },
    };
  },
};
