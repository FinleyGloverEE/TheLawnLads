# Redesign mockups: making the site look less AI-built

These are homepage mockups only. The folder starts with `_`, so GitHub Pages
never publishes it and the live site is unchanged. Open any `.html` file here
in a browser to see it (the photos come from the site's own job photos). The
mockups load Google Fonts to save time. A real build would self-host the fonts,
the same way `site.css` does now.

## What makes the current site read as AI-built

None of these is a problem on its own. It's having all of them together that
people recognise.

1. **The visual kit.** Cream background, thick black borders on every box, hard
   offset black shadows, cards tilted by half a degree, orange uppercase sticker
   labels, and a highlighter stripe under the headline. This exact combination
   is what AI site builders were producing throughout 2025 and 2026.
2. **The template layout.** A hero with a widget card, then a "Covering:"
   strip, pricing cards with a "Most booked" badge, a gallery, numbered
   `01 02 03 04` steps and a green call-to-action band. That's a software
   landing page with lawn words dropped in.
3. **The copy.** "Real Gardens. Real Results." Every section follows the same
   pattern: a sticker label, a heading and then a grey line underneath. There
   are 26 em dashes across the pages (13 in the FAQ alone). "No call centre"
   comes up twice, and nobody expects a 16-year-old's mowing round to have one.
   "Est. 2026" and "Most booked" read like template filler for a business that
   started this year.
4. **Two voices.** The name is plural ("Lads") and the copy says "Do *we* cover
   your area?" and "*Our* work". It also talks about "a 16-year-old... *he* grew
   up", then switches to "*I* turn up". A real sole trader writes in one voice.
5. **No name and no face.** The site never says who he is. The about page
   **still shows a live placeholder**, "A real photo of the lad at work goes here
   once we've got one." (`about.html`). A commit removed it from the homepage
   but not from that page.
6. **Small tells.** The body font (Atkinson Hyperlegible) draws zeros with a
   slash, so the phone number shows as `Ø7912 61318Ø` and looks like a code.
   Also, the "after" photo for the border job was taken in the dark, so it
   looks worse than the "before".

## The three directions

| | Idea | Why it reads as human | Risk |
|---|---|---|---|
| **A. The leaflet** (`a-leaflet-*.html`) | Looks like the flyer that comes through Hinckley letterboxes. It has huge condensed type, a yellow price starburst, a "small print" box and tear-off phone number tabs you can tap | It borrows from something local and physical, not from a web template | It can tip into gimmicky. The tear-off tabs are the whole joke, so use them once |
| **B. Hi, I'm Finley** (`b-personal-*.html`) | A plain, personal page. It has a serif heading, a photo of him, a menu-style price list, jobs described in plain sentences and real reviews | A voice and a face are the hardest things to fake. It's also the calmest and the easiest to keep up to date | It needs the photo and the reviews. Without them it's just a plain site |
| **C. The job book** (`c-job-book-*.html`) | The site as a dated log of every job, on squared-paper styling with typewriter-style type, a rates card and a postcode table | Being specific (dates, villages, postcodes) is the opposite of generic AI copy | It only works if the log gets updated. A stale "last entry" looks worse than having no log |

**Recommendation: B**, borrowing C's idea of dated, located job entries for
the Our Work page.

## Changes that matter more than any redesign

- Take **one real daylight photo of him working**, and delete the live
  placeholder from `about.html` now.
- Collect **two or three real reviews** with a first name and a village. Get
  them on Google as well: a Google Business Profile with reviews will bring in
  more Hinckley customers than any design change.
- Pick **one voice**: first person ("I"), with his first name. Keep "The Lawn
  Lads" as the brand name only.
- Take before/after photos **from the same spot, in daylight**.
- Cut the em dashes, sticker labels and slogan headings. Write as he'd talk.
- Say **when he actually replies** (the mockups show where, as
  `[When you actually answer]`).

## Placeholders in the mockups

Anything in `[square brackets]` is a missing fact. That covers his photo, the
reviews, job dates and villages, and his reply times. None of these were made
up. The first name "Finley" comes from the GitHub account, so check it's
right, and only use a first name on the site, never a surname.
