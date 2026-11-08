# Setup guide

About 30 minutes, once. Everything used here is free. Replace the example names with yours.

You will create: a GitHub repository, a Google Cloud project, an Apps Script backend and (optional) a Cloudflare Pages website.

## 1. GitHub repository

1. Sign in at <https://github.com> and click **New repository**. Name it (for example `dur-alrazi-signage`), choose **Public**, create it.
2. Click **Add file > Upload files**. Upload the folders from this project in batches of fewer than 100 files: first `apps`, then `web`, then `backend`, `scripts`, `docs`, `github-setup`, `signing` (the folder only needs a placeholder, skip it), and the loose files (`README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `.gitignore`). Commit after each batch.
3. The browser cannot upload a folder that starts with a dot, so create the two workflow files by hand:
   1. **Add file > Create new file**.
   2. In the name box type `.github/workflows/build-release.yml` (typing `/` creates the folders).
   3. Open `github-setup/workflows/build-release.yml` from this project, copy everything, paste it, and **Commit**.
   4. Repeat with `.github/workflows/create-signing-key.yml`.

## 2. Google Cloud

Open <https://console.cloud.google.com>.

1. **Create a project** (top bar > New project).
2. **APIs & Services > Library**: search **Google Drive API** and click **Enable**.
3. **APIs & Services > OAuth consent screen**: user type **External**, fill the app name and your e-mail. Add these scopes: `.../auth/drive.file` and `.../auth/userinfo.email`. Under **Test users** add the e-mail of everyone who will sign in (or press **Publish app** so anyone may sign in).
4. **Credentials > Create credentials > API key**. Open it, under **API restrictions** choose **Restrict key > Google Drive API**. Copy the key (this is `GOOGLE_API_KEY`).
5. **Credentials > Create credentials > OAuth client ID > Web application**. Under **Authorized JavaScript origins** add your website address (you get it in step 6; you can come back). Copy the client ID (this is `GOOGLE_WEB_CLIENT_ID`).
6. The **Android** client ID is created in step 5 below, after the signing key exists.

## 3. Apps Script backend

1. Open <https://script.google.com> > **New project**. Delete the sample code and paste the whole of `backend/Code.gs`.
2. At the top of the file replace:
   - `PUT_ADMIN_EMAIL_HERE` with the Google e-mail(s) allowed to manage the screens;
   - the two `PUT_..._CLIENT_ID` values with the Android and Web client IDs (the Android one comes in step 5; you may deploy again afterwards).
3. **Deploy > New deployment > Web app**. *Execute as*: **Me**. *Who has access*: **Anyone**. Press **Deploy**, allow the permissions, and copy the **Web app URL** (this is `GAS_URL`).
4. Whenever you edit the code: **Deploy > Manage deployments > Edit > New version**.

## 4. GitHub secrets

In the repository: **Settings > Secrets and variables > Actions > New repository secret**. Create:

| Secret | Value |
| --- | --- |
| `GAS_URL` | the Web app URL from step 3 |
| `GOOGLE_API_KEY` | the API key from step 2.4 |
| `GOOGLE_WEB_CLIENT_ID` | the Web client ID from step 2.5 |
| `SIGNING_PASSPHRASE` | a long random password (20+ characters). Keep a copy somewhere safe |
| `DROPBOX_APP_KEY` | optional, see "More clouds" |
| `ONEDRIVE_CLIENT_ID` | optional, see "More clouds" |

## 5. Signing key and the Android client

1. **Actions** tab > **Create signing key** > **Run workflow**. Open the finished run; the summary shows a **SHA-1**. Copy it.
2. Google Cloud > **Credentials > Create credentials > OAuth client ID > Android**:
   - Package name: `app.durrazi.signage`
   - SHA-1: the value you copied
   Copy the client ID, put it in `backend/Code.gs` (`CLIENT_IDS`) and deploy a new version of the backend (step 3.4).

Keep this key forever: it makes every update install over the previous one. If the apps were installed before the key existed, uninstall them once.

## 6. Build the apps

1. **Actions** tab > **Build and release** > **Run workflow** (it also runs on every change you commit).
2. After a few minutes a **Release** appears on the right side of the repository page with `signage-admin.apk` and `signage-screen.apk`.

## 7. Website (optional)

1. <https://dash.cloudflare.com> > **Workers & Pages > Create > Pages > Connect to Git**, choose the repository.
2. Build command: `node scripts/make-config.mjs && bash scripts/fetch-assets.sh`. Output directory: `web`.
3. **Settings > Environment variables**: add `GAS_URL`, `GOOGLE_API_KEY`, `GOOGLE_WEB_CLIENT_ID` (same values as the secrets) and `GITHUB_REPO` (your `owner/repository`, so the site can offer the app download).
4. Add the site address to **Authorized JavaScript origins** of the Web client (step 2.5).

## 8. Install

- **Screen** (Android TV or tablet): download `signage-screen.apk` from the release, open it, allow "install unknown apps" if asked.
- **Manager's phone**: install `signage-admin.apk` the same way. Follow the short tour, tap **Sign in to cloud**, choose the Google account.
- In the admin app: **Screens > Link a new screen** and type the 9-digit code shown on the screen.

Done. Updates arrive by themselves: the admin app downloads new releases in the background and offers them; the screens receive theirs from the admin app.

## More clouds (optional)

**Dropbox**: <https://www.dropbox.com/developers/apps> > Create app > Scoped access > Full Dropbox. Permissions: `files.content.write`, `files.content.read`, `sharing.write`, `account_info.read`. Add the redirect URI `durrazi://auth/dropbox`. Copy the **App key** into the secret `DROPBOX_APP_KEY`.

**OneDrive**: <https://portal.azure.com> > App registrations > New registration. Accounts: any directory and personal. Authentication > Add a platform > **Mobile and desktop applications** > custom redirect URI `durrazi://auth/onedrive`, and allow public client flows. API permissions: Microsoft Graph delegated `Files.ReadWrite`, `offline_access`, `User.Read`. Copy the **Application (client) ID** into `ONEDRIVE_CLIENT_ID`.

After changing a secret, run **Build and release** again.

Not supported: MediaFire, Mega and pCloud (they offer no public direct-download API that a screen can use).

## Remote control channel

Commands travel through the public notification server `ntfy.sh` (free, no account). Each screen has its own random channel name, so nobody can guess it. If the server is unreachable, commands fall back to the backend and arrive within about a minute. To use your own server set the variable `RT_SERVER` in the workflow and on Cloudflare.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Google says `403 access_denied` | Add your e-mail under **Test users** or publish the consent screen (step 2.3) |
| "This account is not allowed" | Add the e-mail to `ADMINS` in `Code.gs` and deploy a new version |
| Sign-in dialog closes at once | The Android client ID is missing or the SHA-1 does not match the key (step 5) |
| Build stops with "secret or private address" | Remove the value from the code and use a secret |
| Update does not install | Uninstall the old app once; later updates install over it |
