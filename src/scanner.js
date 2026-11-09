(() => {
  if (document.getElementById('discord-exact-audit')) return;
  const core = globalThis.DiscordAudit;
  let mode = globalThis.DiscordAuditMode === 'owner' ? 'owner' : 'user';
  const defaultHashes = [...new Set([
    ...core.referenceHashes(globalThis.DiscordAuditBundledReferences ?? []),
    ...core.referenceHashes(globalThis.DiscordAuditLocalReferences ?? []),
  ])];
  const referenceHashes = new Set();
  let readingReferences = false;
  const stateModel = globalThis.DiscordScanState;
  const host = document.createElement('div');
  host.id = 'discord-exact-audit';
  host.lang = 'en';
  const root = host.attachShadow({ mode: 'closed' });
  if (globalThis.DiscordAuditStyles) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(globalThis.DiscordAuditStyles);
    root.adoptedStyleSheets = [sheet];
  }
  document.body.append(host);
  const el = (tag, text) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  };
  const group = (tag, className, ...children) => {
    const node = el(tag);
    node.className = className;
    node.append(...children);
    return node;
  };
  const field = (name, control) => group('label', 'field', el('span', name), control);
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  file.multiple = true;
  const chooseImage = el('button', 'Add images');
  chooseImage.title = 'Find attachments identical to these images';
  const clearExtras = el('button', 'Clear added images');
  clearExtras.className = 'clear-images';
  clearExtras.hidden = true;
  const imageName = el(
    'span',
    defaultHashes.length ? `${defaultHashes.length} default images` : 'No images selected',
  );
  chooseImage.onclick = () => file.click();
  const imageField = group(
    'div',
    'field',
    el('span', 'Reference images'),
    group('div', 'file-picker', chooseImage, imageName, file),
    clearExtras,
  );
  const scope = el('select');
  scope.id = 'scan-scope';
  for (const [value, label] of [
    ['current', 'Current server'],
    ['servers', 'All servers'],
    ['dm', 'Direct messages only'],
    ['both', 'All servers and direct messages'],
  ]) {
    const option = el('option', label);
    option.value = value;
    scope.append(option);
  }
  scope.value = 'both';
  const ownedServer = el('select');
  const loadOwned = el('button', 'Load owned servers');
  const ownerHint = group(
    'p',
    'hint',
    document.createTextNode(
      'Choose one server to check messages from all authors. Other authors’ matches are review-only.',
    ),
  );
  const ownerSetup = group(
    'div',
    'stack',
    group('div', 'button-row', loadOwned),
    field('Owned server', ownedServer),
    ownerHint,
  );
  let ownedServers = [],
    loadingOwned = false,
    savedOwnedServer = '';
  function setOwnedServers(servers) {
    ownedServers = servers;
    const placeholder = el('option', servers.length ? 'Choose an owned server' : 'No owned servers loaded');
    placeholder.value = '';
    placeholder.disabled = true;
    ownedServer.replaceChildren(placeholder);
    for (const { id, name } of servers) {
      const option = el('option', name);
      option.value = id;
      ownedServer.append(option);
    }
    ownedServer.value = servers.some((server) => server.id === savedOwnedServer)
      ? savedOwnedServer
      : servers.length === 1
        ? servers[0].id
        : '';
  }
  const moderationFlag = el('input');
  moderationFlag.type = 'checkbox';
  const moderationHint = group(
    'p', 'hint',
    document.createTextNode('Requires ownership, Administrator, or Manage Messages.'),
  );
  const moderationSection = group(
    'div',
    'stack',
    group('label', 'check-row', moderationFlag, el('span', 'Include other authors')),
    moderationHint,
  );
  function updateModeration() {
    moderationSection.hidden = mode === 'owner' || scope.value !== 'current';
    moderationHint.hidden = !moderationFlag.checked;
  }
  scope.onchange = moderationFlag.onchange = updateModeration;
  updateModeration();
  const start = el('button', 'Start scan'),
    pauseButton = el('button', 'Pause'),
    stop = el('button', 'Stop'),
    close = el('button', '×'),
    save = el('button', 'Export report');
  start.className = 'primary';
  pauseButton.disabled = true;
  stop.disabled = true;
  pauseButton.hidden = stop.hidden = true;
  close.className = 'subtle panel-icon close-panel';
  close.title = 'Close';
  close.setAttribute('aria-label', 'Close');
  const accountSetupStatus = 'Set your Discord user ID in Settings to get started.';
  const scanSetupStatus = 'Check the dates and scan scope, then start.';
  const status = el(
    'p',
    mode === 'owner'
      ? 'Load your owned servers to start.'
      : accountSetupStatus,
  );
  status.className = 'status';
  status.setAttribute('role', 'status');
  const progressMatches = group('span', 'progress-matches');
  progressMatches.hidden = true;
  progressMatches.setAttribute('aria-live', 'polite');
  const progressScanned = group('span', 'hint');
  progressScanned.hidden = true;
  const list = el('div');
  list.className = 'match-list';
  const matchGroups = new Map();
  const suspiciousList = group('div', 'stack');
  const suspiciousSummary = el('summary', 'Suspicious messages · 0');
  const suspiciousPanel = group('details', '', suspiciousSummary, suspiciousList);
  suspiciousPanel.hidden = true;
  const suspiciousFlag = el('input');
  suspiciousFlag.type = 'checkbox';
  const scamDomainsInput = el('input');
  scamDomainsInput.type = 'text';
  scamDomainsInput.placeholder = 'example.test, another.test';
  scamDomainsInput.spellcheck = false;
  const scamDomainField = field('Known scam domains (optional)', scamDomainsInput);
  scamDomainField.hidden = true;
  suspiciousFlag.onchange = () => {
    scamDomainField.hidden = !suspiciousFlag.checked;
  };
  const reviewReport = el('button', 'Review a saved report');
  reviewReport.onclick = () =>
    chrome.runtime
      .sendMessage({ type: 'openReportViewer' })
      .then((result) => {
        if (result.error) status.textContent = result.error;
      })
      .catch((e) => {
        status.textContent = e.message;
      });
  const refreshCache = el('input');
  refreshCache.type = 'checkbox';
  const refreshLabel = group(
    'label',
    'check-row',
    refreshCache,
    el('span', 'Refresh server and channel lists on this scan'),
  );
  const clearCache = el('button', 'Clear cache');
  const cacheInfo = el('p', 'Set your user ID to use the cache.');
  cacheInfo.className = 'hint';
  const excludedMatches = new Set();
  const matchChecks = new Map();
  const selectAll = el('button', 'Select all');
  const selectNone = el('button', 'Clear selection');
  const remove = el('button', 'Review selected matches');
  remove.className = 'primary';
  const botRemove = el('button', 'Delete selected with bot…');
  botRemove.className = 'danger';
  const reviewStatus = group('p', 'hint');
  const botToken = el('input');
  botToken.type = 'password';
  botToken.id = 'discord-bot-token';
  botToken.autocomplete = 'off';
  botToken.spellcheck = false;
  const saveBot = el('button', 'Connect bot');
  const forgetBot = el('button', 'Disconnect bot');
  const botStatus = group('p', 'hint');
  let botReady = false;
  let reviewQueue = null;
  const scopeHint = el('p', 'Server scans include text channels you can read.');
  scopeHint.className = 'hint';
  const account = el('input');
  account.id = 'discord-user-id';
  account.inputMode = 'numeric';
  account.autocomplete = 'off';
  account.maxLength = 20;
  let savedAuthor = null;
  const configuredAuthor = () => savedAuthor;
  const oauthToken = el('input');
  oauthToken.type = 'password';
  oauthToken.id = 'discord-oauth-token';
  oauthToken.autocomplete = 'off';
  oauthToken.spellcheck = false;
  oauthToken.placeholder = 'Enter a new access token';
  const saveAccount = el('button');
  saveAccount.className = 'primary panel-icon save-settings';
  saveAccount.title = 'Save settings';
  saveAccount.setAttribute('aria-label', saveAccount.title);
  const accountStatus = group('p', 'status');
  accountStatus.setAttribute('role', 'status');
  const forgetToken = el('button', 'Forget saved OAuth2 token');
  const recoveryGuide = el('button', 'FAQ');
  const oauthGuide = el('button', 'How to get an OAuth2 access token');
  oauthGuide.className = 'settings-link';
  const openFaq = (section) =>
    chrome.runtime
      .sendMessage({ type: 'openRecoveryGuide', section })
      .then((result) => {
        if (result?.error) accountStatus.textContent = result.error;
      })
      .catch((error) => {
        accountStatus.textContent = error.message;
      });
  recoveryGuide.onclick = () => openFaq();
  oauthGuide.onclick = () => openFaq('oauth2');
  const from = el('input');
  from.type = 'datetime-local';
  from.required = true;
  const startHere = el('button', 'Set as start');
  const endHere = el('button', 'Set as end');
  const scanSearch = el('button', 'Check visible results');
  const copyQuery = el('button', 'Copy Discord search');
  const searchQuery = el('input');
  searchQuery.type = 'text';
  searchQuery.readOnly = true;
  searchQuery.placeholder = 'Discord search query';
  const queryField = field('Copy this search text', searchQuery);
  queryField.hidden = true;
  const importPackage = el('button', 'Scan Discord data package');
  const scanConversation = el('button', 'Scan this conversation');
  const packageFile = el('input');
  packageFile.type = 'file';
  packageFile.accept = '.zip';
  packageFile.hidden = true;
  const to = el('input');
  to.type = 'datetime-local';
  to.required = true;
  const rangeFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const resultsRange = el('p');
  resultsRange.className = 'hint';
  resultsRange.hidden = true;
  const resumeScan = el('button', 'Resume saved scan');
  resumeScan.disabled = true;
  const exportState = el('button', 'Export scan state');
  exportState.disabled = true;
  const importState = el('button', 'Import scan or report');
  const saveLocal = el('button', 'Save in browser');
  const showCheckpoint = el('button', 'Show saved scan');
  showCheckpoint.hidden = true;
  const stateFile = el('input');
  stateFile.type = 'file';
  stateFile.accept = '.json,application/json';
  stateFile.hidden = true;
  const stateInfo = el('p', 'No saved scan.');
  stateInfo.className = 'hint';
  const formatWindow = (window) =>
    rangeFormat.formatRange(new Date(window.start), new Date(window.endExclusive)) + ' · Local time';
  const toggle = el('button');
  toggle.className = 'subtle panel-icon collapse-panel';
  toggle.title = 'Collapse';
  toggle.setAttribute('aria-label', 'Collapse');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', 'cleanup-panel-body');
  const previousMatch = el('button', '‹'),
    nextMatch = el('button', '›');
  for (const [button, label] of [
    [previousMatch, 'Previous match'],
    [nextMatch, 'Next match'],
  ]) {
    button.className = 'nav-arrow subtle';
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  const matchPosition = group('span', 'match-position');
  matchPosition.setAttribute('aria-live', 'polite');
  const matchNav = group('div', 'match-nav', previousMatch, matchPosition, nextMatch);
  const settingsButton = el('button', '⚙');
  settingsButton.className = 'subtle settings-toggle';
  settingsButton.title = 'Settings';
  settingsButton.setAttribute('aria-label', 'Settings');
  settingsButton.setAttribute('aria-controls', 'cleanup-settings');
  settingsButton.setAttribute('aria-expanded', 'false');
  const closeSettings = el('button', '×');
  closeSettings.className = 'subtle panel-icon close-panel';
  closeSettings.title = 'Close settings';
  closeSettings.setAttribute('aria-label', closeSettings.title);
  const settingsPanel = group(
    'aside',
    'settings-panel',
    group(
      'header',
      'panel-header',
      el('h2', 'Settings'),
      group('div', 'toolbar', saveAccount, closeSettings),
    ),
    group(
      'div',
      'settings-body stack',
      field('Your Discord user ID', account),
      group(
        'p',
        'hint',
        document.createTextNode('Paste your user ID, or leave it blank and use an OAuth2 access token to fill it.'),
      ),
      field('Discord OAuth2 access token (optional)', oauthToken),
      group(
        'p',
        'hint',
        document.createTextNode(
          'Used to verify owner and moderator permissions. Leave blank to keep the saved token.',
        ),
      ),
      oauthGuide,
      group('div', 'button-row', forgetToken),
      accountStatus,
      group('div', 'button-row', recoveryGuide),
      group('section', 'stack', el('h2', 'Server bot'),
        field('Bot token for this browser session', botToken),
        group('div', 'button-row', saveBot, forgetBot), botStatus),
    ),
  );
  settingsPanel.id = 'cleanup-settings';
  settingsPanel.hidden = true;
  const resultsButton = el('button', 'Results');
  resultsButton.setAttribute('aria-controls', 'cleanup-results');
  resultsButton.setAttribute('aria-expanded', 'false');
  const closeResults = el('button', '×');
  closeResults.className = 'subtle panel-icon close-panel';
  closeResults.title = 'Close results';
  closeResults.setAttribute('aria-label', closeResults.title);
  const resultsPanel = group(
    'aside',
    'results-panel',
    group('header', 'panel-header', el('h2', 'Scan results'), closeResults),
    group(
      'div',
      'settings-body stack',
      resultsRange,
      reviewStatus,
      group('div', 'button-row', selectAll, selectNone, remove, botRemove),
      list,
      suspiciousPanel,
      group('div', 'button-row', save, reviewReport),
    ),
  );
  resultsPanel.id = 'cleanup-results';
  resultsPanel.hidden = true;
  const header = group(
    'header',
    'panel-header',
    el('h1', 'Discord Hack Cleaner'),
    group('div', 'toolbar', matchNav, settingsButton, toggle, close),
  );
  const scopeField = field('Scan scope', scope);
  scopeField.className += ' scope-field';
  const userSetup = group('div', 'stack', scopeField, moderationSection);
  const advanced = group(
    'details',
    'scan-tools',
    el('summary', 'Advanced tools'),
    group('div', 'stack',
      group('section', 'stack',
        el('h2', 'Shortcuts'),
        group('div', 'button-row', scanConversation),
        scopeHint,
        group('p', 'hint', document.createTextNode('With a message link open, use its time for either boundary.')),
        group('div', 'button-row', startHere, endHere)),
      group('section', 'stack',
        el('h2', 'Discord search'),
        group('p', 'hint', document.createTextNode('Copy the search, paste it into Discord, then check the results on the visible page.')),
        group('div', 'button-row', copyQuery, scanSearch),
        queryField),
      group('section', 'stack',
        el('h2', 'Data package'),
        group('div', 'button-row', importPackage),
        packageFile),
      group('details', '', el('summary', 'Scan cache'),
        group('div', 'stack', cacheInfo, refreshLabel, group('div', 'button-row', clearCache))),
    ),
  );
  const body = group(
    'div',
    'panel-body',
    group(
      'section',
      'incident stack',
      el('h2', 'Incident window'),
      group('div', 'incident-dates', field('Start', from), field('End', to)),
      group('p', 'hint', document.createTextNode('Local time · stops before the end time')),
    ),
    group(
      'section',
      'stack',
      userSetup,
      ownerSetup,
      imageField,
      group('label', 'check-row', suspiciousFlag, el('span', 'Flag suspicious messages')),
      scamDomainField,
    ),
    group(
      'details',
      '',
      el('summary', 'Saved scan'),
      group(
        'div',
        'stack',
        stateInfo,
        group('div', 'button-row', importState, resumeScan, saveLocal, exportState, showCheckpoint),
        stateFile,
      ),
    ),
    advanced,
  );
  body.id = 'cleanup-panel-body';
  const footer = group(
    'footer',
    'panel-footer',
    group('div', 'progress-row', status, group('div', 'progress-counts', progressMatches, progressScanned)),
    group('div', 'row', start, pauseButton, stop, resultsButton),
  );
  root.append(header, body, footer, settingsPanel, resultsPanel);
  let running = false,
    report = { author: null, channels: [], matches: [], unverified: [], complete: false };
  let checkpoint = null,
    savedState = null,
    lastSave = 0,
    saveQueue = Promise.resolve(),
    openingMessage = false,
    scanning = false;
  function selectedMatches() {
    const removed = new Set((report.deletions || []).filter((entry) => ['deleted', 'missing'].includes(entry.status)).map((entry) => entry.id));
    return report.matches.filter((match) => !excludedMatches.has(match.id) && !removed.has(match.id));
  }
  function syncReview() {
    const selected = selectedMatches();
    const blocked = start.disabled || loadingOwned;
    const server = report.currentServer;
    remove.disabled = blocked || !selected.length;
    botRemove.hidden = !botReady || !server || report.source === 'archive' || report.author !== configuredAuthor();
    botRemove.disabled = blocked || !selected.length;
    selectAll.disabled = selectNone.disabled = blocked || !report.matches.length;
    const outcomes = new Map((report.deletions || []).map((entry) => [entry.id, entry]));
    for (const [id, { checkbox, outcomeLabel }] of matchChecks) {
      const outcome = outcomes.get(id);
      checkbox.disabled = blocked || ['deleted', 'missing'].includes(outcome?.status);
      checkbox.checked = !excludedMatches.has(id) && !['deleted', 'missing'].includes(outcome?.status);
      outcomeLabel.hidden = !outcome;
      outcomeLabel.textContent = outcome?.status === 'deleted' ? 'Deleted' :
        outcome?.status === 'missing' ? 'Already missing' : outcome?.reason || 'Needs verification';
    }
    const unverified = (report.deletions || []).filter((entry) => entry.status === 'unverified').length;
    const deleted = (report.deletions || []).filter((entry) => entry.status === 'deleted').length;
    reviewStatus.textContent = `${selected.length} selected · ${deleted} deleted · ${unverified} deletions to verify`;
  }
  selectAll.onclick = () => {
    excludedMatches.clear();
    syncReview();
  };
  selectNone.onclick = () => {
    for (const match of report.matches) excludedMatches.add(match.id);
    syncReview();
  };
  let matchCursor = -1;
  let scannedInWindow = 0;
  const scanStorage = chrome.storage?.local;
  const settingsKey = 'discordCleanupSettings_v1';
  let settingsReady = !scanStorage;
  let settingsQueue = Promise.resolve();
  function saveSettings() {
    if (!scanStorage || !settingsReady) return Promise.resolve(false);
    const settings = {
      author: configuredAuthor() || '',
      from: from.value,
      to: to.value,
      scope: scope.value,
      ownedServer: savedOwnedServer,
      referenceHashes: [...referenceHashes],
    };
    settingsQueue = settingsQueue
      .then(() => scanStorage.set({ [settingsKey]: settings }))
      .then(() => true)
      .catch(() => {
        status.textContent = 'Could not save settings.';
        return false;
      });
    return settingsQueue;
  }
  function applySettings(settings) {
    if (!settings) return;
    savedAuthor = core.accountId(settings.author);
    account.value = savedAuthor || '';
    for (const [control, value] of [
      [from, settings.from],
      [to, settings.to],
    ]) {
      if (typeof value === 'string') control.value = value;
    }
    if (['current', 'servers', 'dm', 'both'].includes(settings.scope)) scope.value = settings.scope;
    if (typeof settings.ownedServer === 'string' && /^\d{1,20}$/.test(settings.ownedServer))
      savedOwnedServer = settings.ownedServer;
    if (Array.isArray(settings.referenceHashes)) {
      for (const hash of core.referenceHashes(settings.referenceHashes)) referenceHashes.add(hash);
      showReferences();
    }
    updateModeration();
  }
  function updatePanelLayout() {
    host.className = body.hidden
      ? 'cleanup-collapsed'
      : settingsPanel.hidden && resultsPanel.hidden
        ? ''
        : 'cleanup-side-open';
  }
  function setSettingsOpen(open) {
    if (open && body.hidden) setCollapsed(false);
    if (open) setResultsOpen(false);
    settingsPanel.hidden = !open;
    settingsButton.setAttribute('aria-expanded', String(open));
    updatePanelLayout();
    if (open) {
      closeSettings.focus?.();
      void refreshTokenStatus();
    }
  }
  settingsButton.onclick = () => setSettingsOpen(settingsPanel.hidden);
  closeSettings.onclick = () => {
    setSettingsOpen(false);
    settingsButton.focus?.();
  };
  settingsPanel.onkeydown = (event) => {
    if (event.key === 'Escape') closeSettings.onclick();
  };
  function setResultsOpen(open) {
    if (open && body.hidden) setCollapsed(false);
    if (open) setSettingsOpen(false);
    resultsPanel.hidden = !open;
    resultsButton.setAttribute('aria-expanded', String(open));
    updatePanelLayout();
    if (open) closeResults.focus?.();
  }
  resultsButton.onclick = () => setResultsOpen(resultsPanel.hidden);
  closeResults.onclick = () => {
    setResultsOpen(false);
    resultsButton.focus?.();
  };
  resultsPanel.onkeydown = (event) => {
    if (event.key === 'Escape') closeResults.onclick();
  };
  function setCollapsed(collapsed) {
    body.hidden = footer.hidden = collapsed;
    if (collapsed) {
      setSettingsOpen(false);
      setResultsOpen(false);
    }
    updatePanelLayout();
    toggle.title = collapsed ? 'Expand' : 'Collapse';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    syncMatchToolbar();
  }
  toggle.onclick = () => setCollapsed(!body.hidden);
  function syncMatchToolbar() {
    const count = report.matches.length;
    const totalResults = count + (report.suspicious?.length || 0);
    resultsButton.textContent = totalResults ? `Results · ${totalResults}` : 'Results';
    progressMatches.hidden = !scanning && !report.start && !count;
    progressMatches.textContent = `${count} ${count === 1 ? 'match' : 'matches'} found`;
    progressScanned.hidden = !report.start;
    progressScanned.textContent = `${scannedInWindow} scanned`;
    const blocked = start.disabled && !scanning;
    matchNav.hidden = !body.hidden || count === 0;
    const queue = reviewQueue || report.matches;
    const index = queue.indexOf(report.matches[matchCursor]);
    matchPosition.textContent = index < 0 ? `${queue.length} found` : `${index + 1} / ${queue.length}`;
    previousMatch.disabled = blocked || index <= 0;
    nextMatch.disabled = blocked || index >= queue.length - 1;
  }
  function activateMatch(match) {
    matchCursor = report.matches.indexOf(match);
    setCollapsed(true);
  }
  function moveMatch(step) {
    const current = report.matches[matchCursor];
    const queue = reviewQueue || report.matches;
    const match = queue[queue.findIndex((item) => item.id === current?.id) + step];
    if (!match || (start.disabled && !scanning)) return;
    activateMatch(match);
    if (scanning) window.open(match.url, '_blank', 'noopener,noreferrer');
    else return openMessageHere(match);
  }
  previousMatch.onclick = () => moveMatch(-1);
  nextMatch.onclick = () => moveMatch(1);
  function syncMode() {
    const owner = mode === 'owner';
    userSetup.hidden = owner;
    ownerSetup.hidden = !owner;
    updateModeration();
  }
  setOwnedServers([]);
  syncMode();
  syncMatchToolbar();
  globalThis.DiscordAuditPanel = {
    show(requestedMode) {
      if (document.getElementById(host.id) !== host) return false;
      setCollapsed(false);
      if (mode !== requestedMode) {
        if (start.disabled || loadingOwned) {
          status.textContent = 'Finish or stop the current operation before switching scan modes.';
          return true;
        }
        mode = requestedMode;
        moderationFlag.checked = false;
        syncMode();
        status.textContent =
          mode === 'owner'
            ? ownedServers.length
              ? 'Choose an owned server to scan.'
              : 'Load your owned servers to start.'
            : 'Ready to scan your messages.';
        if (mode === 'owner') void refreshTokenStatus();
      }
      return true;
    },
  };
  function updateSavedScan() {
    resumeScan.disabled = start.disabled || loadingOwned || !savedState || savedState.finished;
    importState.disabled = start.disabled || loadingOwned || !settingsReady;
    exportState.disabled = !checkpoint && !savedState;
    saveLocal.disabled = !checkpoint && !savedState;
    clearExtras.disabled = start.disabled || readingReferences;
    moderationFlag.disabled = start.disabled;
    loadOwned.disabled = start.disabled || loadingOwned;
    ownedServer.disabled = start.disabled || loadingOwned || ownedServers.length === 0;
    account.disabled =
      oauthToken.disabled =
      saveAccount.disabled =
        start.disabled || loadingOwned || !settingsReady;
    forgetToken.disabled = account.disabled || !configuredAuthor();
    saveBot.disabled = forgetBot.disabled = account.disabled || !configuredAuthor();
    copyQuery.disabled = scanSearch.disabled = start.disabled;
    startHere.disabled = endHere.disabled = start.disabled;
    importPackage.disabled = scanConversation.disabled = start.disabled || !settingsReady;
    syncReview();
    syncMatchToolbar();
  }
  loadOwned.onclick = async () => {
    if (start.disabled || loadingOwned) return;
    const author = configuredAuthor();
    if (!author) {
      setSettingsOpen(true);
      status.textContent = 'Save your Discord user ID in Settings first.';
      return;
    }
    loadingOwned = true;
    updateSavedScan();
    status.textContent = 'Verifying server ownership…';
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'listOwnedServers',
        author,
      });
      if (!Array.isArray(result?.servers)) throw Error(result?.error || 'Could not verify owned servers.');
      setOwnedServers(result.servers);
      savedOwnedServer = ownedServer.value;
      saveSettings();
      status.textContent = result.servers.length
        ? 'Choose an owned server to scan.'
        : 'Discord returned no owned servers for this account.';
    } catch (error) {
      setOwnedServers([]);
      status.textContent = error.message;
    } finally {
      loadingOwned = false;
      updateSavedScan();
    }
  };
  updateSavedScan();
  function showSavedScan(state) {
    savedState = state;
    const summary = `${state.report.channels.length} channel records · ${state.report.matches.length} exact matches.`;
    stateInfo.textContent = state.finished
      ? `Finished scan · ${summary}`
      : `Saved scan · ${summary} Resume uses this scan’s original reference hashes.`;
    updateSavedScan();
  }
  function persistCheckpoint(snapshot) {
    showSavedScan(snapshot);
    if (!scanStorage) {
      stateInfo.textContent = 'Browser storage is unavailable. Export scan state to keep your progress.';
      return Promise.resolve(false);
    }
    stateInfo.textContent = 'Saving scan in this browser…';
    saveQueue = saveQueue
      .then(() => scanStorage.set({ [stateModel.key]: snapshot }))
      .then(() => {
        if (savedState === snapshot) showSavedScan(snapshot);
        return true;
      })
      .catch((error) => {
        if (savedState === snapshot) {
          const reason = error?.message || String(error);
          stateInfo.textContent = `Browser save failed. ${reason} Use Export scan state to keep your progress.`;
        }
        return false;
      });
    return saveQueue;
  }
  function saveCheckpoint(force = false) {
    if (!checkpoint || (!force && Date.now() - lastSave < 2000)) return;
    lastSave = Date.now();
    checkpoint.savedAt = new Date().toISOString();
    return persistCheckpoint(stateModel.clean(checkpoint));
  }
  function displayReport(value) {
    report = value;
    scannedInWindow = report.channels.reduce((total, channel) => total + (channel.messagesInWindow || 0), 0);
    matchCursor = -1;
    reviewQueue = null;
    excludedMatches.clear();
    matchChecks.clear();
    resultsRange.hidden = !report.start;
    if (report.start) resultsRange.textContent = formatWindow(report);
    list.replaceChildren();
    matchGroups.clear();
    for (const match of report.matches) renderMatch(match);
    resetSuspiciousList();
    updateSavedScan();
  }
  function resetSuspiciousList() {
    suspiciousList.replaceChildren();
    suspiciousPanel.hidden = !report.detectSuspicious;
    suspiciousSummary.textContent = 'Suspicious messages · 0';
    for (const match of report.suspicious || []) renderSuspicious(match);
  }
  function renderSuspicious(match) {
    const link = el('a', 'Open message');
    link.href = match.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.onclick = (event) => {
      if (scanning) return;
      event.preventDefault();
      if (!start.disabled) void openMessageHere(match);
    };
    const time = rangeFormat.format(new Date(core.timestamp(match.id)));
    suspiciousList.append(
      group('div', 'match-row', el('span', time + ' · ' + match.reasons.join(' · ')), link),
    );
    suspiciousSummary.textContent = `Suspicious messages · ${suspiciousList.children.length}`;
    syncMatchToolbar();
  }
  function restoreSavedScan(state) {
    checkpoint = null;
    showCheckpoint.hidden = true;
    showSavedScan(state);
    displayReport(state.report);
    status.textContent = state.finished
      ? 'Finished scan restored.'
      : 'Saved scan restored. Select Resume saved scan to continue.';
  }
  if (scanStorage)
    scanStorage
      .get(stateModel.key)
      .then((items) => {
        if (!checkpoint && !savedState && items[stateModel.key])
          restoreSavedScan(stateModel.clean(items[stateModel.key]));
      })
      .catch(() => {
        stateInfo.textContent = 'Could not read the saved scan.';
      });
  if (scanStorage) {
    chooseImage.disabled = scope.disabled = from.disabled = to.disabled = true;
    scanStorage
      .get(settingsKey)
      .then((items) => applySettings(items[settingsKey]))
      .catch(() => {
        status.textContent = 'Could not read saved settings.';
      })
      .finally(() => {
        settingsReady = true;
        chooseImage.disabled = scope.disabled = from.disabled = to.disabled = false;
        if (configuredAuthor() && status.textContent === accountSetupStatus)
          status.textContent = scanSetupStatus;
        updateSavedScan();
        void refreshCacheInfo();
        void refreshBotStatus();
        if (mode === 'owner') void refreshTokenStatus();
      });
  }
  async function refreshTokenStatus() {
    const author = configuredAuthor();
    if (!author || loadingOwned) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'oauthTokenStatus', author });
      if (author === configuredAuthor() && !loadingOwned && typeof result?.saved === 'boolean') {
        accountStatus.textContent = result.saved
          ? 'An OAuth2 token is saved for this account.'
          : 'No OAuth2 token is saved for this account.';
        if (result.saved && mode === 'owner' && !ownedServers.length) void loadOwned.onclick();
      }
    } catch {
      accountStatus.textContent = 'Could not check the saved token.';
    }
  }
  saveAccount.onclick = async () => {
    if (saveAccount.disabled) return;
    let author = core.accountId(account.value?.trim());
    let token = oauthToken.value?.trim();
    if (!author && token && !account.value?.trim()) {
      loadingOwned = true;
      updateSavedScan();
      try {
        const result = await chrome.runtime.sendMessage({ type: 'saveOAuthToken', token });
        author = core.accountId(result?.author);
        if (!author) throw Error(result?.error || 'Could not identify the Discord account.');
        token = '';
        oauthToken.value = '';
      } catch (error) {
        accountStatus.textContent = error.message;
        return;
      } finally {
        loadingOwned = false;
        updateSavedScan();
      }
    }
    if (!author) {
      accountStatus.textContent = 'Enter a valid Discord user ID.';
      return;
    }
    if (author !== configuredAuthor()) {
      savedAuthor = author;
      savedOwnedServer = '';
      setOwnedServers([]);
    }
    account.value = author;
    loadingOwned = true;
    updateSavedScan();
    remove.disabled = true;
    let saved = false;
    try {
      saved = await saveSettings();
      if (!saved) throw Error('Could not save settings in the browser.');
      if (token) {
        accountStatus.textContent = 'Verifying the OAuth2 access token…';
        const result = await chrome.runtime.sendMessage({ type: 'saveOAuthToken', author, token });
        if (!result?.ok) throw Error(result?.error || 'Could not save the OAuth2 access token.');
        oauthToken.value = '';
      }
      accountStatus.textContent = token ? 'User ID and OAuth2 token saved.' : 'User ID saved.';
      if (status.textContent === accountSetupStatus)
        status.textContent = scanSetupStatus;
    } catch (error) {
      accountStatus.textContent = saved ? `User ID saved. ${error.message}` : error.message;
    } finally {
      loadingOwned = false;
      updateSavedScan();
      void refreshCacheInfo();
      void refreshBotStatus();
      if (saved && mode === 'owner') void refreshTokenStatus();
    }
  };
  ownedServer.onchange = () => {
    savedOwnedServer = ownedServer.value;
    saveSettings();
  };
  scope.onchange = () => {
    updateModeration();
    saveSettings();
  };
  from.onchange = to.onchange = saveSettings;
  forgetToken.onclick = async () => {
    const author = configuredAuthor();
    if (!author || start.disabled || loadingOwned) return;
    loadingOwned = true;
    updateSavedScan();
    try {
      const result = await chrome.runtime.sendMessage({ type: 'forgetOAuthToken', author });
      if (result?.error) throw Error(result.error);
      oauthToken.value = '';
      setOwnedServers([]);
      accountStatus.textContent = 'Saved OAuth2 access token cleared.';
    } catch (error) {
      accountStatus.textContent = error.message;
    } finally {
      loadingOwned = false;
      updateSavedScan();
    }
  };
  function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  exportState.onclick = () => {
    const state = checkpoint || savedState;
    if (state) downloadJSON(stateModel.clean(state), 'discord-cleanup-scan-state.json');
  };
  saveLocal.onclick = async () => {
    const saved = checkpoint
      ? await saveCheckpoint(true)
      : savedState && (await persistCheckpoint(savedState));
    if (saved) status.textContent = 'Scan saved in this browser.';
  };
  showCheckpoint.onclick = () => {
    if (!start.disabled && savedState) restoreSavedScan(savedState);
  };
  importState.onclick = () => stateFile.click();
  stateFile.onchange = async () => {
    const selected = stateFile.files[0];
    if (!selected || importState.disabled) return;
    start.disabled = true;
    updateSavedScan();
    try {
      const source = JSON.parse(await selected.text());
      if (host.isConnected === false) return;
      if (source?.report) {
        const imported = stateModel.clean(source);
        restoreSavedScan(imported);
        await persistCheckpoint(imported);
      } else {
        const { entries, ignored } = globalThis.DiscordReport.read(source);
        checkpoint = null;
        showCheckpoint.hidden = !savedState;
        const suspicious =
          source.detectSuspicious === true
            ? stateModel.clean({ version: 1, report: source }).report.suspicious
            : [];
        displayReport({
          author: null,
          matches: entries,
          channels: [],
          unverified: [],
          complete: false,
          detectSuspicious: source.detectSuspicious === true,
          suspicious,
        });
        status.textContent = `Report imported for review · ${entries.length} ${entries.length === 1 ? 'match' : 'matches'} · ${ignored} skipped entries.`;
      }
    } catch (error) {
      status.textContent = `Import failed. ${error.message}`;
    } finally {
      stateFile.value = '';
      start.disabled = false;
      updateSavedScan();
    }
  };
  async function jumpToRow(target, route, id) {
    const messageRow = () => core.pageRoute(location.pathname) === route
      ? document.getElementById(`chat-messages-${route.split('/')[3]}-${id}`) : null;
    if (messageRow()) return messageRow();
    const previousURL = location.href;
    const previousState = history.state;
    const nextState = { ...previousState, key: Math.random().toString(36).slice(2, 10) };
    if (Number.isInteger(previousState?.idx)) nextState.idx = previousState.idx + 1;
    history.pushState(nextState, '', target);
    dispatchEvent(new PopStateEvent('popstate', { state: nextState }));
    try {
      for (let attempt = 0; attempt < 40 && (openingMessage || running); attempt++) {
        const row = messageRow();
        if (row) return row;
        if (location.pathname !== target) break;
        await pause(125);
      }
      throw Error('Discord did not load the message in this tab.');
    } catch (error) {
      if (location.pathname === target) {
        history.replaceState(previousState, '', previousURL);
        dispatchEvent(new PopStateEvent('popstate', { state: previousState }));
      }
      throw error;
    }
  }

  async function openMessageHere(match) {
    if (openingMessage) return false;
    openingMessage = true;
    start.disabled = true;
    updateSavedScan();
    try {
      const target = new URL(match.url).pathname;
      const route = target.slice(0, target.lastIndexOf('/'));
      const row = await jumpToRow(target, route, match.id);
      row.scrollIntoView({ block: 'center' });
      status.textContent = 'Message opened in this tab.';
      return true;
    } catch (error) {
      status.textContent = error.message + ' Open the link from Results to try in a separate tab.';
      return false;
    } finally {
      openingMessage = false;
      start.disabled = false;
      updateSavedScan();
    }
  }

  function resultGroup(parent, name, open, kind) {
    const title = el('span', name);
    title.className = 'result-name';
    const badge = el('span', '0');
    badge.className = 'result-count';
    const children = group('div', 'result-children');
    const details = group(
      'details',
      `result-group ${kind}`,
      group('summary', '', group('span', 'result-summary', title, badge)),
      children,
    );
    details.open = open;
    parent.append(details);
    return { title, badge, children, count: 0 };
  }
  function incrementGroup(group) {
    group.count++;
    group.badge.textContent = String(group.count);
    group.badge.setAttribute('aria-label', `${group.count} ${group.count === 1 ? 'match' : 'matches'}`);
  }
  function renderMatch(match) {
    const [, , serverId, channelId] = new URL(match.url).pathname.split('/');
    const isDM = serverId === '@me';
    let server = matchGroups.get(serverId);
    if (!server) {
      server = resultGroup(
        list,
        isDM ? 'Direct messages' : match.serverName || `Server ${serverId}`,
        matchGroups.size === 0,
        'result-server',
      );
      server.channels = new Map();
      matchGroups.set(serverId, server);
    }
    if (!isDM && match.serverName) server.title.textContent = match.serverName;
    let channel = server.channels.get(channelId);
    if (!channel) {
      channel = resultGroup(
        server.children,
        match.channelName || (isDM ? `Conversation ${channelId}` : `Channel ${channelId}`),
        server.channels.size === 0,
        'result-channel',
      );
      server.channels.set(channelId, channel);
    }
    if (match.channelName) channel.title.textContent = match.channelName;
    incrementGroup(server);
    incrementGroup(channel);
    const time = rangeFormat.format(new Date(match.time));
    const link = el('a', 'Open message');
    link.href = match.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.onclick = (event) => {
      if (start.disabled && !scanning) {
        event.preventDefault();
        return;
      }
      activateMatch(match);
      toggle.focus?.({ preventScroll: true });
      if (scanning) return;
      event.preventDefault();
      return openMessageHere(match);
    };
    const label = group('span', 'match-label', el('span', `Exact match · ${time}`));
    if (match.everyone) label.append(group('span', 'mention-tag', document.createTextNode('@everyone')));
    if (report.author && match.author !== report.author)
      label.append(group('span', 'hint', document.createTextNode('Other author')));
    const outcomeLabel = group('span', 'hint');
    outcomeLabel.hidden = true;
    label.append(outcomeLabel);
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !excludedMatches.has(match.id);
    checkbox.setAttribute('aria-label', `Select exact match from ${time}`);
    checkbox.onchange = () => {
      if (checkbox.checked) excludedMatches.delete(match.id);
      else excludedMatches.add(match.id);
      syncReview();
    };
    matchChecks.set(match.id, { checkbox, outcomeLabel });
    channel.children.append(group('div', 'match-row', checkbox, label, link));
    syncMatchToolbar();
  }
  let resumeOperation = null,
    pauseGate = null,
    previousStatus = '';
  const waitUntilResumed = async () => {
    while (pauseGate && running) await pauseGate;
  };
  const pause = async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await waitUntilResumed();
  };
  function releasePause() {
    pauseGate = null;
    resumeOperation?.();
    resumeOperation = null;
    pauseButton.textContent = 'Pause';
  }
  function setOperationControls(active) {
    if (!active) releasePause();
    pauseButton.disabled = stop.disabled = !active;
    pauseButton.hidden = stop.hidden = !active;
  }
  pauseButton.onclick = () => {
    if (!running) return;
    if (pauseGate) {
      status.textContent = previousStatus;
      releasePause();
    } else {
      previousStatus = status.textContent;
      pauseGate = new Promise((resolve) => {
        resumeOperation = resolve;
      });
      pauseButton.textContent = 'Resume';
      status.textContent = 'Paused. The current request may finish.';
      if (scanning) void saveCheckpoint(true);
    }
  };
  function showCache(cache) {
    cacheInfo.textContent = `${cache.servers.ids.length} cached servers · ${Object.values(cache.channels).reduce((sum, entry) => sum + entry.routes.length, 0)} channels. Lists expire after 24 hours. Last server refresh ${cache.servers.updatedAt ? new Date(cache.servers.updatedAt).toLocaleString('en-GB') : 'never'}.`;
  }
  async function refreshCacheInfo(type = 'auditCacheRead') {
    const author = configuredAuthor();
    if (!author) {
      cacheInfo.textContent = 'Set your user ID to use the cache.';
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({ type, author });
      if (result.error) throw Error(result.error);
      if (author === configuredAuthor()) showCache(result.cache);
    } catch (error) {
      if (author === configuredAuthor()) cacheInfo.textContent = error.message;
    }
  }
  clearCache.onclick = () => {
    if (!start.disabled) void refreshCacheInfo('auditCacheClear');
  };
  const digest = async (bytes) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  function showReferences() {
    const counts = [];
    if (defaultHashes.length) counts.push(`${defaultHashes.length} default images`);
    if (referenceHashes.size) counts.push(`${referenceHashes.size} added`);
    imageName.textContent = counts.join(' · ') || 'No images selected';
    clearExtras.hidden = !referenceHashes.size;
  }
  clearExtras.onclick = () => {
    if (start.disabled || readingReferences) return;
    referenceHashes.clear();
    showReferences();
    saveSettings();
    status.textContent = 'Added reference images cleared.';
  };
  file.onchange = async () => {
    const selected = Array.from(file.files || []);
    if (!selected.length || start.disabled || readingReferences) return;
    readingReferences = true;
    chooseImage.disabled = true;
    clearExtras.disabled = true;
    let skipped = 0;
    try {
      status.textContent = 'Reading added images…';
      for (const image of selected) {
        if (image.size > 20 * 1024 * 1024) {
          skipped++;
          continue;
        }
        try {
          const hash = await digest(await image.arrayBuffer());
          if (!defaultHashes.includes(hash)) referenceHashes.add(hash);
        } catch {
          skipped++;
        }
      }
      showReferences();
      saveSettings();
      status.textContent = skipped
        ? `${skipped} images could not be read or exceed 20 MB.`
        : 'Reference images ready. Select Start scan.';
    } finally {
      file.value = '';
      readingReferences = false;
      chooseImage.disabled = false;
      updateSavedScan();
    }
  };
  stop.onclick = () => {
    running = false;
    setOperationControls(false);
    status.textContent = 'Stopping after the current request…';
    if (scanning) void saveCheckpoint(true);
  };
  close.onclick = () => {
    if (
      !confirm(
        running
          ? 'Stop the current operation and close Discord Hack Cleaner?'
          : 'Close Discord Hack Cleaner?',
      )
    )
      return;
    saveSettings();
    running = false;
    setOperationControls(false);
    if (scanning) void saveCheckpoint(true);
    oauthToken.value = '';
    botToken.value = '';
    host.remove();
    delete globalThis.DiscordAuditPanel;
  };
  save.onclick = () => downloadJSON(report, 'discord-cleanup-report.json');
  const routes = () =>
    [
      ...new Set(
        [...document.querySelectorAll('a[href]')]
          .filter((a) => !a.closest('[id^="chat-messages-"]'))
          .map((a) => core.route(a.getAttribute('href')))
          .filter(Boolean),
      ),
    ].sort();
  function channelType(route) {
    if (route.startsWith('/channels/@me/')) return 'text';
    const main = core.pageRoute(location.pathname) === route
      ? document.querySelector('main, [role="main"]') : null;
    const anchor = [
      ...document.querySelectorAll('nav a[href], [role="navigation"] a[href], #channels a[href]'),
    ].find((a) => core.route(a.getAttribute('href')) === route);
    // Inspect channel navigation/header only: message bodies cannot supply channel evidence.
    return core.channelType([
      anchor?.getAttribute('aria-label') || '',
      ...Array.from(
        anchor?.querySelectorAll('[aria-label],title') || [],
        (n) => n.getAttribute('aria-label') || n.textContent,
      ),
      ...Array.from(
        main?.querySelectorAll('header [aria-label], [role="banner"] [aria-label]') || [],
        (n) => n.getAttribute('aria-label') || '',
      ),
    ]);
  }
  function rows(route, nodes = document.querySelectorAll('[id^="chat-messages-"]')) {
    const channelId = route?.split('/')[3];
    const seen = new Map();
    for (const node of nodes) {
      const ids = node.id.match(/^chat-messages-(\d+)-(\d+)$/);
      if (!ids || (channelId && ids[1] !== channelId)) continue;
      const id = ids[2];
      // Only an explicit avatar within this message is evidence of author ID.
      const authors = [...node.querySelectorAll('img[src][class*="avatar"]')]
        .filter((img) => !img.closest('[id^="message-content-"], [class*="embed"], [class*="attachment"]'))
        .map((img) => {
          try {
            const u = new URL(img.src);
            return /^(cdn\.discordapp\.com|media\.discordapp\.net)$/.test(u.hostname)
              ? u.pathname.match(/^\/avatars\/(\d+)\//)?.[1]
              : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const author = authors.length && new Set(authors).size === 1 ? authors[0] : '';
      const attachments = [
        ...new Set(
          [...node.querySelectorAll('a[href], img[src]')]
            .map((item) => core.originalAttachment(item.href || item.src))
            .filter(Boolean),
        ),
      ];
      const content = document.getElementById(`message-content-${id}`);
      const text = content?.textContent || '';
      const everyone = /(?:^|\s)@everyone\b/i.test(text);
      const links = Array.from(content?.querySelectorAll?.('a[href]') || [], (anchor) => anchor.href);
      seen.set(id, { id, author, channel: ids[1], attachments, everyone, text, links });
    }
    return [...seen.values()];
  }
  async function waitForOlderRows(route, scroller, oldest, active) {
    const read = () => {
      if (!active()) return null;
      const current = rows(route);
      return current.some((row) => BigInt(row.id) < BigInt(oldest)) ? current : null;
    };
    const initial = read();
    if (initial) return initial;
    if (typeof MutationObserver !== 'function') {
      for (let attempt = 0; attempt < 12 && active(); attempt++) {
        await pause(125);
        const current = read();
        if (current) return current;
      }
      return null;
    }
    const older = await new Promise((resolve) => {
      const finish = (current) => {
        clearTimeout(timer);
        observer.disconnect();
        resolve(current);
      };
      const observer = new MutationObserver(() => {
        const current = read();
        if (current || !active()) finish(current);
      });
      const timer = setTimeout(() => finish(null), 1500);
      observer.observe(scroller, { childList: true, subtree: true });
    });
    await waitUntilResumed();
    return older;
  }
  remove.onclick = async () => {
    if (remove.disabled) return;
    reviewQueue = selectedMatches();
    if (!reviewQueue.length) return;
    activateMatch(reviewQueue[0]);
    if (await openMessageHere(reviewQueue[0]))
      status.textContent = 'Review the selected messages with the arrows. Use Discord’s menu to remove a message.';
  };

  async function refreshBotStatus() {
    const author = configuredAuthor();
    botReady = false;
    if (author) {
      const result = await chrome.runtime.sendMessage({ type: 'botStatus', author }).catch(() => null);
      if (author !== configuredAuthor()) return;
      botReady = result?.saved === true;
    }
    botStatus.textContent = botReady
      ? 'Bot connected. Server scans use it automatically when access is verified.'
      : 'Connect a bot installed in your server to enable API scanning and deletion.';
    syncReview();
  }

  async function configureBot(type) {
    if (saveBot.disabled || start.disabled) return;
    const author = configuredAuthor();
    loadingOwned = true;
    updateSavedScan();
    try {
      const result = await chrome.runtime.sendMessage({ type, author, token: type === 'saveBot' ? botToken.value.trim() : '' });
      if (!result?.ok) throw Error(result?.error || 'Could not update bot settings.');
      await refreshBotStatus();
    } catch (error) {
      botStatus.textContent = error.message;
    } finally {
      botToken.value = '';
      loadingOwned = false;
      updateSavedScan();
    }
  }
  saveBot.onclick = () => configureBot('saveBot');
  forgetBot.onclick = () => configureBot('forgetBot');

  botRemove.onclick = async () => {
    if (botRemove.disabled || botRemove.hidden || running) return;
    const window = { start: report.start, endExclusive: report.endExclusive };
    const server = report.currentServer;
    const author = configuredAuthor();
    const references = report.referenceHashes;
    const plan = core.resultPlan(selectedMatches(), references, window, author, report.moderation)
      .filter((match) => core.inScope(match.route, 'current', server));
    if (!plan.length) return;
    running = start.disabled = true;
    setOperationControls(true);
    updateSavedScan();
    const send = async (type, fields = {}) => {
      const result = await chrome.runtime.sendMessage({ type, author, server, ...fields });
      if (!result || result.error) throw Error(result?.error || 'Discord bot did not respond.');
      return result;
    };
    try {
      status.textContent = 'Verifying permission to delete in this server…';
      await send('authorizeBot');
      if (!running || !confirm(`Permanently delete ${plan.length} selected exact matches from server ${server}?`)) {
        status.textContent = 'Bot cleanup canceled.';
        return;
      }
      if (!checkpoint && savedState?.report === report) checkpoint = { ...savedState, report };
      const groups = new Map();
      for (const match of plan) {
        const channel = match.route.split('/')[3];
        if (!groups.has(channel)) groups.set(channel, []);
        groups.get(channel).push(match);
      }
      const outcomes = new Map((report.deletions || []).map((entry) => [entry.id, entry]));
      for (const [channel, matches] of groups) {
        for (let offset = 0; offset < matches.length && running; offset += 10) {
          await waitUntilResumed();
          if (!running) break;
          status.textContent = `Verifying selected messages in channel ${channel}…`;
          const batch = matches.slice(offset, offset + 10);
          try {
            const result = await send('botDelete', { channel, matches: batch, ...window, references, moderation: report.moderation });
            for (const outcome of result.results) outcomes.set(outcome.id, { ...outcome, verifiedAt: new Date().toISOString() });
          } catch (error) {
            for (const match of batch) outcomes.set(match.id, { id: match.id, status: 'unverified', reason: error.message });
          }
          report.deletions = [...outcomes.values()];
          await saveCheckpoint(true);
          syncReview();
        }
      }
      status.textContent = running ? 'Bot cleanup finished. Check the report for each outcome.' : 'Bot cleanup stopped.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      running = start.disabled = false;
      setOperationControls(false);
      updateSavedScan();
    }
  };
  function useMessageTime(control, isEnd) {
    const parts = location.pathname.match(/^\/channels\/(?:@me|\d+)\/\d+\/(\d{17,20})\/?$/);
    if (!parts) {
      status.textContent = 'Open a Discord message link first.';
      return;
    }
    const timestamp = core.timestamp(parts[1]);
    const minute = Math.floor(timestamp / 60000) * 60000 + (isEnd ? 60000 : 0);
    control.value = core.localInput(minute);
    void saveSettings();
  }
  startHere.onclick = () => useMessageTime(from, false);
  endHere.onclick = () => useMessageTime(to, true);
  function prepareSearch() {
    searchQuery.value = '';
    try {
      const window = core.windowFromLocal(from.value, to.value);
      const author = configuredAuthor();
      const allAuthors = mode === 'owner' || (scope.value === 'current' && moderationFlag.checked);
      if (!allAuthors && !author) throw Error('Save your Discord user ID first.');
      const first = new Date(window.start);
      const last = new Date(window.endExclusive);
      first.setDate(first.getDate() - 1);
      last.setDate(last.getDate() + 1);
      searchQuery.value = [
        allAuthors ? '' : `from: <@${author}>`,
        `after: ${core.localInput(first).slice(0, 10)}`,
        `before: ${core.localInput(last).slice(0, 10)}`,
        suspiciousFlag.checked ? '' : 'has: file',
      ].filter(Boolean).join(' ');
    } catch (error) {
      status.textContent = error.message;
    }
  }
  copyQuery.onclick = async () => {
    queryField.hidden = true;
    prepareSearch();
    if (!searchQuery.value) return;
    try {
      await navigator.clipboard.writeText(searchQuery.value);
      status.textContent = 'Search copied. Paste it into Discord, then select Check visible results.';
    } catch {
      queryField.hidden = false;
      searchQuery.focus?.();
      searchQuery.select?.();
      status.textContent = 'Copy the selected query and paste it in Discord search.';
    }
  };
  scanSearch.onclick = () => runScan(null, { kind: 'search' });
  scanConversation.onclick = () => {
    const route = core.pageRoute(location.pathname);
    if (route) return runScan(null, { route });
    status.textContent = 'Open a server channel or DM first.';
  };
  importPackage.onclick = () => packageFile.click();
  packageFile.onchange = async () => {
    const source = packageFile.files?.[0];
    packageFile.value = '';
    if (source) await runScan(null, { kind: 'archive', file: source });
  };

  async function runScan(resuming = null, input = null) {
    if (start.disabled) return;
    if (loadingOwned) {
      status.textContent = 'Wait for Discord to verify your owned servers.';
      return;
    }
    if (readingReferences) {
      status.textContent = 'Wait for the added images to finish loading.';
      return;
    }
    if (!settingsReady) return;
    const restored = resuming ? stateModel.clean(resuming) : null;
    const author = configuredAuthor() || restored?.report.author;
    if (!author) {
      setSettingsOpen(true);
      status.textContent = 'Save your Discord user ID in Settings before scanning.';
      return;
    }
    const availableHashes = [...new Set([...defaultHashes, ...referenceHashes])];
    const owner = mode === 'owner' && input?.kind !== 'archive' && !input?.route?.startsWith('/channels/@me/');
    if (restored && restored.report.author !== author) {
      status.textContent = 'The saved scan belongs to a different Discord user ID.';
      return;
    }
    const onlyRoute = restored?.report.onlyRoute || input?.route;
    const tabScope = location.pathname.startsWith('/channels/@me') ? 'dm' : 'current';
    const selectedScope = owner ? 'current' : restored?.report.scope ||
      (input?.kind === 'search' || onlyRoute ? tabScope : scope.value);
    const currentServer = owner && !onlyRoute
      ? restored?.report.currentServer || ownedServer.value
      : restored?.report.currentServer || location.pathname.split('/')[2];
    if (owner && !restored && !ownedServers.some((server) => server.id === currentServer)) {
      status.textContent = 'Load your owned servers and choose one to scan.';
      return;
    }
    if (owner && restored && (restored.report.scope !== 'current' || !restored.report.moderation)) {
      status.textContent = 'Choose the owned server from the saved all-authors scan, or start a new scan.';
      return;
    }
    if (selectedScope === 'current' && !/^\d+$/.test(currentServer || '')) {
      status.textContent = 'Open a server before choosing Current server.';
      return;
    }
    let scanWindow;
    const moderation =
      owner ||
      (restored ? restored.report.moderation : input?.kind !== 'archive' && selectedScope === 'current' && moderationFlag.checked);
    const referenceAtStart = restored?.report.referenceHashes || availableHashes;
    const detectSuspicious = restored ? restored.report.detectSuspicious : suspiciousFlag.checked === true;
    const scamDomains = restored ? restored.report.scamDomains : core.scamDomains(scamDomainsInput.value);
    if (!referenceAtStart.length && !detectSuspicious) {
      status.textContent = 'Add a reference image or turn on Flag suspicious messages.';
      return;
    }
    try {
      scanWindow = restored
        ? { start: restored.report.start, endExclusive: restored.report.endExclusive }
        : core.windowFromLocal(from.value, to.value);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    if (!configuredAuthor()) {
      savedAuthor = author;
      account.value = author;
    }
    let kind = input?.kind || restored?.report.source || 'dom';
    let botFallback = '';
    if (restored && ['archive', 'search'].includes(kind)) {
      status.textContent = 'Run the import or search again to check more messages.';
      return;
    }
    let searchRows;
    let archiveEntries;
    if (kind === 'search') {
      const guild = location.pathname.split('/')[2];
      if (selectedScope === 'current' && guild !== currentServer) {
        status.textContent = 'Open the selected server in Discord before scanning its search results.';
        return;
      }
      searchRows = rows(null, document.querySelectorAll('[class*="searchResult"] [id^="chat-messages-"]'));
      if (!searchRows.length) {
        status.textContent = 'Open a results page in Discord search before scanning.';
        return;
      }
    }
    if (kind === 'archive') {
      start.disabled = true;
      updateSavedScan();
      try {
        status.textContent = 'Opening the local Discord data package…';
        const iterator = globalThis.readDiscordDataPackage(input.file);
        const first = await iterator.next();
        archiveEntries = (async function* () {
          if (!first.done) yield first.value;
          yield* iterator;
        })();
      } catch (error) {
        status.textContent = error.message;
        return;
      } finally {
        start.disabled = false;
        updateSavedScan();
      }
      if (host.isConnected === false) return;
    }
    if (restored) {
      from.value = core.localInput(scanWindow.start);
      to.value = core.localInput(scanWindow.endExclusive);
      scope.value = selectedScope;
      moderationFlag.checked = moderation;
      suspiciousFlag.checked = detectSuspicious;
      scamDomainsInput.value = scamDomains.join(', ');
      suspiciousFlag.onchange();
      updateModeration();
    }
    saveSettings();
    if (moderation) {
      start.disabled =
        chooseImage.disabled =
        scope.disabled =
        from.disabled =
        to.disabled =
        remove.disabled =
          true;
      updateSavedScan();
      try {
        status.textContent = owner
          ? 'Verifying ownership of the selected server…'
          : 'Verifying moderation permissions for the current server…';
        const result = await chrome.runtime.sendMessage({
          type: owner ? 'listOwnedServers' : 'verifyModeration',
          author,
          server: currentServer,
        });
        if (result?.error) throw Error(result.error);
        if (owner) {
          if (!result?.servers?.some((server) => server.id === currentServer))
            throw Error('This account no longer owns the selected server.');
          savedOwnedServer = currentServer;
          setOwnedServers(result.servers);
          saveSettings();
        } else if (!result?.allowed) throw Error('Moderation permissions could not be verified.');
      } catch (error) {
        if (owner) setOwnedServers([]);
        status.textContent = error.message;
        return;
      } finally {
        start.disabled = chooseImage.disabled = scope.disabled = from.disabled = to.disabled = false;
        updateSavedScan();
      }
      if (host.isConnected === false) return;
    }
    if (!input?.kind && selectedScope === 'current' && (!restored || kind === 'bot')) {
      start.disabled = true;
      updateSavedScan();
      try {
        const saved = await chrome.runtime.sendMessage({ type: 'botStatus', author });
        if (saved?.saved || kind === 'bot') {
          const access = await chrome.runtime.sendMessage({
            type: 'authorizeBot', author, server: currentServer, onlyChannel: onlyRoute?.split('/')[3],
          });
          if (!access?.allowed) throw Error(access?.error || 'Discord bot access could not be verified.');
          kind = 'bot';
        }
      } catch (error) {
        if (kind === 'bot') {
          status.textContent = error.message;
          return;
        }
        botFallback = error.message;
      } finally {
        start.disabled = false;
        updateSavedScan();
      }
      if (host.isConnected === false) return;
    }
    from.disabled = to.disabled = true;
    running = scanning = true;
    setOperationControls(true);
    chooseImage.disabled = true;
    file.disabled = true;
    scope.disabled = true;
    start.disabled = true;
    remove.disabled = true;
    refreshCache.disabled = true;
    clearCache.disabled = true;
    const sameSearch = kind === 'search' && report.source === 'search' && report.author === author &&
      report.currentServer === (selectedScope === 'current' ? currentServer : null) &&
      report.scope === selectedScope && report.start === scanWindow.start && report.endExclusive === scanWindow.endExclusive &&
      report.moderation === moderation && report.detectSuspicious === detectSuspicious &&
      report.referenceHashes.join(',') === referenceAtStart.join(',') && report.scamDomains.join(',') === scamDomains.join(',');
    report = restored?.report || (sameSearch ? report : {
      author,
      ...scanWindow,
      scope: selectedScope,
      currentServer: selectedScope === 'current' ? currentServer : null,
      moderation,
      source: kind,
      scanStartedAt: new Date().toISOString(),
      ...(onlyRoute ? { onlyRoute } : {}),
      channels: [],
      matches: [],
      unverified: [],
      complete: false,
      referenceHashes: referenceAtStart,
      detectSuspicious,
      scamDomains,
      suspicious: [],
    });
    report.scanStartedAt ||= new Date().toISOString();
    matchCursor = -1;
    reviewQueue = null;
    if (!sameSearch) excludedMatches.clear();
    matchChecks.clear();
    if (botFallback) report.unverified.push({ reason: 'Bot unavailable. Using Discord Web: ' + botFallback });
    const pending = new Set(restored?.pending);
    if (kind === 'dom') {
      for (const channel of report.channels)
        if (/^(?:Stopped|Unverified|Incomplete)/.test(channel.status)) pending.add(channel.route);
    }
    if (kind === 'dom') report.channels = report.channels.filter((channel) => !pending.has(channel.route));
    scannedInWindow = report.channels.reduce((total, channel) => total + (channel.messagesInWindow || 0), 0);
    checkpoint = {
      version: 1, finished: false, report, pending: [...pending],
      cursors: { ...restored?.cursors },
      cursorCounts: { ...restored?.cursorCounts },
      botCursor: restored?.botCursor,
      botSearchDone: restored?.botSearchDone,
      recentChecked: [...(restored?.recentChecked || [])],
    };
    showCheckpoint.hidden = true;
    updateSavedScan();
    resultsRange.textContent = formatWindow(scanWindow);
    resultsRange.hidden = false;
    list.replaceChildren();
    matchGroups.clear();
    for (const match of report.matches) renderMatch(match);
    resetSuspiciousList();
    const exactIds = new Set(report.matches.map((match) => match.id));
    const suspiciousIds = new Set(report.suspicious.map((match) => match.id));
    const visited = new Set(report.channels.map((channel) => channel.route));
    const checked = new Set();
    if (kind === 'bot' && restored?.botCursor) {
      for (const channel of report.channels)
        if (channel.status.startsWith('Incomplete')) channel.status = 'Candidates checked';
    }
    const hashes = new Map();
    async function hashFor(url) {
      if (!hashes.has(url)) {
        hashes.set(url, (async () => {
          let result;
          for (let attempt = 0; attempt < 2; attempt++) {
            await waitUntilResumed();
            if (!running) return {};
            try {
              result = await chrome.runtime.sendMessage({ type: 'attachmentHash', url });
            } catch (error) {
              result = { error: error.message };
            }
            if (result?.hash || /HTTP 4|exceeds|not allowed/i.test(result?.error || '')) break;
          }
          return result;
        })());
      }
      const result = await hashes.get(url);
      if (!result?.hash) hashes.delete(url);
      return result;
    }

    async function processRows(messages, route, active, source) {
      let index = 0;
      let count = 0;
      let retry = false;
      async function checkRows() {
        while (active() && index < messages.length) {
          await waitUntilResumed();
          if (!active() || index >= messages.length) return;
          const message = messages[index++];
          if (!core.inWindow(message.id, scanWindow) || checked.has(message.id)) continue;
          checked.add(message.id);
          count++;
          scannedInWindow++;
          if (!moderation && message.author !== report.author) {
            if (!message.author) report.unverified.push({ route, id: message.id, reason: 'Could not read the author ID' });
            continue;
          }
          const url = `https://discord.com${route}/${message.id}`;
          const details = { id: message.id, author: message.author, url };
          let hashError;
          if (!exactIds.has(message.id)) {
            for (const attachment of referenceAtStart.length ? message.attachments : []) {
              if (!active()) return;
              const result = await hashFor(attachment);
              await waitUntilResumed();
              if (!active()) return;
              if (!result?.hash) {
                hashError = result?.error || 'Attachment hash unavailable';
                continue;
              }
              if (!core.referenceMatches(result.hash, referenceAtStart)) continue;
              exactIds.add(message.id);
              const match = {
                ...details, hash: result.hash, time: new Date(core.timestamp(message.id)).toISOString(),
                serverName: source?.serverName, channelName: source?.channelName, everyone: message.everyone,
              };
              report.matches.push(match);
              if (suspiciousIds.delete(match.id)) {
                report.suspicious = report.suspicious.filter((entry) => entry.id !== match.id);
                resetSuspiciousList();
              }
              renderMatch(match);
              break;
            }
          }
          if (exactIds.has(message.id)) continue;
          if (hashError) {
            report.unverified.push({ route, id: message.id, reason: hashError });
            retry = true;
          }
          if (referenceAtStart.length && !message.attachments.length && !detectSuspicious)
            report.unverified.push({ route, id: message.id, reason: 'No original attachment link was available' });
          if (detectSuspicious && !suspiciousIds.has(message.id)) {
            const reasons = core.suspiciousReasons(message, scamDomains);
            if (reasons.length) {
              const match = { ...details, reasons };
              suspiciousIds.add(message.id);
              report.suspicious.push(match);
              renderSuspicious(match);
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, messages.length) }, checkRows));
      progressScanned.textContent = `${scannedInWindow} scanned`;
      return { count, retry };
    }

    async function processCandidates(messages, getRoute) {
      const groups = new Map();
      for (const message of messages) {
        const route = getRoute(message);
        if (!core.inScope(route, selectedScope, currentServer)) continue;
        if (!groups.has(route)) groups.set(route, []);
        groups.get(route).push(message);
      }
      let retry = false;
      for (const [route, group] of groups) {
        await waitUntilResumed();
        if (!running) break;
        const result = await processRows(group, route, () => running, { channelName: group[0].channelName });
        retry ||= result.retry;
        let channel = report.channels.find((item) => item.route === route);
        if (!channel) {
          channel = { route, status: 'Candidates checked', messagesInWindow: 0 };
          report.channels.push(channel);
        }
        channel.messagesInWindow += result.count;
        if (result.retry) channel.status = 'Incomplete · Attachment verification failed';
      }
      return retry;
    }

    async function scanCandidates() {
      let retry = false;
      if (kind === 'bot') {
        const send = async (type, fields = {}) => {
          const response = await chrome.runtime.sendMessage({
            type, author, server: currentServer, ...scanWindow, moderation, detectSuspicious,
            ...(onlyRoute ? { onlyChannel: onlyRoute.split('/')[3] } : {}), ...fields,
          });
          if (!response || response.error) throw Error(response?.error || 'Discord bot did not respond.');
          return response;
        };
        let before = checkpoint.botCursor;
        while (!checkpoint.botSearchDone) {
          await waitUntilResumed();
          if (!running) return;
          status.textContent = 'Searching the server with the Discord bot…';
          const page = await send('botSearch', { before });
          retry = await processCandidates(page.rows, (row) => `/channels/${currentServer}/${row.channel}`);
          if (!running || retry) break;
          before = page.next;
          if (before) checkpoint.botCursor = before;
          else checkpoint.botSearchDone = true;
          await saveCheckpoint();
        }
        const recentNeeded = Date.parse(scanWindow.endExclusive) >= Date.parse(report.scanStartedAt || checkpoint.savedAt) - 15 * 60000;
        if (running && !retry && recentNeeded) {
          status.textContent = 'Checking recent messages that may not be indexed…';
          const channels = onlyRoute ? [onlyRoute.split('/')[3]] : (await send('botRecentChannels')).channels;
          const done = new Set(checkpoint.recentChecked);
          for (const channel of channels) {
            if (done.has(channel)) continue;
            await waitUntilResumed();
            if (!running) return;
            try {
              const page = await send('botRecent', { channel });
              const pendingHashes = await processCandidates(page.rows, () => `/channels/${currentServer}/${channel}`);
              retry = retry || pendingHashes;
              if (running && !pendingHashes) {
                done.add(channel);
                checkpoint.recentChecked = [...done];
                await saveCheckpoint();
              }
            } catch (error) {
              if (!/HTTP (403|404)\b/.test(error.message)) retry = true;
              else {
                done.add(channel);
                checkpoint.recentChecked = [...done];
              }
              report.unverified.push({ route: `/channels/${currentServer}/${channel}`, reason: error.message });
            }
          }
        }
      } else if (kind === 'archive') {
        status.textContent = 'Reading the local Discord data package…';
        for await (const entry of archiveEntries) {
          await waitUntilResumed();
          if (!running) return;
          if (entry.error) {
            report.unverified.push({ reason: entry.error });
            continue;
          }
          if (!core.inScope(entry.route, selectedScope, currentServer)) continue;
          const candidates = entry.messages.flatMap((item) => {
            const id = core.accountId(String(item?.ID ?? item?.id ?? ''));
            if (!id || !core.inWindow(id, scanWindow)) return [];
            const raw = item.Attachments ?? item.attachments ?? '';
            const values = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
            return [{ id, author, text: String(item.Contents ?? item.content ?? ''), links: [],
              attachments: values.map((value) => core.originalAttachment(value?.url ?? value)).filter(Boolean),
              channelName: entry.channelName }];
          });
          await processCandidates(candidates, () => entry.route);
          await saveCheckpoint();
        }
      } else {
        const guild = selectedScope === 'current' ? currentServer : '@me';
        await processCandidates(searchRows, (row) => `/channels/${guild}/${row.channel}`);
      }
      checkpoint.finished = running && (!retry || kind !== 'bot');
      report.complete = false;
      status.textContent = !running ? 'Scan stopped.' : retry && kind === 'bot' ? 'Attachment verification is incomplete. Resume the saved scan.' :
        `${kind === 'bot' ? 'Bot' : kind === 'archive' ? 'Data package' : 'Visible search results'} scan finished · ${scannedInWindow} candidates checked.`;
    }
    try {
      await saveCheckpoint(true);
      if (kind !== 'dom') {
        try {
          await scanCandidates();
          return;
        } catch (error) {
          if (kind !== 'bot' || restored || report.channels.length || !/HTTP (400|401|403|404)\b/.test(error.message)) throw error;
          kind = report.source = 'dom';
          report.unverified.push({ reason: 'Bot search unavailable. Used Discord Web: ' + error.message });
        }
      }
      const progress = (text) => {
        status.textContent = text;
      };
      const rawDriver = globalThis.createAuditDOMDriver(() => running, progress, pause, waitUntilResumed);
      let driver = rawDriver;
      try {
        const cached = await chrome.runtime.sendMessage({ type: 'auditCacheRead', author });
        if (!cached?.cache) throw Error(cached?.error || 'The local cache is unavailable');
        driver = globalThis.DiscordAuditCache.wrap(
          rawDriver,
          cached.cache,
          async (cache) => {
            try {
              const saved = await chrome.runtime.sendMessage({ type: 'auditCacheWrite', author, cache });
              if (!saved?.cache) throw Error(saved?.error || 'Could not save the scan cache');
              showCache(saved.cache);
            } catch (error) {
              cacheInfo.textContent = error.message;
            }
          },
          () => running,
          refreshCache.checked,
          progress,
        );
      } catch (error) {
        cacheInfo.textContent = error.message;
      }
      await waitUntilResumed();
      const navigation = globalThis.createAuditNavigation(driver, () => running, progress);
      async function* batches() {
        if (pending.size) yield { label: 'Saved channels', routes: [...pending], issues: [] };
        await waitUntilResumed();
        if (!running) return;
        if (
          !onlyRoute &&
          selectedScope === 'current' &&
          !driver.cachedChannels?.(currentServer) &&
          location.pathname.split('/')[2] !== currentServer
        ) {
          if (!(await driver.selectServer(currentServer))) throw Error('Could not open the selected server.');
        }
        if (onlyRoute) yield { routes: [onlyRoute], issues: [], label: 'Current conversation' };
        else yield* navigation.batches(selectedScope, currentServer);
      }
      for await (const batch of batches()) {
        report.unverified.push(...batch.issues);
        const queue = batch.routes.filter((route) => core.inScope(route, selectedScope, currentServer));
        const queued = new Set(queue);
        let expandedQueue = false;
        for (const route of queue) if (!visited.has(route)) pending.add(route);
        checkpoint.pending = [...pending];
        void saveCheckpoint();
        for (let q = 0; q < queue.length && running; q++) {
          await waitUntilResumed();
          if (!running) break;
          const route = queue[q];
          if (visited.has(route)) continue;
          visited.add(route);
          try {
            const prefix = `${batch.label} · Channel ${q + 1}/${queue.length}`;
            status.textContent = `${prefix} · Opening…`;
            const initialType = channelType(route);
            const opened = initialType !== 'other' && (
              core.pageRoute(location.pathname) === route || await driver.open(route, { textOnly: true })
            );
            const type = initialType || channelType(route);
            if (type === 'other') {
              report.channels.push({ route, status: 'Skipped · Channel is not a text channel' });
              continue;
            }
            if (!opened) {
              if (running) report.channels.push({ route, status: 'Unverified · Could not open channel' });
              continue;
            }
            await waitUntilResumed();
            if (!running) break;
            if (core.pageRoute(location.pathname) !== route) {
              report.channels.push({ route, status: 'Unverified · Channel navigation failed' });
              continue;
            }
            if (!expandedQueue && !onlyRoute) {
              expandedQueue = true;
              for (const discovered of routes()) {
                if (
                  discovered.split('/')[2] !== route.split('/')[2] ||
                  !core.inScope(discovered, selectedScope, currentServer) ||
                  queued.has(discovered)
                )
                  continue;
                queued.add(discovered);
                queue.push(discovered);
                pending.add(discovered);
                checkpoint.pending = [...pending];
              }
            }
            let reason = 'Incomplete · Reached the history scroll limit';
            let stalledScrolls = 0;
            let checkedHere = 0;
            const source = driver.describe?.(route);
            const activeRoute = () => running && core.pageRoute(location.pathname) === route;
            const cursor = checkpoint.cursors[route];
            let resumedFrom;
            if (cursor) {
              const target = `${route}/${cursor}`;
              try {
                await jumpToRow(target, route, cursor);
                resumedFrom = BigInt(cursor);
                checkedHere = checkpoint.cursorCounts[route] || 0;
                scannedInWindow += checkedHere;
              } catch {
                if (running && core.pageRoute(location.pathname) !== route)
                  throw Error('The channel changed while restoring its scan position.');
              }
            }
            let messages = rows(route);
            for (let attempt = 0; attempt < 12 && activeRoute() && !messages.length; attempt++) {
              await pause(150);
              messages = rows(route);
            }
            for (let step = 0; step < 80 && running; step++) {
              if (!activeRoute()) {
                reason = 'Stopped · Channel changed';
                break;
              }
              status.textContent = `${prefix} · Scanning messages · ${checkedHere} in range`;
              const candidates = resumedFrom ? messages.filter((row) => BigInt(row.id) < resumedFrom) : messages;
              const checkedPage = await processRows(candidates, route, activeRoute, source);
              checkedHere += checkedPage.count;
              if (checkedPage.retry) {
                reason = 'Incomplete · Attachment verification failed';
                break;
              }
              if (!activeRoute()) {
                reason = 'Stopped · Channel changed or scan was stopped';
                break;
              }
              const oldestRow = messages.reduce((first, row) => !first || BigInt(row.id) < BigInt(first.id) ? row : first, null);
              const oldest = oldestRow ? core.timestamp(oldestRow.id) : Infinity;
              if (oldestRow && activeRoute() && (!resumedFrom || BigInt(oldestRow.id) < resumedFrom)) {
                checkpoint.cursors[route] = oldestRow.id;
                checkpoint.cursorCounts[route] = checkedHere;
                void saveCheckpoint();
              }
              if ((type === 'text' || messages.length) &&
                  document.querySelector('main [class*="channelWelcome"], main [class*="beginningChannel"]')) {
                reason = 'Reached the beginning of the channel';
                break;
              }
              if (oldest < Date.parse(report.start)) {
                reason = 'Reached the start of the incident window';
                break;
              }
              const first = messages.length
                ? document.getElementById(`chat-messages-${route.split('/')[3]}-${messages[0].id}`)
                : null;
              let scroller = first?.parentElement;
              while (
                scroller &&
                !(
                  scroller.scrollHeight > scroller.clientHeight + 20 &&
                  /auto|scroll/.test(getComputedStyle(scroller).overflowY)
                )
              )
                scroller = scroller.parentElement;
              if (!scroller) {
                reason = 'Unverified · Message history unavailable';
                break;
              }
              const previousTop = scroller.scrollTop;
              scroller.scrollTop = Math.max(0, previousTop - Math.max(200, scroller.clientHeight * 0.8));
              const older = oldestRow ? await waitForOlderRows(route, scroller, oldestRow.id, activeRoute) : null;
              const loadedOlder = !!older;
              messages = older || rows(route);
              stalledScrolls = loadedOlder || scroller.scrollTop !== previousTop ? 0 : stalledScrolls + 1;
              if (stalledScrolls >= 3) {
                reason = 'Incomplete · No older messages loaded';
                break;
              }
            }
            report.channels.push({
              route,
              status: running ? reason : 'Stopped',
              messagesInWindow: checkedHere,
            });
          } catch (error) {
            report.channels.push({ route, status: running ? 'Unverified · ' + error.message : 'Stopped' });
          } finally {
            const lastChannel = report.channels.at(-1);
            if (lastChannel?.route === route && !/^(?:Stopped|Unverified|Incomplete)/.test(lastChannel.status)) {
              pending.delete(route);
              delete checkpoint.cursors[route];
              delete checkpoint.cursorCounts[route];
            }
            checkpoint.pending = [...pending];
            void saveCheckpoint();
          }
        }
      }
      checkpoint.finished = running && pending.size === 0;
      report.complete = checkpoint.finished && !report.unverified.length &&
        !report.channels.some((channel) => channel.status.startsWith('Skipped'));
      const excluded = report.channels.filter((channel) => channel.status.startsWith('Skipped ·')).length;
      const messagesInWindow = report.channels.reduce(
        (count, channel) => count + (channel.messagesInWindow || 0),
        0,
      );
      status.textContent = `${!running ? 'Scan stopped' : pending.size ? 'Scan incomplete · resume pending channels' : 'Scan finished'} · ${report.channels.length} conversations checked · ${excluded} channels skipped · ${messagesInWindow} messages in range. Export the report for coverage details.`;
    } catch (e) {
      status.textContent = 'Scan interrupted. ' + e.message;
      report.unverified.push({ reason: e.message });
    } finally {
      if (['archive', 'search'].includes(kind)) checkpoint.finished = true;
      running = scanning = false;
      setOperationControls(false);
      await saveCheckpoint(true);
      from.disabled = to.disabled = false;
      chooseImage.disabled = false;
      file.disabled = false;
      scope.disabled = false;
      start.disabled = false;
      refreshCache.disabled = false;
      clearCache.disabled = false;
      updateSavedScan();
    }
  }
  start.onclick = () => runScan();
  resumeScan.onclick = () => {
    if (savedState && !savedState.finished) return runScan(savedState);
  };
})();
