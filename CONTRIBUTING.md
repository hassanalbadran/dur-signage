# Contributing

- Keep changes small and focused.
- Never commit keys, addresses or e-mails. Run `bash scripts/check-secrets.sh` before pushing.
- Avoid the character pair slash-star inside Kotlin comments (it opens a nested comment). Write `/app/FILE` instead of a wildcard path.
- UI text must exist in English and Arabic: use `L('English', 'العربية')`.
- Web UI check without Android: serve `web/` and open `admin/index.html` in a browser.
