# The Lawn Lads website: security review and settings

Reviewed September 2026. This file isn't published on the website (see `_config.yml`), but the GitHub repository is public, so **never put a password, key or customer detail in it**.

No website is ever "100% secure". This review fixed what could be fixed in the code, and lists what only you can do (section 9). Security is ongoing: re-check the list in section 10 every few months, and whenever you add a new service to the site.

---

## 1. Do this first: put the changes live

The website changes go live when this branch is merged into `main` (GitHub Pages rebuilds in a couple of minutes). **The quote form's Google Apps Script does not update itself.** Until you do these steps, the old, weaker script is still running:

1. Open your **Lawn Lads quotes** Google Sheet → **Extensions → Apps Script**.
2. Select all the code in the editor and delete it. Paste in the whole of the new `quote-form-google-script.gs`. Click **💾 Save**.
3. **Deploy → Manage deployments → ✏️ (Edit) → Version: New version → Deploy.** This keeps the same web address, so `config.js` doesn't change.
   - Google shouldn't ask for new permissions, because the script uses the same Google services as before. If it does ask, check that the list is still only Sheets, Drive and "send email as you" before allowing it.
4. Pick `testSetup` next to ▶ Run and run it. The test email now also tells you how many emails you have left today.
5. From your phone, send one real test quote with a photo. Check you get the email, the Sheet row and the photo in Drive. Then set that row's Status to "Test".
6. After GitHub Pages has rebuilt, open each of these. **All three should show the 404 page:**
   - https://thelawnlads.co.uk/SETUP.html
   - https://thelawnlads.co.uk/SETUP.md
   - https://thelawnlads.co.uk/quote-form-google-script.gs

---

## 2. What the site is made of (inventory)

