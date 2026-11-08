<div dir="rtl" align="right">

# دليل التثبيت

حوالي ٣٠ دقيقة، مرة واحدة فقط. كل ما هنا مجاني. استبدلي الأسماء التجريبية بأسمائك.

ستنشئين: مستودع جيت هب، ومشروع Google Cloud، وخادماً خلفياً بـ Apps Script، وموقعاً اختيارياً على Cloudflare Pages.

## ١. مستودع جيت هب

1. سجّلي الدخول في <https://github.com> واضغطي **New repository**. سمّيه (مثلاً `dur-alrazi-signage`) واختاري **Public** ثم أنشئيه.
2. اضغطي **Add file > Upload files**. ارفعي مجلدات المشروع على دفعات كل دفعة أقل من ١٠٠ ملف: أولاً `apps` ثم `web` ثم `backend` و`scripts` و`docs` و`github-setup`، ثم الملفات المنفردة (`README.md` و`LICENSE` و`SECURITY.md` و`CONTRIBUTING.md` و`.gitignore`). اضغطي Commit بعد كل دفعة.
3. المتصفح لا يرفع المجلدات التي يبدأ اسمها بنقطة، لذلك أنشئي ملفَّي العمل يدوياً:
   1. **Add file > Create new file**.
   2. في خانة الاسم اكتبي `.github/workflows/build-release.yml` (كتابة `/` تنشئ المجلدات).
   3. افتحي الملف `github-setup/workflows/build-release.yml` من المشروع، انسخي كل محتواه، الصقيه ثم **Commit**.
   4. كرّري نفس الشيء مع `.github/workflows/create-signing-key.yml`.

## ٢. Google Cloud

افتحي <https://console.cloud.google.com>.

1. **أنشئي مشروعاً** (الشريط العلوي > New project).
2. **APIs & Services > Library**: ابحثي عن **Google Drive API** واضغطي **Enable**.
3. **APIs & Services > OAuth consent screen**: النوع **External**، اكتبي اسم التطبيق وبريدك. أضيفي النطاقين `drive.file` و`userinfo.email`. في **Test users** أضيفي بريد كل من سيسجّل الدخول (أو اضغطي **Publish app** ليتمكن الجميع).
4. **Credentials > Create credentials > API key**. افتحيه وفي **API restrictions** اختاري **Restrict key > Google Drive API**. انسخي المفتاح (هذا هو `GOOGLE_API_KEY`).
5. **Credentials > Create credentials > OAuth client ID > Web application**. في **Authorized JavaScript origins** أضيفي عنوان موقعك (تحصلين عليه في الخطوة ٧، ويمكنك العودة لاحقاً). انسخي معرّف العميل (هذا هو `GOOGLE_WEB_CLIENT_ID`).
6. معرّف عميل **Android** ننشئه في الخطوة ٥ بعد وجود مفتاح التوقيع.

## ٣. الخادم الخلفي Apps Script

1. افتحي <https://script.google.com> > **New project**. احذفي الشيفرة التجريبية والصقي كل محتوى `backend/Code.gs`.
2. في أعلى الملف استبدلي:
   - `PUT_ADMIN_EMAIL_HERE` ببريد (أو بريدات) كوكل المسموح لها بإدارة الشاشات؛
   - قيمتَي `PUT_..._CLIENT_ID` بمعرّفَي Android وWeb (معرّف Android يأتي في الخطوة ٥، وتعيدين النشر بعده).
3. **Deploy > New deployment > Web app**. *Execute as*: **Me**. *Who has access*: **Anyone**. اضغطي **Deploy** ووافقي على الصلاحيات وانسخي **رابط Web app** (هذا هو `GAS_URL`).
4. كلما عدّلتِ الشيفرة: **Deploy > Manage deployments > Edit > New version**.

## ٤. أسرار جيت هب

في المستودع: **Settings > Secrets and variables > Actions > New repository secret**. أنشئي:

| السر | القيمة |
| --- | --- |
| `GAS_URL` | رابط Web app من الخطوة ٣ |
| `GOOGLE_API_KEY` | مفتاح API من الخطوة ٢-٤ |
| `GOOGLE_WEB_CLIENT_ID` | معرّف عميل Web من الخطوة ٢-٥ |
| `SIGNING_PASSPHRASE` | كلمة سر عشوائية طويلة (٢٠ حرفاً أو أكثر). احتفظي بنسخة في مكان آمن |
| `DROPBOX_APP_KEY` | اختياري، انظري «سحابات إضافية» |
| `ONEDRIVE_CLIENT_ID` | اختياري، انظري «سحابات إضافية» |

## ٥. مفتاح التوقيع وعميل Android

