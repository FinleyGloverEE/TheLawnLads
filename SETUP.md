# The Lawn Lads — Phase 1 website update

## What to upload

The site is now split into separate pages. Everything sits in **one flat folder, with no subfolders**, so you can upload it all through GitHub's normal "Add file → Upload files" button in one go:

| File | What it is |
|---|---|
| `index.html` | Home: the hero, postcode checker, prices, two before/afters and how it works |
| `services.html` | Services & Prices: every service, what's included, prices |
| `our-work.html` | Our Work: every before & after, with filter buttons |
| `about.html` | About |
| `faq.html` | FAQ |
| `quote.html` | Get a Free Quote: the photo quote form |
| `contact.html` | Contact & booking |
| `404.html` | Shown if someone lands on a page that doesn't exist |
| `config.js` | **Your settings** (phone, WhatsApp, email, booking link, quote form address, areas) |
| `quote-form-google-script.gs` | The quote-form receiver that runs in Google Apps Script. It doesn't need uploading to GitHub (see section 1) |
| `site.css`, `site.js` | The look and the behaviour, shared by every page |
| `*.woff2`, `FONT-LICENSE.txt` | The two fonts (Archivo Black and Atkinson Hyperlegible), served from your own site instead of Google, plus their free licence |
| `_config.yml` | Tells GitHub Pages not to publish your notes (`SETUP.md`, `SECURITY.md`, the privacy draft) or the Google Script code |
| `SECURITY.md` | Security review, limits, and what to do if the form is ever spammed. **Read section 1 of it after any security update** |
| `privacy.html` | Privacy notice (linked from every footer and the quote form). Update it if you change what you collect, who handles it, or how long you keep it |
| `_security-tests/` | Automatic tests for the form and pages. Optional, never published |
| `*.jpg` | The before/after photos |
| `sitemap.xml`, `robots.txt` | Help Google find every page. Submit the sitemap in Google Search Console once the site is live |

The old `before.jpg` and `after.jpg` from the first version aren't used any more. You can delete them from GitHub or leave them.

**Links use `.html` names** (e.g. `services.html`), so they work the same on Vercel, Cloudflare Pages and GitHub Pages without any extra setup. If you're on Cloudflare Pages, it will quietly redirect `/services.html` to `/services`. That's fine.

**The header and footer are copied onto every page.** If you add a page or rename a menu item, change it on every page (including `privacy.html` and `404.html`). For a new page, copy the whole `<head>` from an existing one: it includes the security policy that decides which outside services the page may use (see SECURITY.md section 7 before adding any new service, like analytics or a map).

---

## 1. Connect the quote form to your Google Sheet (about 10 minutes, once)

Quote requests no longer go through FormSubmit. They go to a small script that runs on **your own Google account**. For every request it:

- adds a row to a Google Sheet (name, phone, email, postcode, whether you cover it, service, size, description, photo links, and a **Status** column you can change to Quoted / Booked / Not interested)
- saves the photos in a Google Drive folder called **Lawn Lads quote photos**
- emails **admin@thelawnlads.co.uk** with the details and the photos attached. Hit Reply to answer the customer, or use the WhatsApp link in the email.

If an email ever goes missing, the request is still in the Sheet. The form also tells customers to WhatsApp or call if something fails, so no quote gets lost without anyone knowing.

**Steps**

1. Sign in to the Google account you want to own the quotes (your Gmail is fine).
2. Go to **sheets.new** to make a new Google Sheet. Call it `Lawn Lads quotes`.
3. In the Sheet's menu: **Extensions → Apps Script**. A code editor opens.
4. Delete the few lines of example code that are there. Open `quote-form-google-script.gs` from the zip, copy **all** of it, and paste it in. Click the **💾 Save** icon. At the top, rename the project from "Untitled project" to `Lawn Lads quote form`.
5. **Test the email first.** In the dropdown next to ▶ Run, pick `testSetup`, then click **▶ Run**.
   - Google will ask for permission. Click **Review permissions**, choose your account, then **Advanced → Go to Lawn Lads quote form (unsafe) → Allow**. "Unsafe" only means Google hasn't reviewed a script you wrote for yourself. It's asking to add rows to your Sheet, save photos to your Drive and send emails as you.
   - Check that a "test email" reached **admin@thelawnlads.co.uk**, and that a **Quotes** tab has appeared in the Sheet.
   - **If the test email doesn't arrive, stop here and tell me.** That means your Microsoft 365 inbox is blocking outside mail, and the form was never the problem.
