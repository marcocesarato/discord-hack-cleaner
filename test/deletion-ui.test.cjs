const { test } = require('node:test');
const a = require('node:assert/strict');
const fs = require('node:fs'),
  vm = require('node:vm');
const ctx = {};
vm.createContext(ctx);
if (fs.existsSync(__dirname + '/../src/deletion-ui.js'))
  vm.runInContext(fs.readFileSync(__dirname + '/../src/deletion-ui.js', 'utf8'), ctx);
const visible = { getClientRects: () => [{}], getAttribute: () => null };
test('confirmation supports alertdialog and nested Elimina label', () => {
  a.equal(typeof ctx.DiscordDeleteUI, 'object');
  const button = { ...visible, textContent: '\n Elimina \n', disabled: false };
  const dialog = {
    ...visible,
    textContent: 'Elimina il messaggio Sei sicuro? Example User Annulla Elimina',
    querySelector: () => ({ textContent: 'Elimina il messaggio' }),
    querySelectorAll: () => [button],
  };
  const doc = {
    querySelectorAll: (selector) => (selector.includes('alertdialog') ? [dialog] : []),
    getElementById: () => null,
  };
  a.equal(ctx.DiscordDeleteUI.dialog(doc), dialog);
  a.equal(ctx.DiscordDeleteUI.confirmButton(dialog), button);
});

test('deletion requires the signed-in account to be able to edit the message', () => {
  const remove = { ...visible, id: 'message-delete' };
  const edit = { ...visible, id: 'message-edit' };
  a.equal(ctx.DiscordDeleteUI.canEdit({ querySelectorAll: () => [remove] }), false);
  a.equal(ctx.DiscordDeleteUI.canEdit({ querySelectorAll: () => [remove, edit] }), true);
});
test('unrelated modals and disabled confirmation buttons are rejected', () => {
  const dialog = {
    ...visible,
    textContent: 'Elimina account',
    querySelector: () => ({ textContent: 'Elimina account' }),
    querySelectorAll: () => [{ ...visible, textContent: 'Elimina', disabled: true }],
  };
  a.equal(ctx.DiscordDeleteUI.dialog({ querySelectorAll: () => [dialog], getElementById: () => null }), null);
  a.equal(ctx.DiscordDeleteUI.confirmButton(dialog), null);
});
test('menu action accepts stable Discord delete ID with shortcut text', () => {
  const item = { ...visible, id: 'message-delete', textContent: 'Elimina il messaggio Canc' };
  a.equal(ctx.DiscordDeleteUI.menuItem({ querySelectorAll: () => [item] }), item);
});
