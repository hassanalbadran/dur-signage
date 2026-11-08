#!/usr/bin/env bash
# Fails if something that looks like a secret or a private identifier is committed.
# Runs at the start of every build, so a mistake is caught before it can be released.
set -u
cd "$(dirname "$0")/.."

fail=0
scan() { # description, regex
  local hits
  hits=$(grep -rEn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=assets \
           --exclude='*.png' --exclude='*.apk' --exclude='*.enc' --exclude=check-secrets.sh \
           --exclude=SECURITY.md --exclude=INSTALL-AR.md --exclude=README.md \
           -e "$2" . 2>/dev/null | head -5)
  if [ -n "$hits" ]; then
    echo "ERROR: $1"
    echo "$hits"
    fail=1
  fi
}

scan "Google API key committed"          'AIza[0-9A-Za-z_-]{30,}'
scan "Apps Script web-app URL committed" 'script\.google\.com/macros/s/[A-Za-z0-9_-]{20,}'
scan "Google OAuth client id committed"  '[0-9]{9,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com'
scan "Private key committed"             'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
scan "Personal Gmail address committed"  '[A-Za-z0-9._+-]+@gmail\.com'

if [ "$fail" -ne 0 ]; then
  echo
  echo "Move these values into GitHub Secrets (see SECURITY.md) and remove them from the code."
  exit 1
fi
echo "secret scan: clean"