6. Click **Deploy → New deployment**. Click the ⚙️ next to "Select type" and choose **Web app**. Set:
   - Description: `Quote form`
   - Execute as: **Me**
   - Who has access: **Anyone** (this lets the website send to it; nobody can read your Sheet)

   Click **Deploy**, then **copy the Web app URL**. It ends in `/exec`.
7. Paste that URL into two places:
   - `config.js`: between the quotes on the `quoteEndpoint: ""` line
   - `quote.html`: replace `PASTE-YOUR-GOOGLE-SCRIPT-URL-HERE` on the `<form id="quote-form"` line. This is only used by the rare visitor with JavaScript switched off.
8. Upload `config.js`, `quote.html` and `site.js` to GitHub, replacing the old copies. Wait a couple of minutes for GitHub Pages to update.
9. **Send yourself a test quote** from the live site with a photo attached. You should see the thank-you message. The email with the photo should reach admin@, a new row should appear in the Sheet, and the photo should be in the Drive folder.

**If you change the script later:** use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. That keeps the same URL, so you don't need to touch the website. "New deployment" would give you a new URL.

**Security updates to the script** can need new permissions. Always run `testSetup` from the editor *before* deploying the new version (SECURITY.md section 1B has the exact steps). The script also watches the live website every hour. After you change phone numbers, links, `config.js` or `site.js`, you'll get an email about it: run `approveCurrentSite` to confirm it was you.

**Good to know**
- The notification emails come from your Google account, so the sender will be your Gmail. Replies go to the customer automatically.
- Free Google accounts can send about 100 of these emails a day, which is far more than you'll need.
- Photos are shrunk on the customer's phone before sending (to about 1600px, usually 200–600KB each), so uploads are quick on mobile data.
- Spam protection: a hidden "honeypot" field, a check that the form wasn't filled in by a bot in under 3 seconds, a limit of 30 requests an hour overall and 3 an hour from the same email or phone, and a 100MB-a-day cap on photos so nobody can fill your Google storage. Anything that looks automated goes into the Sheet marked "Check: possible spam", with no email. You get a warning email if a limit is hit. The numbers are at the top of the script, and SECURITY.md explains each one.
- If you change the choices in the "What do you need?" list or the lawn sizes in `quote.html`, make the same change in `SERVICES` / `LAWN_SIZES` at the top of the script.
- Customers don't get an automatic confirmation email. They see the thank-you message on screen instead. That's easy to add to the script later if you want it.

---

## 2. Settings: `config.js`

Every phone, WhatsApp, email and booking link on every page comes from this one file:

| Setting | What it does |
|---|---|
| `whatsappNumber` | WhatsApp number in international format, digits only (07912 613180 → `447912613180`) |
| `whatsappMessage` | The message that's already typed in when someone taps WhatsApp |
| `phoneDisplay` / `phoneInternational` | The number shown on the page, and the one the Call buttons dial |
| `contactEmail` | The email shown on the page |
| `bookingUrl` | Your Cal.com page (every "Book a Lawn Cut" button) |
| `quoteEndpoint` | Your Google Script web app URL. It's where quote requests go (see section 1) |
| `serviceAreas` | The places the postcode checker counts as covered, with a centre point for each |
| `fallbackSectors` | Backup postcode list, only used if the lookup service is down |

---

## 3. How the postcode checker decides

It looks up the postcode with **postcodes.io**, a free UK postcode service that needs no key or account.

- **"Good news! We cover your area 🌱"**: the postcode's parish, built-up area or council ward is one of Hinckley, Burbage, Earl Shilton, Barwell, Stoke Golding or Sapcote.
- **"You're just outside…"**: any other postcode within about 10 miles. The message names the nearest place you cover and roughly how far away it is. If it's within 1.5 miles, it says it's worth asking.
- **"That's outside the area we cover right now"**: further away than that. People still get the option to ask anyway.
- **If postcodes.io is down**, it falls back to a rough list of postcode sectors (LE10 0–3, LE9 4, LE9 7, LE9 8, CV13 6). In that case it says "we'll confirm when we reply" instead of giving a firm answer. Those sectors also cover a few nearby villages (Stoney Stanton and Aston Flamville, for example), so treat these results as approximate.

This isn't an exact boundary map, and the site doesn't pretend it is. Anyone just outside can still send a request.

