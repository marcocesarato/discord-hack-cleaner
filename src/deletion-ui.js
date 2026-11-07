globalThis.DiscordDeleteUI = Object.freeze({
  text(node) {
    return (node?.getAttribute('aria-label') || node?.textContent || '').replace(/\s+/g, ' ').trim();
  },
  visible(node) {
    return !!node?.getClientRects().length;
  },
  canEdit(menu) {
    return [...(menu?.querySelectorAll('[role="menuitem"]') || [])].some(
      (node) =>
        this.visible(node) &&
        node.getAttribute('aria-disabled') !== 'true' &&
        (node.id === 'message-edit' || ['Edit Message', 'Modifica il messaggio'].includes(this.text(node))),
    );
  },
  menuItem(doc) {
    return (
      [
        ...doc.querySelectorAll('[role="menu"] [role="menuitem"], [role="menuitem"][id="message-delete"]'),
      ].find(
        (n) =>
          this.visible(n) &&
          n.getAttribute('aria-disabled') !== 'true' &&
          (n.id === 'message-delete' ||
            ['Elimina il messaggio', 'Elimina messaggio', 'Delete Message'].includes(this.text(n))),
      ) || null
    );
  },
  dialog(doc) {
    return (
      [...doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')].find((n) => {
        if (!this.visible(n)) return false;
        const labelled = n.getAttribute('aria-labelledby');
        const title = labelled
          ? labelled
              .split(/\s+/)
              .map((id) => doc.getElementById(id)?.textContent || '')
              .join(' ')
          : n.querySelector('h1,h2,h3,[class*="title"]')?.textContent;
        return ['Elimina il messaggio', 'Elimina messaggio', 'Delete Message', 'Delete message'].includes(
          (title || '').replace(/\s+/g, ' ').trim(),
        );
      }) || null
    );
  },
  confirmButton(dialog) {
    return (
      [...dialog.querySelectorAll('button, [role="button"]')].find(
        (n) =>
          this.visible(n) &&
          !n.disabled &&
          n.getAttribute('aria-disabled') !== 'true' &&
          ['Elimina', 'Elimina messaggio', 'Elimina il messaggio', 'Delete', 'Delete Message'].includes(
            this.text(n),
          ),
      ) || null
    );
  },
});