| Area | What's there |
|---|---|
| Framework / runtime | None. Plain HTML, CSS and one JavaScript file (`site.js`), with no build step and no npm packages |
| Hosting | **GitHub Pages** from the public repo `FinleyGloverEE/TheLawnLads`, custom domain in `CNAME`. GitHub Pages builds with Jekyll, which `_config.yml` now controls |
| Back end | One **Google Apps Script** web app (`quote-form-google-script.gs`), "Execute as: Me", "Access: Anyone". It runs on your Google account |
| Database | None. Quotes go into a **Google Sheet**, photos into a **Google Drive** folder, and an email goes to `admin@thelawnlads.co.uk` |
| API endpoints | Only the Apps Script: `doPost` (receives quotes) and `doGet` (says "running"). Neither ever sends data back to the visitor |
| Forms / user input | Quote form (`quote.html`): name, phone, email, postcode, service, lawn size, description, up to 3 photos, plus a hidden honeypot field. Postcode checker (`index.html`). `?postcode=` in the quote page address |
| File upload | Garden photos on the quote form (browser → Apps Script → Drive + email attachment) |
| Login / admin area | **None on the website.** The real "admin logins" are your Google, GitHub, domain, Microsoft 365, Cal.com and WhatsApp accounts (section 9) |
| External services | postcodes.io (postcode lookup, from the visitor's browser), Google Apps Script/Sheets/Drive/Gmail, Microsoft 365 (inbox), and links to Cal.com, WhatsApp, TikTok and Facebook. Google Fonts was removed |
| Secrets / environment variables | **None needed, none found.** Checked every file and all 21 commits of history, including the deleted zip file |
| Dependencies | None to audit: no package.json and no third-party scripts. The fonts are now served from this site |
| Security headers | Before: none that the site could control. Now: a Content-Security-Policy and Referrer-Policy on every page, set with `<meta>` tags (GitHub Pages doesn't let you set real HTTP headers; section 7) |

---

## 3. Threat model (what could realistically go wrong)

Who might attack a small local business site? Mostly **automated spam bots**, **scammers** going after your accounts (phishing, WhatsApp code scams) and, now and then, **someone targeting you on purpose** (a rival or a grudge). Nobody is likely to spend weeks on it, but cheap attacks are worth blocking.

| Threat | Relevant here? | What protects against it now |
|---|---|---|
| Automated spam / form abuse / bots | **Yes, the main one** | Honeypot, fill-time check, link-spam check, per-person and hourly limits, server-side validation |
| Filling your Google storage / using up your email quota | **Yes** (was easy) | 100MB/day photo budget, emails held back once the quota runs low, warning emails to you |
| Locking real customers out of the form | **Yes** | Junk no longer counts towards the limit. Every error message offers WhatsApp/phone. A determined attacker can still do it (section 9) |
| Malicious file uploads | Yes | File type checked from the file's own bytes, random file names, only real JPG/PNG/WEBP saved, browser re-draws photos |
| XSS (reflected / stored / DOM) | Checked. None found | All customer text is escaped in emails and on the page. CSP blocks inline and third-party scripts as a backstop |
| Email header / recipient injection | Checked | Fixed recipient. Line breaks stripped. Reply-to must be exactly one plain address |
| Spreadsheet formula injection | Yes | Cells starting `= + - @` are stored as text |
| CSRF | **Not applicable** | No logins, cookies or sessions: a forged request can't do anything a visitor can't already do |
| SQL/NoSQL/command injection, path traversal | Not applicable | No database, shell or file paths. Drive file names are built by the script, not the visitor |
| SSRF | Not applicable | The script never fetches a URL that visitors supply |
| Login attacks (brute force, credential stuffing, session theft, cookies) | **Not on the website** | But they apply to your Google/GitHub/etc. accounts (section 9) |
| IDOR / seeing another customer's quote | Not applicable | Nothing on the site or script ever returns a customer's data. Drive photos are private to your account |
| Exposed secrets / API keys | Checked. None | The Apps Script address is public on purpose (section 6) |
| Dependency vulnerabilities | Very low | No dependencies. Google Fonts removed |
| Clickjacking | Low | No one-click actions worth hijacking. Full protection needs HTTP headers (section 7) |
| Open / malicious redirects | Checked. None | The site never redirects based on the web address |
| Information leakage | Was yes (low) | Setup notes and script source no longer published on the website |
| Account takeover (Google, GitHub, domain, WhatsApp) | **Yes, the biggest real-world risk** | Only you can protect these (section 9) |
| Denial of service (flooding) | Partly | GitHub and Google absorb traffic floods. Form flooding is limited (see above) |

---

## 4. Findings

Severity: **CRITICAL** (being exploited or trivially exploitable with serious harm) → **HIGH** → **MEDIUM** → **LOW** → **INFORMATIONAL**. There were **no CRITICAL findings**.

### HIGH-1: The quote form could be used to fill your Google storage, burn your email quota and lock out customers
- **Where:** `quote-form-google-script.gs` (`doPost`, `savePhotos_`, the old `underHourlyLimit_`).
- **Why it matters:** The only limit was 30 requests an hour for *everyone*, counted before any checks. Your Google account's storage (15GB free) is shared between Drive **and Gmail**. When it's full, your Gmail stops receiving email.
- **How it could be abused:** A simple script sending 30 requests an hour, each with 3 photos at the 5MB limit, adds about **10GB a day** to Drive (tested: 450MB/hour). That fills a free account in under 2 days, and 720 emails a day is far over Google's roughly 100/day. Even 30 *empty* junk requests locked every real customer out for the rest of the hour.
- **What changed:**
  - Requests are checked *before* they count, so junk costs an attacker nothing and costs you nothing.
  - New limit of **3 requests an hour per email address or phone number** (hashed, so contact details aren't stored as counter names).
  - A **100MB-a-day photo budget**. After that, quotes are still saved, just without photos.
  - **5 emails a day held back.** Once the quota gets low, quotes go into the Sheet with the status "not emailed" instead of failing.
  - **Warning emails to you**, at most once a day each, when the hourly limit, photo budget or email quota is hit.
- **How it was tested:** `_security-tests/gas.test.js`:
  - 30 junk requests no longer block a real one.
  - The 4th request from the same person is refused, even with the phone number written differently.
  - 12 maximum-size uploads stop at 100MB, and every quote is still saved.
  - A low email quota keeps the quote and warns you.
- **What's left:** Apps Script can't see a visitor's IP address, so someone who changes the email and phone each time can still hit the 30/hour limit and block the form for up to an hour at a time. You'd get a warning email, and customers are told to WhatsApp or call. If it ever happens, see "If the form is attacked" in section 9. **Severity now: MEDIUM.**

### MEDIUM-1: Uploaded "photos" were never checked to be photos
- **Where:** `savePhotos_` in the script. The browser's `shrink()` sent the original file when it couldn't read it.
- **Why it matters:** The script trusted the file type the browser *claimed*. Any file could be saved to your Drive and attached to the quote email as a "photo".
- **How it could be abused:** Someone could send malware or a disguised HTML file labelled `image/jpeg`, hoping you'd open it from the email or Drive.
- **What changed:**
  - The script now works out the type from the **file's own first bytes**: JPG, PNG or WEBP only. Anything else is dropped, and the email tells you so.
  - Size is checked before decoding. Files get a **random name** (date + postcode + random tag + number), never the visitor's file name or anything they typed.
  - The browser now **always re-draws photos** as a fresh JPEG. That removes hidden data such as GPS location, and anything that isn't picture. Files the browser can't read as images are refused with a clear message.
- **How it was tested:** Script tests: an `.exe`, an HTML file and junk data labelled as images are all refused and not attached, `../../evil.php` is stored under a safe random name, and over-5MB photos and a 4th/5th photo are dropped. Browser tests: a fake `.jpg` is refused with a message, real photos arrive as JPEG with no EXIF data, and the whole browser → script path works end to end.
- **What's left:** The byte check proves the file *starts* like an image, not that every byte is valid. Apps Script has no image library to fully decode it. The browser's re-drawing covers real visitors. Files are only stored in your private Drive and are never run as code anywhere.

### MEDIUM-2: No server-side validation, and line breaks allowed in fields that reach the email subject and file names
- **Where:** `doPost` / old `clean_()` in the script.
- **Why it matters:** The script only cut fields to length. It didn't check email, phone or postcode, and it kept line breaks. The **service** field (which goes into the email subject) could contain line breaks, and so could the **name** (which went into Drive file names and attachment names). Anyone can send to the script directly, bypassing the website's checks.
- **How it could be abused:** Junk data filling the Sheet, and attempts to add extra email headers. Google's MailApp very probably blocks header injection itself, and a test couldn't prove otherwise. This fix adds a second layer so it doesn't depend on that.
- **What changed:**
  - The script now checks name, phone, email and postcode with **the same rules as the website** (`site.js` was tightened to match).
  - Service and lawn size are compared against the form's own options. Anything else is saved as "Other: …" and the subject just says "Other".
  - The area-check text must match one of the wordings the website produces, or it's saved as "Not checked".
  - Line breaks, control characters and invisible right-to-left tricks are stripped from one-line fields.
  - Names containing `<` `>` or links are refused.
  - The reply-to must be one plain email address.
  - Phone numbers are stored as text, so Sheets no longer drops the leading 0.
- **How it was tested:** 9 kinds of bad input are each refused with a helpful message and nothing saved. 5,000-character names and 100,000-character descriptions are cut to length. A `\r\nBcc:` attempt never reaches the subject. HTML and `<script>` in fields shows as plain text in the email. Formulas are neutralised. Normal names like "Zoë O'Brien-Nuñez", `+44` numbers and multi-line descriptions still work. A test checks that the script's lists match `quote.html` exactly, so real quotes aren't marked "Other".

### MEDIUM-3: No Content-Security-Policy, and Google Fonts loaded on every page
- **Where:** `<head>` of all 8 pages.
- **Why it matters:** A Content-Security-Policy is the browser's backstop if a script ever gets injected, for example through a mistake in a future edit. Google Fonts meant every visitor's browser contacted Google on every page (a privacy issue, and an extra outside source of CSS).
- **What changed:** A strict CSP is on every page (section 7), with **no `unsafe-inline` and no `unsafe-eval`**. The fonts are now served from this site using **exactly the same font files** Google serves (licence in `FONT-LICENSE.txt`). A Referrer-Policy was added.
- **How it was tested:**
  - Chromium loaded all 8 pages at phone and desktop widths: no CSP violations, no script errors, every image and font loads, and no outside requests on page load.
  - The quote form, Apps Script's `googleusercontent.com` redirect host and the JavaScript-off form post all work under the CSP.
  - A deliberately injected inline script and tracking image were **blocked** (negative control).
  - Before/after screenshots of every page are **pixel-identical**. The only differences are the longer privacy line on the quote form and the sticky phone bar caught at a different point in its slide-in animation.

### MEDIUM-4: No privacy notice for the personal data the form collects
- **Where:** Whole site. The quote form only said "I'll only use your details to reply…".
- **Why it matters:** UK GDPR says people must be told who is collecting their data, why, where it goes, how long it's kept and what their rights are, *when* you collect it.
- **What changed:** The line under the form now accurately says where the details and photos go. A **draft privacy notice** with the facts filled in is in `PRIVACY-NOTICE-DRAFT.md` (not published).
- **What's left:** Decisions only you can make (section 8). This review doesn't make legal claims for you.

### LOW-1: Your setup notes and the script's source code were published on the website
- **Where:** GitHub Pages published `SETUP.md` (also as `SETUP.html`) and `quote-form-google-script.gs`. This was confirmed by building the site with the same Jekyll version GitHub Pages uses.
- **Why it matters:** They show your private `admin@` address, the old spam limits and the honeypot's name. That's handy for a spammer and a target for phishing.
- **What changed:** New `_config.yml` excludes them (and this file) from the website. The same Jekyll build shows every real page is published exactly as before.
- **What's left:** The **repository itself is public**, so these files can still be read on GitHub. That's fine as long as no secrets are ever put in it. The limits were designed on the assumption that an attacker has read the script.

### LOW-2: Some protections need real HTTP headers, which GitHub Pages can't set
- **Where:** Hosting.
- **Why it matters:** These can't be set with a `<meta>` tag:
  - HSTS (forces HTTPS even on a first visit typed without `https://`)
  - frame protection (stops other sites showing yours in a frame, i.e. clickjacking)
  - `X-Content-Type-Options`
  - `Permissions-Policy`
- **How it could be abused:** Clickjacking needs a one-click action worth tricking someone into, and this site has none (quotes need typing). Missing HSTS matters mainly on hostile Wi-Fi.
- **What's left:** Optional. Put the site behind Cloudflare's free plan, or move it to Cloudflare Pages, and add the headers in section 7. **Owner decision.**

### LOW-3: Weak spam protection (honeypot only)
- **What changed:**
  - Submissions made less than 3 seconds after the page loaded, or with more than 2 links in the description, are **saved in the Sheet with the status "Check: possible spam"**, with no photos and no email. Nothing is silently lost, so glance at those rows now and then.
  - Honeypot hits are still silently ignored.
  - No CAPTCHA was added. Too much friction for customers right now.
- **How it was tested:** Script tests for each signal. Browser test confirms real submissions send the time on page.

### LOW-4: Tampered "area check" was trusted
- The in-area/outside flag is worked out in the visitor's browser, so someone could fake "In area". It's now limited to known wordings. **Always go by the postcode itself**, not the flag.

### LOW-5: Email authentication for thelawnlads.co.uk not verified
- I couldn't look up DNS from the review environment. Without **SPF, DKIM and DMARC**, a scammer can more easily send email that looks like it's from `@thelawnlads.co.uk`, such as fake invoices with changed bank details sent to your customers. Check in section 9.

### INFORMATIONAL (checked, no change needed)
- **XSS:** every place `site.js` builds HTML escapes the values. The postcode checker only displays place names from `config.js`, never text from postcodes.io. Tested with script payloads in the name, postcode checker, `?postcode=` address and server error message: nothing runs.
- **CSRF:** not applicable (no logins/cookies/sessions). Adding CSRF tokens would add nothing.
- **Authentication / authorisation / IDOR:** there's no login and no endpoint that returns stored data, so there's nothing to escalate or enumerate. Drive photos stay private to your Google account.
- **Database injection:** no database. The Sheet is written with `appendRow`, not formulas or queries.
- **Secrets:** none in code or history.
- **Links:** every `target="_blank"` link has `rel="noopener noreferrer"`.
- **Least privilege:** the script sends mail with `MailApp` (send-only) rather than `GmailApp` (which could read your inbox). Good. `DriveApp` needs full Drive access, which is another reason to use a dedicated Google account (section 9).
- **Errors:** customers only ever see short, fixed messages. Stack traces, file paths and settings are never sent back.
- **Leftover:** `quote.html?quote=sent` shows the thank-you box (left over from FormSubmit). Harmless.

---

## 5. Limits and rules (all in `CONFIG` at the top of the script)

| Setting | Value | What it does |
|---|---|---|
| `MAX_PER_HOUR` | 30 | Valid quote requests accepted per hour, from everyone together |
| `MAX_PER_PERSON_PER_HOUR` | 3 | Per email address **or** phone number |
| `MAX_PHOTO_MB_PER_DAY` | 100 | Photo storage per day. After that, quotes are saved without photos |
| `EMAIL_RESERVE` | 5 | Emails kept back each day for warnings |
| `MIN_FILL_SECONDS` | 3 | Faster than this = marked "possible spam" |
| `MAX_PHOTOS` | 3 | Photos per request (the website allows 3 too) |
| `MAX_PHOTO_BYTES` | 5MB | Per photo after the browser shrinks it (usually 200–600KB) |
| `MAX_REQUEST_BYTES` | 22MB | Whole request |
| Allowed photo types | JPG, PNG, WEBP | Checked from the file's bytes. The browser also turns every photo into a ≤1600px JPEG |
| Field lengths | name 80, phone 30, email 120, description 1500 | Same limits as the form's `maxlength` |

The website's own limits (in `site.js`): 3 photos, 10MB each before shrinking, 12MB total after shrinking, and only JPG/PNG/WEBP the browser can actually read.

**If you change the choices in the "What do you need?" list or the lawn sizes in `quote.html`, make the same change in `SERVICES` / `LAWN_SIZES` at the top of the script** (quotes still arrive if you forget, but marked "Other: …").

---

## 6. Configuration: public vs private

| Item | Public or private? | Where it lives |
|---|---|---|
| Phone, WhatsApp number, `quotes@` email, Cal.com link, service areas | **Public** (shown on the site) | `config.js` |
| `quoteEndpoint` (Apps Script web app address) | **Public on purpose.** Browsers must know it to send quotes. Knowing it only lets someone *send* a quote, which is why the script checks everything | `config.js`, `quote.html` |
| `NOTIFY_EMAIL` (`admin@`) | Not secret, but not advertised | The script (not published on the website) |
| Photo folder ID, daily counters | Private | Apps Script → Project Settings → Script Properties (created automatically) |
| Google / GitHub / Microsoft / domain / Cal.com passwords | **Secret** | Only in your password manager. Never in this repo |

There are **no environment variables or API keys** to set. postcodes.io needs no key. If you ever add a service that needs a secret key, it must go in the Apps Script's **Script Properties**, never in `config.js` or any file in this repository, because everything in the repo and on the website is public.

**CORS:** the Apps Script answers any website (Google controls this), which is fine because it only ever replies "ok" or a short error. The site sends quotes as `text/plain` so browsers don't need a pre-flight check. Don't change that header or the form will stop working.

---

## 7. Security headers and Content-Security-Policy

### What's on every page now (in `<head>`, right after `<meta charset>`)

```
default-src 'self';
script-src 'self';
style-src 'self';
font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://api.postcodes.io https://script.google.com https://script.googleusercontent.com;
form-action 'self' https://script.google.com https://script.googleusercontent.com;
frame-src 'none'; worker-src 'none'; object-src 'none';
base-uri 'self'; manifest-src 'self';
upgrade-insecure-requests
```

Why each part is there:

| Directive | Why |
|---|---|
| `script-src 'self'` | Only `config.js` and `site.js`. **No `unsafe-inline` or `unsafe-eval`.** The structured-data block on the home page isn't blocked because browsers don't run `application/ld+json` |
| `style-src 'self'`, `font-src 'self'` | `site.css` and the self-hosted fonts. There are no inline styles |
| `img-src data: blob:` | `data:` for the dropdown arrow in `site.css`. `blob:` for photo previews and shrinking on the quote form |
| `connect-src` | postcodes.io lookups, and sending the quote to Apps Script, which redirects to `script.googleusercontent.com` for the reply |
| `form-action` | Lets the form still work for visitors with JavaScript switched off |
| `frame-src 'none'`, `object-src 'none'`, `worker-src 'none'` | Nothing on the site uses them |
| `base-uri 'self'` | Stops an injected `<base>` tag redirecting relative links |

**Adding a new service** (analytics, a Cal.com embed, a map, a review widget): add its domain to the right directive **on all 8 pages**, then check the browser console for "Refused to…" messages. Adding a page: copy the whole `<head>` from an existing page. Only add `unsafe-inline` or `unsafe-eval` if something genuinely can't work without it, and write down why here.

`Referrer-Policy: strict-origin-when-cross-origin` (via `<meta name="referrer">`) means other sites only see `thelawnlads.co.uk`, never a full address such as `quote.html?postcode=LE10…`.

### What GitHub Pages can't do

GitHub Pages doesn't let you set your own HTTP headers. So the CSP is a `<meta>` tag, which can't include `frame-ancestors`, and there's no way to add the headers below. If you put the domain behind **Cloudflare (free plan)**, or move to **Cloudflare Pages** (which also works with a private repo), add these:

```
Strict-Transport-Security: max-age=31536000
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Referrer-Policy: strict-origin-when-cross-origin
```

Leave out `includeSubDomains`/`preload` on HSTS unless you're sure every subdomain (including Microsoft 365 ones) is HTTPS-only. Check the result at securityheaders.com. (The Permissions-Policy doesn't affect taking photos with the file picker.)

### HTTPS

In GitHub → repo **Settings → Pages**, **"Enforce HTTPS" must be ticked**. That makes `http://` redirect to `https://`. The site has no mixed content (every resource is on the same site or `https://`), and `upgrade-insecure-requests` covers any future slip.

---

## 8. Privacy (UK GDPR) review

| | |
|---|---|
| **What's collected** | Quote form: name, phone, email, postcode, service, lawn size, free-text description, up to 3 garden photos, the in-area check, the page address and the time. Nothing else: **no cookies, no analytics, no tracking** |
| **Why** | To reply with a quote and arrange the work |
| **Where it's stored** | Your Google account: the **Sheet**, the **Drive** folder and, usually, a copy in the Gmail **Sent** folder (emails the script sends normally appear there). The `admin@thelawnlads.co.uk` inbox (Microsoft 365). Your phone, if you reply on WhatsApp |
| **Who else handles it** | Google (Apps Script, Sheets, Drive, Gmail), Microsoft (email), **postcodes.io** (only the postcode, sent from the visitor's browser when they use the checker or leave the postcode box). Cal.com and WhatsApp only if the customer chooses to use them |
| **How long it's kept** | **Not decided yet.** Nothing is deleted automatically |
| **Photos** | Browsers now strip hidden data such as GPS location before sending |

**Decisions only you can make** (then fill in `PRIVACY-NOTICE-DRAFT.md` and publish it as a page linked from the form and footer):
1. **Who the data controller is:** you by name, or a parent/guardian if you're under 18 and they're responsible for the business. Plus a contact for privacy questions.
2. **How long you keep quotes that didn't turn into jobs** (a common choice is 6–12 months), and customer records for jobs you did. HMRC expects business records to be kept for **at least 5 years after the 31 January Self Assessment deadline** for that tax year. When you delete, remember the four copies: the Sheet row, the Drive photos, the Gmail Sent email and the Microsoft 365 email.
3. **Whether to use a separate Google account for the business.** A personal Gmail account doesn't come with a data processing agreement. Google Workspace does, and it keeps business data apart from your personal email. Worth considering once the business grows.
4. **Whether you need to pay the ICO data protection fee.** Many small businesses that only handle their own customers' details are exempt, but check with the ICO's online self-assessment ("Do I need to pay the data protection fee?") rather than assuming.
5. Only ask for what you need: the form requires both phone *and* email. Keep both if you genuinely use both.

---

## 9. What still needs you (in priority order)

1. **Deploy the new script** (section 1). Until then the backend fixes aren't live.
2. **Lock down the accounts that really control the business.** This is now the biggest risk:
   - **Google account** that owns the Sheet/Drive/script: 2-Step Verification using a **passkey or the Google prompt** (not just SMS), plus up-to-date recovery email/phone. Check Security → "Your connections to third-party apps" and remove anything you don't recognise.
   - **GitHub:** turn on 2FA. Anyone who gets in can change the website, including the form's destination. Also, in the repo's **Settings → Code security**, turn on **Secret scanning** and **Push protection** (free for public repos).
   - **Domain registrar** (where thelawnlads.co.uk is registered): 2FA and a transfer/registrar lock.
   - **Microsoft 365** (`admin@`, `quotes@`): MFA with the Authenticator app.
   - **WhatsApp:** Settings → Account → **Two-step verification** (a PIN). The "I sent you a code by mistake" scam is one of the most common ways UK small businesses lose their WhatsApp.
   - **Cal.com:** 2FA.
   - Use a password manager and a different password for each one.
3. **Tick "Enforce HTTPS"** in GitHub Pages settings, then confirm `http://thelawnlads.co.uk` redirects to `https://`.
4. **Check email authentication** for thelawnlads.co.uk. In the Microsoft 365 admin centre, make sure **DKIM** is switched on. Use a free checker (e.g. MXToolbox) for **SPF** and **DMARC**. A DMARC record starting at `p=none` with reports is a safe first step.
5. **Privacy decisions** (section 8), then publish a privacy page.
6. **Never share the "Lawn Lads quote photos" Drive folder or the Sheet** with "Anyone with the link".
7. **Treat quote emails as untrusted:** don't open links or attachments in them that you weren't expecting. The email now says so in its footer.
8. Optional: Cloudflare in front of the site for the extra headers (section 7).

**If the form is attacked** (you get "hourly limit" warnings and the Sheet fills with rubbish): check the Apps Script **Executions** page. The logs say *why* requests were refused, never what people typed. Short term, lower `MAX_PER_HOUR` or temporarily blank `quoteEndpoint` in `config.js` (the form then points people to WhatsApp). The proper fix is **Cloudflare Turnstile**, a free and mostly invisible CAPTCHA: the form gets a Turnstile widget, and the script checks its token with Cloudflare before accepting. That needs a Cloudflare account, a CSP update, and one new Google permission (the script contacting an outside service). It isn't turned on now because nothing suggests it's needed yet.

---

## 10. Logging and error handling

- **Script logs** (Apps Script → Executions, visible only to you) record the *outcome and reason* of each request: accepted, rejected (invalid email, hourly limit, per-person limit, too large, unreadable), ignored (honeypot), flagged (sent too fast / lots of links), or an error with a short message. **They never include names, emails, phone numbers, postcodes or descriptions.** Tests check this.
- **Customers** only ever see short fixed messages ("Some details need checking: email.", "Something went wrong on our side."), always with WhatsApp and phone as a fallback. Never stack traces, file paths or settings.
- **You** get a warning email, at most once a day per problem, when the hourly limit, photo budget or email quota is hit. Problems with a single quote are shown in its Status cell ("email failed", "not emailed: daily email limit", "Check: possible spam (…)").
- There are no passwords, keys or session tokens anywhere in the system to leak into logs.

---

## 11. Testing

Two test suites are in `_security-tests/` (a folder starting with `_`, so it's never published). They need Node.js; the browser tests also need Playwright (`npm i -g playwright`).

```
node _security-tests/gas.test.js     # the Apps Script, against mocked Google services  (62 checks)
node _security-tests/site.test.js    # all pages in real Chromium, third parties mocked (145 checks)
```

**Covered:**
- invalid, oversized, HTML and JavaScript input
- malicious file names, fake and oversized images, too many photos
- rapid and repeated submissions: hourly, per-person, photo and email limits
- honeypot and bot signals
- malformed requests (broken JSON, wrong types, oversized body)
- formula injection
- email escaping and header line breaks
- logs free of personal data
- the CSP on every page at phone and desktop widths, with a negative control
- no script errors, no outside requests on page load, every image and font loads
- all internal links work, no sideways scrolling
- postcode checker results
- the full quote journey, and JavaScript-off form posting
- browser-to-script end to end

**Not testable from the review environment, so check these yourself:** the live site's real HTTP headers and HTTPS redirect, DNS/email records, and the real Google script after you deploy it (steps 4–6 in section 1). Unauthenticated/unauthorised access, expired sessions, IDOR and invalid IDs don't apply, because there are no logins, sessions or record IDs anywhere in the system.

---

## 12. Checklist

- [x] **HTTPS enforced:** in the code yes (no mixed content, `upgrade-insecure-requests`). **You:** confirm "Enforce HTTPS" is ticked
- [x] **Secure cookies:** not applicable (the site sets no cookies)
- [~] **Security headers:** Referrer-Policy yes. HSTS, frame protection, nosniff and Permissions-Policy need Cloudflare (optional)
- [x] **CSP:** strict, no `unsafe-inline`/`unsafe-eval`, tested on every page
- [x] **Form validation:** in the browser, matched by the server
- [x] **Server-side validation**
- [x] **XSS protection:** escaping everywhere, with the CSP as backstop, tested
- [x] **CSRF protection where required:** not required (no sessions); documented why
- [x] **Rate limiting:** hourly, per-person, daily photo and email reserve. (No IP limits: Apps Script can't see IPs)
- [x] **Spam protection:** honeypot, fill-time and link checks. Turnstile ready as a next step
- [x] **File upload protection**
- [x] **API security:** one endpoint, all input distrusted, returns no data
- [x] **Authentication security:** no website login. **You:** 2FA on every account (section 9)
- [x] **Authorisation checks:** nothing to authorise, and no data is ever returned
- [x] **Database protection:** no database. Formula injection blocked in the Sheet
- [x] **Secrets protected:** none exist in code or history
- [x] **Dependency audit:** no dependencies. Google Fonts removed
- [x] **Error handling:** generic messages only
- [x] **Logging:** outcomes logged, no personal data
- [~] **Privacy review:** done, and the form note is accurate. **You:** decisions in section 8
- [x] **Mobile security considerations:** photo location data stripped, no app permissions used, sticky bar and forms tested at phone widths
- [~] **Production configuration reviewed:** code yes. **You:** deploy the script, check Pages HTTPS and DNS email records
