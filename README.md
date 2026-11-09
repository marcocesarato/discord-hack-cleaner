# Discord Hack Cleaner

**Did someone use your Discord account to send scam messages?** A stolen session token can let an attacker send scam links, fake giveaways, and images as you. Once you’ve secured your account, Discord Hack Cleaner helps you find those posts in server channels and DMs so you can review and remove them.

![Discord Hack Cleaner app icon](assets/icon-128.png)

## What it does

- **Searches a specific incident window.** Scan messages from your account in the current server, across your servers, in DMs, or in both servers and DMs. Owner and moderation modes can review messages from all authors in one server after a permission check.
- **Finds copies of known scam attachments.** The extension checks a small set of bundled image hashes and any reference images you add. One identical attachment is enough to mark a message as an exact match.
- **Flags messages worth checking.** Enable optional suspicious-message detection to catch patterns such as a mass mention with an image, a scam phrase with a link, or a link to a domain you specify.
- **Helps you work through the results.** Select exact matches in the side panel, jump directly to them for review, or use an authorized server bot to delete the selected batch.
- **Saves your progress.** Pause or stop a long scan, resume it later, or move a checkpoint between browser profiles using a JSON export.

## Scam image references

The extension loads five SHA-256 hashes from the bundled reference catalog. It compares the original bytes of Discord attachments against that catalog and the images you add through **Add images**. [Bundled reference catalog](src/reference-images.json)

Fake celebrity giveaways impersonating MrBeast or Elon Musk, casino promotions, and crypto giveaways are examples of campaigns you can investigate. Exact matches depend on the specific attachment file. Resizing or recompressing an image can change its hash. For a variant, add the original attachment as a reference or enable **Flag suspicious messages** to check the message against the scan rules.

<img src="docs/scam-example.png" alt="Reconstructed Discord message with an everyone mention and four attached screenshots of a fake MrBeast profile, casino bonus, withdrawal form, and claimed crypto payout" width="620">

*Redacted reconstruction of a Discord scam post. An `@everyone` mention with image attachments can trigger **Flag suspicious messages**. An exact match requires one of the original attachment files to match a reference hash.*

## Install in Chrome or Edge