1. تبويب **Actions** > **Create signing key** > **Run workflow**. افتحي التشغيل المنتهي، يظهر في الملخص **SHA-1**. انسخيه.
2. في Google Cloud: **Credentials > Create credentials > OAuth client ID > Android**:
   - اسم الحزمة (Package name): `app.durrazi.signage`
   - SHA-1: القيمة التي نسختِها

   انسخي معرّف العميل وضعيه في `backend/Code.gs` (القائمة `CLIENT_IDS`) ثم انشري نسخة جديدة من الخادم (الخطوة ٣-٤).

احتفظي بهذا المفتاح دائماً: به تُثبَّت كل التحديثات فوق السابقة. إذا كانت التطبيقات مثبتة قبل وجوده فاحذفيها مرة واحدة.

## ٦. بناء التطبيقين

1. تبويب **Actions** > **Build and release** > **Run workflow** (ويعمل أيضاً مع كل تعديل تحفظينه).
2. بعد دقائق يظهر **Release** على يمين صفحة المستودع فيه `signage-admin.apk` و`signage-screen.apk`.

## ٧. الموقع (اختياري)

1. <https://dash.cloudflare.com> > **Workers & Pages > Create > Pages > Connect to Git** واختاري المستودع.
2. أمر البناء: `node scripts/make-config.mjs && bash scripts/fetch-assets.sh`. مجلد الإخراج: `web`.
3. **Settings > Environment variables**: أضيفي `GAS_URL` و`GOOGLE_API_KEY` و`GOOGLE_WEB_CLIENT_ID` (بنفس قيم الأسرار) و`GITHUB_REPO` (بصيغة `owner/repository` ليعرض الموقع زر تحميل التطبيق).
4. أضيفي عنوان الموقع إلى **Authorized JavaScript origins** في عميل Web (الخطوة ٢-٥).

## ٨. التثبيت

- **الشاشة** (أندرويد TV أو تابلت): نزّلي `signage-screen.apk` من صفحة الإصدار وافتحيه ووافقي على «تثبيت من مصدر غير معروف» إن طُلب.
- **هاتف المديرة**: ثبّتي `signage-admin.apk` بالطريقة نفسها. اتبعي الجولة القصيرة واضغطي **تسجيل الدخول إلى السحابة** واختاري حساب كوكل.
- في تطبيق الإدارة: **الشاشات > ربط شاشة جديدة** واكتبي الكود المكوّن من ٩ أرقام الظاهر على الشاشة.

انتهى. التحديثات تصل تلقائياً: تطبيق الإدارة ينزّل الإصدارات الجديدة في الخلفية ويعرضها، والشاشات تستلم تحديثها من تطبيق الإدارة.

## سحابات إضافية (اختياري)

**Dropbox**: <https://www.dropbox.com/developers/apps> > Create app > Scoped access > Full Dropbox. الصلاحيات: `files.content.write` و`files.content.read` و`sharing.write` و`account_info.read`. أضيفي عنوان إعادة التوجيه `durrazi://auth/dropbox`. انسخي **App key** إلى السر `DROPBOX_APP_KEY`.

**OneDrive**: <https://portal.azure.com> > App registrations > New registration. الحسابات: أي دليل وحسابات شخصية. من Authentication > Add a platform > **Mobile and desktop applications** أضيفي العنوان `durrazi://auth/onedrive` وفعّلي public client flows. صلاحيات Microsoft Graph (Delegated): `Files.ReadWrite` و`offline_access` و`User.Read`. انسخي **Application (client) ID** إلى `ONEDRIVE_CLIENT_ID`.

بعد تغيير أي سر شغّلي **Build and release** من جديد.

غير مدعوم: MediaFire وMega وpCloud (لا توفر واجهة روابط مباشرة تستطيع الشاشة استخدامها).

## قناة التحكم عن بُعد

تمر الأوامر عبر خادم الإشعارات العام `ntfy.sh` (مجاني وبلا حساب). لكل شاشة اسم قناة عشوائي خاص بها فلا يمكن تخمينه. إذا تعذر الوصول إليه تعود الأوامر عبر الخادم الخلفي وتصل خلال دقيقة تقريباً. لاستخدام خادمك الخاص عيّني المتغير `RT_SERVER` في ملف العمل وفي Cloudflare.

## حل المشاكل

| العَرَض | الحل |
| --- | --- |
| كوكل يعرض `403 access_denied` | أضيفي بريدك في **Test users** أو انشري شاشة الموافقة (الخطوة ٢-٣) |
| «هذا الحساب غير مصرح له» | أضيفي البريد إلى `ADMINS` في `Code.gs` وانشري نسخة جديدة |
| نافذة تسجيل الدخول تُغلق فوراً | معرّف عميل Android ناقص أو SHA-1 لا يطابق المفتاح (الخطوة ٥) |
| البناء يتوقف بسبب «secret or private address» | احذفي القيمة من الشيفرة واستخدمي سراً |
| التحديث لا يُثبَّت | احذفي التطبيق القديم مرة واحدة، والتحديثات اللاحقة تُثبَّت فوقه |

</div>
