# Security

## What is kept out of the repository

Nothing private is committed: no API keys, OAuth client IDs, backend address, e-mail addresses or signing passwords.
They are GitHub Actions secrets (apps) and Cloudflare environment variables (website), injected by `scripts/make-config.mjs` at build time.
Every build first runs `scripts/check-secrets.sh`, which fails if a key-like value or a personal address appears in the code.

The signing key is stored **encrypted** (`signing/signage.keystore.enc`, AES-256 with the secret `SIGNING_PASSPHRASE`). Use a long random passphrase (20+ characters) and never reuse it.

## What cannot be hidden

A value an app needs while running (for example the backend address) ships inside the APK and can be read by a determined person. Protection therefore does not rely on secrecy of those values:

- the backend only accepts requests carrying a valid Google token, verified server side (audience and e-mail), and only for e-mails listed in `ADMINS`;
- the Google API key is restricted to the Drive API in Google Cloud;
- every screen has its own random secret and its own random command channel.

## Reporting a problem

Open a private security advisory on the GitHub repository (Security tab > Report a vulnerability).