**To start covering somewhere new**, add it to `serviceAreas` in `config.js` with its name exactly as postcodes.io spells the parish or town, e.g. `{ name: "Stoney Stanton", lat: 52.549, lon: -1.278 }`, and add it to the "Covering:" list in `index.html` and the areas line in `about.html`.

---

## 4. Adding real before & after photos

`our-work.html` has a comment explaining how. In short:

1. Upload the two photos alongside the other files (not in a folder), e.g. `hedge-1-before.jpg` and `hedge-1-after.jpg`. Phone photos are fine. Keep them to about 1200px on the long side if you can.
2. In `our-work.html`, copy one `<article class="job">…</article>` block, then change `data-category` to one of `mowing`, `overgrown`, `tidy`, `hedge` or `oneoff`. After that, update the image paths, the `width`/`height`, the alt text, the title, the note and the two captions. The first photo's label says "Before". You can change it to "During" for a mid-job shot, as on the shrub job.
3. The filter buttons update themselves. Only categories that have jobs get a button, so there are never empty tabs.
4. The home page shows your two best jobs. To change which two, swap the `<article class="job">` blocks in `index.html`.

Only ever add photos from real jobs, and ask the customer before posting their garden.

---

## 5. Check these FAQ answers are true for you

The FAQ (in `faq.html`) is written in your voice, but some answers are **policies I had to assume**. Change them if they're wrong. Google gets the FAQ structured data built from whatever's on the page, so you only edit the text in one place.

- **How do I pay?** Says cash on the day or bank transfer.
- **Can I cancel or reschedule?** Says "ideally the day before", with no cancellation fee mentioned.
- **Do you take away the grass cuttings?** Says yes, as standard. Only keep that if you can actually take them away every time.
- **Do you bring your own equipment?** Says mower, strimmer and bags.
- **How long does a lawn cut take?** Says 30 minutes to an hour for most gardens.
- **Do I need to be home?** Says no, as long as you can get into the garden.

(Google now only shows FAQ drop-downs in search results for government and health sites. The markup is still valid and still helps search engines and AI assistants understand the page, but don't expect the drop-downs to appear under your listing.)

---

## 6. Other things that changed

- Prices on the page and in the structured data are **£15 / £20**, the same as the live site.
- The email address shown on the site is now **quotes@thelawnlads.co.uk**. The old hello@ was a placeholder. Change `contactEmail` if you want a different one.
- New page title and description aimed at "lawn mowing Hinckley"-type searches. There's also LocalBusiness structured data listing your six areas, phone, prices and socials.
- Every main button has a `data-cta="…"` label. If you add Google Analytics or Plausible later, you can track which buttons get clicked without touching the design.
- The sticky Call / WhatsApp / Get a Quote bar only shows on phones. It stays out of the way while the top of the page is on screen and while someone is typing in a form.

## 7. What was tested

The page was checked in a headless Chrome browser at phone (390px, 360px, 320px) and desktop (1280px) widths:

- **Postcode checker:** in-area, edge, nearby, far away, invalid and not-found postcodes, and the offline fallback, all against simulated postcodes.io responses.
- **Quote form:** validation messages, photo type/size/count limits, photo shrinking and the exact data sent (fields and attached JPEGs), plus the thank-you message.
- **Rest of the page:** gallery pop-up (opens, closes with Escape), FAQ drop-downs, structured data, the sticky bar's show/hide behaviour, no sideways scrolling, and no script errors.

Two things couldn't be tested from here and need your real test submission: delivery to your real Google account and inbox, and live postcodes.io lookups. The response format was checked against real postcodes.io data for all six towns.

After the split into pages, everything was checked again on all eight pages at phone and desktop sizes:

- **Every page:** no sideways scrolling, one main heading each, the menu highlights the page you're on, every internal link points to a file that exists, and there are no script errors.
- **Across pages:** the phone "Menu" button opens and closes. A postcode checked on the home page carries over to the quote form.
- **Our Work:** the filter buttons and the photo pop-up work with all three jobs.
- **Quote form:** it was switched to the Google Sheet script and checked against a simulated Google Script. That covered the exact data sent (including the photos as real JPEGs), the thank-you message, a clear message when the form isn't connected yet, and what happens if the script returns an error or the connection drops. The script itself was run against simulated Google services. It saves the row, keeps only real image files, blocks spreadsheet-formula tricks, flags outside-area requests in the subject line, ignores honeypot spam, enforces the hourly limit, and still keeps the quote in the Sheet if the email fails.
