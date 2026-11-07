globalThis.createAuditNavigation = (driver, active, progress = () => {}) => {
  async function* batches(scope, currentServer) {
    let servers = [];
    if (scope === 'current') {
      if (!/^\d+$/.test(String(currentServer))) {
        yield { routes: [], issues: [{ reason: 'Open a server before choosing Current server' }] };
        return;
      }
      servers = [currentServer];
    } else if (scope === 'servers' || scope === 'both') {
      try {
        servers = await driver.servers();
        if (!servers.length) throw Error('No servers found in the sidebar');
      } catch (error) {
        yield { routes: [], issues: [{ reason: error.message }] };
      }
    }

    for (const [index, server] of servers.entries()) {
      if (!active()) return;
      try {
        let routes = driver.cachedChannels?.(server);
        const label = `Server ${index + 1}/${servers.length}`;
        if (routes) {
          progress(`${label} · ${routes.length} cached channels`);
        } else {
          progress(`${label} · Finding channels…`);
          if (scope !== 'current' && !(await driver.selectServer(server))) {
            throw Error('Could not open the server');
          }
          if (!active()) return;
          routes = await driver.channels(server);
        }
        if (!active()) return;
        const serverRoutes = routes.filter((route) => route.split('/')[2] === server);
        if (!serverRoutes.length) throw Error('No channels found');
        yield { routes: serverRoutes, issues: [], label };
      } catch (error) {
        yield { routes: [], issues: [{ server, reason: error.message }] };
      }
    }

    if ((scope === 'dm' || scope === 'both') && active()) {
      progress('Finding direct messages…');
      try {
        if (!(await driver.selectDM())) throw Error('Could not open the direct message list');
        const routes = await driver.dms();
        if (active()) yield { routes, issues: [], label: 'DM' };
      } catch (error) {
        yield { routes: [], issues: [{ reason: error.message }] };
      }
    }
  }

  return {
    batches,
    async discover(scope, currentServer) {
      const routes = new Set();
      const issues = [];
      for await (const batch of batches(scope, currentServer)) {
        for (const route of batch.routes) routes.add(route);
        issues.push(...batch.issues);
      }
      return { routes: [...routes].sort(), issues };
    },
  };
};
