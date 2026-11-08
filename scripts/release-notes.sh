#!/usr/bin/env bash
# Prints the release page text (Markdown). Usage: release-notes.sh <tag>
# Everything after the <!--end--> marker is hidden inside the app's "What is new" view.
set -u
TAG="${1:-v1.0.0}"
REPO="${GITHUB_REPOSITORY:-}"
PREV=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -n "$PREV" ]; then RANGE="$PREV..HEAD"; else RANGE="HEAD"; fi
CHANGES=$(git log "$RANGE" --no-merges --pretty='- %s' 2>/dev/null | head -20)
[ -z "$CHANGES" ] && CHANGES="- First release"

ADMIN_SHA=$(sha256sum out/signage-admin.apk 2>/dev/null | cut -d' ' -f1)
SCREEN_SHA=$(sha256sum out/signage-screen.apk 2>/dev/null | cut -d' ' -f1)

cat <<MD
## What's new
$CHANGES

<!--end-->

<p align="center">
  <img src="https://raw.githubusercontent.com/$REPO/main/docs/assets/logo-full.png" width="220" alt="Dur Al-Razi">
</p>

### Download

| App | File | Install on |
| --- | --- | --- |
| **Admin app** | \`signage-admin.apk\` | The phone used to manage the screens |
| **Screen app** | \`signage-screen.apk\` | The waiting-room Android screen |

Updates are automatic: the admin app finds new releases by itself, and sends the screen app to the screens.

### Install in 3 steps
1. Download the APK on the device and open it. If Android asks, allow "install unknown apps" for your browser or Files app.
2. Admin app: open it, follow the short tour, then sign in with Google once.
3. Screen app: open it, type the 9-digit code shown on the screen into the admin app (Screens > Link a new screen).

### التثبيت بثلاث خطوات
1. نزّلي ملف APK على الجهاز وافتحيه. إذا طلب أندرويد السماح بتثبيت التطبيقات من مصدر غير معروف فوافقي.
2. تطبيق الإدارة: افتحيه واتبعي الجولة القصيرة ثم سجّلي الدخول بحساب كوكل مرة واحدة.
3. تطبيق الشاشة: افتحيه ثم اكتبي الكود المكوّن من ٩ أرقام في تطبيق الإدارة (الشاشات > ربط شاشة جديدة).

<details><summary>Checksums (SHA-256)</summary>

\`\`\`
$ADMIN_SHA  signage-admin.apk
$SCREEN_SHA  signage-screen.apk
\`\`\`

</details>

---
<p align="center">Made by <a href="https://hasn2mr.pages.dev"><b>Hasn</b></a> &middot; Open source</p>
MD
