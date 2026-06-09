# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](../../security/advisories/new) rather than a
public issue.

## Scope notes

- **Rendering model:** generated HTML renders in an iframe sandboxed without
  `allow-scripts`; script execution from model output should be impossible.
  A bypass of this sandbox boundary (or any path where model output reaches
  the host page's DOM) is the highest-severity bug this project can have —
  please report it.
- **API key:** stored in `chrome.storage.local`, sent only to
  `api.anthropic.com`. Any code path that exposes the key to page context or
  third parties is in scope.
- The hardening pass in `src/content.js` (`hardenDocument`) is
  defense-in-depth, not the primary barrier; gaps in it are still worth
  reporting but are lower severity than sandbox bypasses.
