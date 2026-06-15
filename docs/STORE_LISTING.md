# Chrome Web Store listing copy

Reference text to paste into the Developer Dashboard when submitting Retro Web.
Not shipped in the extension package.

---

## Single purpose

> Retro Web rebuilds the web page you are currently viewing as a 1990s/early-2000s
> style website using the Anthropic (Claude) API and your own API key.

## Short description (132 char max)

> Rebuild any web page as a glorious 90s website — table layouts, Comic Sans,
> marquees, hit counters. Powered by Claude.

## Detailed description

> Retro Web turns any modern web page into a glorious 1990s/early-2000s website:
> table layouts, Comic Sans, <marquee> tags, hit counters, guestbooks, and
> webrings — complete with a dial-up modem loading screen while the page
> "downloads at 28.8 kbps". Click a link inside a retro page and the next page
> gets retro-fied too, so you can surf the whole web like it's 1998.
>
> How it works: the extension extracts the readable text of the current page and
> asks Claude to rebuild it as a period-correct retro page, which streams into a
> sandboxed iframe and renders progressively.
>
> Bring your own Anthropic API key — there is no middleman server. The page
> content and your key are sent directly from your browser to the Anthropic API
> and nowhere else: no telemetry, no analytics, no third-party server. Generated
> pages are cached locally so revisits are instant.
>
> You'll need an Anthropic API key (platform.claude.com). Rough cost is a few
> cents to ~$0.15 per page depending on the model you pick.

## Category

Fun / Entertainment (or Developer Tools)

## Privacy practices tab

- **Does this item collect or use the user's data?** Yes.
- **Data types handled:** "Website content" (the text of pages the user chooses
  to retro-fy) and "Authentication information" (the user's own Anthropic API
  key, stored locally).
- **Sold to third parties:** No.
- **Used for purposes unrelated to core functionality:** No.
- **Used to determine creditworthiness / lending:** No.
- **Certifications to check:**
  - I do not sell or transfer user data to third parties outside of approved use
    cases. ✅
  - I do not use or transfer user data for purposes unrelated to my item's single
    purpose. ✅
  - I do not use or transfer user data to determine creditworthiness or for
    lending purposes. ✅
- **Privacy policy URL:** link to the hosted PRIVACY.md (e.g. the GitHub
  raw/blob URL, or a GitHub Pages URL).

## Permission justifications

Paste these into the corresponding fields when the dashboard asks you to justify
each permission.

### Host permission: `<all_urls>`

> Retro mode follows links: after the user clicks a link inside a retro-fied
> page, the extension re-injects itself into the destination page so that page
> is retro-fied too. Chrome's `activeTab` grant is revoked on navigation, so
> standing host access across sites is required for link-following to work. The
> extension only reads page content on pages the user has explicitly retro-fied.

### Host permission: `https://api.anthropic.com/*`

> The extension sends extracted page text to the Anthropic API to generate the
> retro version of the page, using the user's own API key.

### `webNavigation`

> Used only to time content-script injection in retro-mode tabs: paint the
> loading screen at navigation commit and start generation at DOMContentLoaded.
> Navigation events for tabs that are not in retro mode are ignored; nothing is
> collected, stored, or transmitted.

### `scripting`

> Used to inject the content script that extracts page content and renders the
> generated retro page into the current tab.

### `storage`

> Stores the user's Anthropic API key and a local cache of generated pages (per
> URL per model) so revisits are instant. Stored only on the user's device.

### `activeTab`

> Grants access to the current tab when the user clicks the extension, so the
> extension can read that page's content to retro-fy it.

### `offscreen`

> Used to run a background document required for processing the API response /
> rendering work outside the service worker.

## Screenshot requirements

- At least one screenshot, 1280x800 or 640x400 (PNG/JPG).
- `docs/screenshot.png` is good content but re-export it at an accepted size
  before uploading.
