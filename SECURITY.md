# Security Policy

## Supported Versions

Use of older versions of TokenFlow is unsupported. Only the latest version
(released under `vX.Y.Z` tags on GitHub) receives security fixes.

## Reporting Vulnerabilities

If you believe you have found a security vulnerability in TokenFlow, do not
disclose it publicly until a fix is available.

**Preferred reporting method:** Use GitHub's private vulnerability reporting
feature. If that is unavailable, open a minimal GitHub issue asking for a private
channel; do not invent an email address.

**What to include in a report:**
- TokenFlow version (from About/Settings or `VERSION` file)
- Install format (`.deb`, `.rpm`, AppImage, Flatpak, NSIS, DMG)
- OS and version
- Steps to reproduce the issue
- Expected vs actual behavior
- Impact of the vulnerability
- Whether any secrets or API keys are involved

**Response expectations:** Maintainers will acknowledge reports within a
reasonable window. They will not promise a specific SLA but will prioritize
fixes based on severity and feasibility.

**Do not disclose** vulnerabilities publicly before a fix is available.
Maintainers will coordinate disclosure once a fix is ready.

## Scope

This policy covers:
- Proxy binding and CORS configuration (loopback-only access)
- DeepSeek API key handling (OS credential store, environment variable precedence)
- SQLite data storage (WAL mode, deduplication, migration)
- Keychain migration (legacy SQLite to OS keychain with read-back verification)
- Release artifacts (bundle formats, signatures, checksums)

## Links

- Security model details: [[ARCHITECTURE.md#security-and-privacy-model]]