1. Download the extension ZIP from the [latest GitHub release](https://github.com/marcocesarato/discord-hack-cleaner/releases/latest) and extract it.
2. Open the browser’s Extensions page and enable **Developer mode**.
3. Choose **Load unpacked** and select the folder that contains `manifest.json`.
4. Open Discord Web. Pin the extension if you want the launcher visible in the toolbar.

After a local update, reload the extension from the Extensions page and refresh Discord Web.

## Set up and run a scan

1. On first launch, open the recovery checklist. You can reopen it through **FAQ** in the popup or the scan panel’s **Settings**.
2. In **Settings**, leave **User ID** blank and save a Discord OAuth2 access token to fill the ID automatically. You can also paste an ID copied using Discord’s Developer Mode. [Discord’s illustrated guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)
3. Set the start and end in your browser’s local time. The scan includes the start and excludes the end. Use the bundled references or add the original attachment from your incident through **Add images**. Enable **Flag suspicious messages** to check for additional patterns.
4. Choose a mode.
   - **Scan my messages** checks the configured author. Choose the current server, all servers, DMs, or both.
   - **Scan as server owner** verifies ownership and lets you select one server to check across all authors. **Moderation mode** is also available under **Current server** to users with **Administrator** or **Manage Messages**. Both permission checks require the optional OAuth2 setup below.
   - **Review a saved report** opens the separate report viewer. Import a report to step through its Discord links for manual review.
5. Select **Start scan**, or open **Advanced tools → Scan this conversation** to use the open channel or DM as the scope. The footer shows progress and the exact match count. **Pause** suspends the scan between requests, and **Stop** saves its progress.

For a targeted check, open a message link and use its timestamp as the start or end of the incident window. In **Advanced tools**, select **Copy Discord search**. Paste it into Discord search, then use **Check visible results** to check the loaded rows against the precise time range and reference hashes. The result covers the visible search page. For messages near the current time, also check the live conversation for posts Discord has yet to index.

If you already have your [Discord data package](https://support.discord.com/hc/en-us/articles/360004957991-Your-Discord-Data-Package), choose **Advanced tools → Scan Discord data package** and select the ZIP. The extension reads the message JSON and channel metadata locally. It checks attachments whose CDN links still work and reports files it cannot read. Package results are available for manual review.

## Review and remove messages

| Result | What qualifies | How to act |
| --- | --- | --- |
| **Exact match** | At least one attachment has the same SHA-256 hash as a reference image. | Select the matches you want to review or delete in **Results**. |
| **Suspicious message** | A mass mention accompanies an image, a scam phrase accompanies a link, or a link points to a domain you listed. | Read the reason shown beside the result and open the message for manual review. |

Select **Results** to open the side panel inside Discord. **Open message** collapses the scanner to a toolbar with previous and next arrows for exact matches. An active or paused scan opens the message in a separate tab. After a scan stops, the message opens in the current Discord tab.

**Review selected matches** opens the first selected message and limits the arrows to that selection. Use Discord’s own menu for personal messages and DMs. In an eligible server, **Delete selected with bot** confirms the batch and rechecks each message’s server, channel, author, timestamp, and attachment hash before sending deletions to Discord.

## Save a scan or export a report

- **Scan checkpoint.** The latest checkpoint and its results reopen automatically. Resume an unfinished scan from **Saved scan**. Discord Web scans save a message position for incomplete channels. Bot searches save a pagination cursor. The checkpoint records deletion outcomes so confirmed deletions are excluded from the next selection.
- **Report.** Use **Export report** in the results panel to share or revisit the findings for manual review. **Import scan or report** accepts both file types. Importing a report keeps the checkpoint available under **Show saved scan**.

## What affects coverage

The extension scans the conversations and message history it can load through Discord Web. Server scans include readable text channels, including read-only channels. The exported report records skipped channels and unverified results. Recompressed or resized images can have different hashes, and suspicious flags require human judgment.

To add private references in an unpacked installation, create a `reference-images.local.json` file beside `manifest.json` containing a JSON array of lowercase SHA-256 hashes. Git ignores this file. The scanner combines these hashes with the bundled catalog and the images added in the panel.

## Optional OAuth2 setup

Personal scans and report review work without a token. Server owner and moderation modes use a short-lived **user OAuth2 access token** with `identify` and `guilds`. Use the same Discord account for authorization, the configured user ID, and the open Discord tab.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). In its OAuth2 settings, register a redirect URL controlled by your local OAuth client.
2. Use Discord’s [authorization code flow](https://docs.discord.com/developers/topics/oauth2#authorization-code-grant) with that application. Request the `identify guilds` scopes and use a fresh `state` value. Complete the consent screen and have your OAuth client verify the returned state.
3. Exchange the returned code from your OAuth client at Discord’s token endpoint using `grant_type=authorization_code`, the same redirect URL, and the application credentials. Keep the client secret in your OAuth client. Paste only the response’s `access_token` into **Settings → Discord OAuth2 access token**, then select **Save settings**.
4. Once the check succeeds, the extension saves the token in your local browser profile and reuses it for owner and moderator checks. To remove it, use **Settings → Forget saved OAuth2 token**. To revoke the application grant in Discord, remove it under **Authorized Apps**.

Use a scoped access token from the OAuth2 consent flow. Keep browser session credentials, bot tokens, client secrets and refresh tokens private. [Discord’s OAuth2 reference](https://docs.discord.com/developers/topics/oauth2)

## Optional server bot

1. Create a bot in the Discord Developer Portal, enable **Message Content Intent**, and install it in the server with **View Channel**, **Read Message History**, and **Manage Messages** where needed.
2. Save the user OAuth2 token above, then open **Settings → Server bot**, enter the bot token, and select **Connect bot**. The bot token lives only in extension session storage. Use **Disconnect bot** to clear it.
3. Start a current-server or current-channel scan. The extension uses the bot when the server is verified and otherwise uses Discord Web for a new scan. For owners and administrators, the bot can search channels and threads it can read. For other members, it searches regular channels where the account has the required effective moderation permissions. Discord also enforces the bot’s own permissions.
4. Select matches in **Results** and confirm **Delete selected with bot**. The extension groups eligible recent messages by channel for the official bulk endpoint and handles older messages individually. Archived threads are left for review. Inspect the report for messages that were missing, deleted, or could not be verified.

[Discord message API](https://docs.discord.com/developers/resources/message) · [Discord permissions](https://docs.discord.com/developers/topics/permissions)

## Privacy and platform rules

- The bundled catalog contains SHA-256 hashes. The extension stores your ID, dates, scope, chosen owned server, and reference hashes locally. It hashes reference images on the device and keeps their hashes.
- The channel cache and latest checkpoint are local. The `unlimitedStorage` permission allows larger checkpoints. Exported reports and checkpoints can contain user IDs, server and channel information, message links, and attachment hashes. Treat these exports as private.
- The extension fetches attachment bytes from Discord’s CDN. OAuth2 verifies identity and guild access. Server bot operations use Discord’s bot API. Credentials are excluded from reports and checkpoints.
- Review Discord’s [policy on automated user accounts](https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots) before using live scanning with a personal account.

## Development

There is no build step or runtime dependency. The browser loads `manifest.json` and the extension files in `src/`. Tests and synthetic fixtures are in `test/`.

Run the test suite with Node.js 22 or later.

```sh
npm test
```

GitHub Actions runs the same suite on pushes and pull requests.
