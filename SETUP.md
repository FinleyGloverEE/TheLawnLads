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
| `config.js` | **Your settings** (phone, WhatsApp, email, booking link, quote inbox, areas) |
| `site.css`, `site.js` | The look and the behaviour, shared by every page |
| `*.jpg` | The before/after photos |
| `sitemap.xml`, `robots.txt` | Help Google find every page. Submit the sitemap in Google Search Console once the site is live |

The old `before.jpg` and `after.jpg` from the first version aren't used any more. You can delete them from GitHub or leave them.

**Links use `.html` names** (e.g. `services.html`), so they work the same on Vercel, Cloudflare Pages and GitHub Pages without any extra setup. If you're on Cloudflare Pages, it will quietly redirect `/services.html` to `/services`. That's fine.

**The header and footer are copied onto every page.** If you add a page or rename a menu item, change it on all seven pages.

---

## 1. Switch on the quote form (do this once, straight after uploading)

The "Get a Free Quote" form sends each request, photos attached, to **quotes@thelawnlads.co.uk** through FormSubmit (formsubmit.co). It's free, needs no account, and works on Vercel, Cloudflare Pages or GitHub Pages.

1. **Check the inbox works first.** Send a normal email to quotes@thelawnlads.co.uk from your phone and make sure it arrives. If you're using Cloudflare Email Routing or Zoho to forward it, set that up before anything else.
2. **Send yourself a test quote** from the live site. Use your own details and add a photo.
3. FormSubmit will email quotes@ with an **"Activate Form"** button. Click it. Until you do, requests don't get delivered, and the first real customer would see FormSubmit's confirmation page instead of the thank-you message. That's why the test comes first.
4. Send one more test. It should arrive as a table with the photos attached, and you should land back on the site with the thank-you message.
5. **Optional, but recommended:** after activating, FormSubmit gives you a random alias (something like `https://formsubmit.co/8f3a…`). Put it in two places so your email address isn't sitting in the page code for spam bots to find:
   - `quoteFormAction` in `config.js`
   - the `action="…"` on the `<form id="quote-form">` line in `quote.html`

**What each quote email includes:** name, phone, email, postcode, service, lawn size, description, the number of photos, and an `area_check` line. That line tells you whether the postcode is in your area. Examples: `In area (Barwell)`, or `OUTSIDE — 4.1 mi from Hinckley`. Anything outside the area also gets **(OUTSIDE AREA)** in the subject line. Look back over those every so often to see where demand is coming from before you decide where to expand.

**Limits you should know about:**
- Photos get shrunk on the customer's phone before they're sent (to about 1600px, usually 200–600KB each). That keeps uploads quick on mobile data and well under FormSubmit's 10MB total.
- iPhone HEIC photos are turned into JPEGs by the phone automatically.
- Customers **don't** currently get an automatic confirmation email. FormSubmit only sends auto-replies if its "I'm not a robot" page is switched on, and that page adds an extra step after someone has just filled in a long form. If you'd rather have the auto-reply, change `_captcha` to `true` and add `<input type="hidden" name="_autoresponse" value="Thanks — I've got your request and will be in touch shortly. – The Lawn Lads">` inside the form.
- Spam is filtered by a hidden "honeypot" field. If spam starts getting through anyway, switch `_captcha` to `true`.

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
| `quoteFormAction` | Where quote requests go (see section 1) |
| `siteUrl` | Your live address. FormSubmit sends people back to `quote.html` on it after they send a quote |
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
- **Quote form:** validation messages, photo type/size/count limits, photo shrinking and the exact data sent to FormSubmit (fields, subject line and attached JPEGs, checked against a simulated FormSubmit), plus the thank-you message on return.
- **Rest of the page:** gallery pop-up (opens, closes with Escape), FAQ drop-downs, structured data, the sticky bar's show/hide behaviour, no sideways scrolling, and no script errors.

Two things couldn't be tested from here and need your real test submission: the actual FormSubmit delivery to your inbox, and live postcodes.io lookups. The response format was checked against real postcodes.io data for all six towns.

After the split into pages, everything was checked again on all eight pages at phone and desktop sizes:

- **Every page:** no sideways scrolling, one main heading each, the menu highlights the page you're on, every internal link points to a file that exists, and there are no script errors.
- **Across pages:** the phone "Menu" button opens and closes. A postcode checked on the home page carries over to the quote form.
- **Our Work:** the filter buttons and the photo pop-up work with all three jobs.
- **Quote form:** an out-of-area quote with a photo was sent to a simulated FormSubmit, which returned to the thank-you message on `quote.html`.
