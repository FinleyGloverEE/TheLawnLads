/*
 * Browser security tests for the static site, in real Chromium (Playwright).
 * Third parties are never contacted: postcodes.io and Google Apps Script are
 * replaced by local mocks that behave like the real ones.
 *
 *   node _security-tests/site.test.js                 run the checks
 *   node _security-tests/site.test.js --shots DIR     also save screenshots to DIR
 *
 * Needs Playwright (npm i -g playwright). Uses NODE_PATH or the global install.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
let playwright;
try { playwright = require("playwright"); } catch (e) { playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright")); }

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "services.html", "our-work.html", "quote.html", "about.html", "faq.html", "contact.html", "404.html"];
const ENDPOINT_HOST = "script.google.com";
const shotsDir = process.argv.indexOf("--shots") !== -1 ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "\n       " + String(detail).slice(0, 600) : "")); }
}

// Static server that behaves like GitHub Pages for this flat site (404.html for misses).
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory() || /\/(_|\.)/.test(p)) {
        res.writeHead(404, { "Content-Type": TYPES[".html"] }); res.end(fs.readFileSync(path.join(ROOT, "404.html"))); return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const POSTCODES = {
  "LE10 1AA": { latitude: 52.5413, longitude: -1.3733, parish: "Hinckley", bua: "Hinckley", admin_ward: "Hinckley Castle" },
  "LE9 7AA": { latitude: 52.5669, longitude: -1.344, parish: "Barwell", bua: "Barwell", admin_ward: "Barwell" },
  "CV11 4AA": { latitude: 52.52, longitude: -1.46, parish: null, bua: "Nuneaton", admin_ward: "Abbey" }
};

async function setup(context, state) {
  state.requests = []; state.posts = []; state.endpointReply = { ok: true };
  // Only for comparing against the old Google-hosted fonts: GF_DIR holds a saved copy of Google's CSS and font files.
  if (process.env.GF_DIR) {
    await context.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(path.join(process.env.GF_DIR, "gf.css")) }));
    await context.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 200, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" }, body: fs.readFileSync(path.join(process.env.GF_DIR, path.basename(new URL(r.request().url()).pathname))) }));
  }
  context.on("request", (r) => state.requests.push(r.url()));
  await context.route("https://api.postcodes.io/**", (route) => {
    const pc = decodeURIComponent(route.request().url().split("/postcodes/")[1] || "");
    const hit = POSTCODES[pc];
    route.fulfill({ status: hit ? 200 : 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(hit ? { status: 200, result: hit } : { status: 404, error: "Postcode not found" }) });
  });
  // Real Apps Script answers with a 302 to script.googleusercontent.com. Playwright can't intercept
  // redirected requests, so the mock answers directly and the CSP for that second host is checked separately.
  await context.route("https://" + ENDPOINT_HOST + "/**", (route) => {
    const req = route.request();
    if (req.method() === "POST") state.posts.push({ type: req.headers()["content-type"], body: req.postData() });
    if (req.method() === "POST" && /text\/plain/.test(req.headers()["content-type"] || "")) {
      route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(state.endpointReply) });
    } else {
      route.fulfill({ status: 200, contentType: "text/html", body: "<h2>Thanks! We've received your request</h2>" });
    }
  });
  await context.route("https://script.googleusercontent.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(state.endpointReply) }));
}

function watch(page, bucket) {
  page.on("console", (msg) => { if (msg.type() === "error" || /Content Security Policy|Refused to/.test(msg.text())) bucket.push("console: " + msg.text()); });
  page.on("pageerror", (err) => bucket.push("pageerror: " + err.message));
  page.on("dialog", (d) => { bucket.push("DIALOG (script ran!): " + d.message()); d.dismiss(); });
}

async function main() {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await playwright.chromium.launch();
  const state = {};

  console.log("Every page: CSP, script errors, links, layout, fonts");
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true });
    await setup(context, state);
    await context.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
    });
    for (const p of PAGES) {
      const page = await context.newPage();
      const problems = []; watch(page, problems);
      state.requests = [];
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // Scroll through so lazy-loaded photos load, then check every image really loaded (CSP could block them)
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } window.scrollTo(0, 0); });
      await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 10000 }).catch(() => {});
      const badImages = await page.evaluate(() => Array.from(document.images).filter((i) => !i.closest("dialog") && !(i.complete && i.naturalWidth > 0)).map((i) => i.getAttribute("src")));
      check(p + " @" + width + " every image loads (" + (await page.evaluate(() => document.images.length)) + ")", badImages.length === 0, badImages.join(", "));
      const info = await page.evaluate(() => ({
        csp: window.__csp,
        meta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        fonts: (function () {
          const loaded = Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "") + " " + f.weight);
          return ["Atkinson Hyperlegible 400", "Atkinson Hyperlegible 700", "Archivo Black 400"].map((n) => loaded.indexOf(n) !== -1);
        })(),
        loadedFaces: Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight),
        links: Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")),
        blank: Array.from(document.querySelectorAll('a[target="_blank"]')).filter((a) => !/noopener/.test(a.rel)).length
      }));
      const tag = p + " @" + width;
      check(tag + " has CSP", info.meta);
      check(tag + " no CSP violations / script errors", info.csp.length === 0 && problems.length === 0, info.csp.concat(problems).join(" | "));
      check(tag + " no sideways scroll", !info.overflow);
      check(tag + " fonts loaded", info.fonts.every(Boolean), JSON.stringify({ fonts: info.fonts, loaded: info.loadedFaces }));
      check(tag + " target=_blank links have noopener", info.blank === 0);
      const external = state.requests.filter((u) => !u.startsWith(base) && !/^(data|blob):/.test(u));
      check(tag + " no third-party requests on load", external.length === 0, external.join(", "));
      if (width === 390) {
        const internal = [...new Set(info.links.filter((h) => !/^(https?:|mailto:|tel:|#)/.test(h)).map((h) => new URL(h, base + p).pathname))];
        const broken = [];
        for (const pth of internal) { const r = await page.request.get(base.replace(/\/$/, "") + pth); if (r.status() !== 200) broken.push(pth); }
        check(tag + " internal links all work (" + internal.length + ")", broken.length === 0, broken.join(", "));
      }
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, p.replace(".html", "") + "-" + width + ".png"), fullPage: true }); }
      await page.close();
    }
    await context.close();
  }

  console.log("Postcode checker");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await setup(context, state);
    const page = await context.newPage(); const problems = []; watch(page, problems);
    await page.goto(base + "index.html");
    for (const [input, expect] of [["le101aa", /We cover your area/], ["CV11 4AA", /just outside|outside the area/], ["ZZ99 9ZZ", /couldn't find/], ['<img src=x onerror=alert(1)>', /doesn't look like a full UK postcode/]]) {
      await page.fill("#checker-postcode", input);
      await page.click("#checker-form button[type=submit]");
      await page.waitForFunction(() => !document.querySelector("#checker-result .checking"));
      const txt = await page.textContent("#checker-result");
      check("checker: " + input.slice(0, 20) + " -> expected message", expect.test(txt), txt);
    }
    const real = problems.filter((x) => !/status of 404/.test(x));   // the "not found" postcode is a genuine 404
    check("checker: no script ran / no errors", real.length === 0, real.join(" | "));
    await context.close();
  }

  console.log("Quote form");
  const fillValid = async (page) => {
    await page.fill("#q-name", "Sam Taylor");
    await page.fill("#q-phone", "07700 900123");
    await page.fill("#q-email", "sam@example.com");
    await page.fill("#q-postcode", "LE10 1AA");
    await page.selectOption("#q-service", "Hedge trimming");
    await page.check("#size-m", { force: true });
    await page.fill("#q-desc", "Front hedge.");
  };
  const newQuotePage = async (url) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await setup(context, state);
    await context.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
    const page = await context.newPage(); const problems = []; watch(page, problems);
    await page.goto(base + (url || "quote.html"));
    return { context, page, problems };
  };
  {
    const { context, page, problems } = await newQuotePage();
    await fillValid(page);
    await page.setInputFiles("#q-photos-picker", [path.join(ROOT, "border-1-before.jpg"), path.join(ROOT, "icon-512.png")]);
    await page.waitForTimeout(3200);   // a person takes at least this long; the server flags faster submissions
    await page.click("#q-submit");
    await page.waitForSelector("#quote-success:not([hidden])", { timeout: 15000 });
    check("valid quote with photos reaches thank-you message", true);
    const sent = JSON.parse(state.posts[0].body);
    check("sent as text/plain JSON (simple CORS request)", /text\/plain/.test(state.posts[0].type));
    check("both photos re-encoded to JPEG in the browser", sent.photos.length === 2 && sent.photos.every((p) => p.type === "image/jpeg" && Buffer.from(p.data, "base64").slice(0, 3).toString("hex") === "ffd8ff"), JSON.stringify(sent.photos.map((p) => p.type)));
    check("photo metadata (EXIF/GPS) stripped", sent.photos.every((p) => Buffer.from(p.data, "base64").indexOf("Exif") === -1));
    check("fill-time sent for bot check", typeof sent._elapsed === "number" && sent._elapsed > 0, sent._elapsed);
    check("page field is just the page address", sent.page === base + "quote.html", sent.page);
    // End to end: feed exactly what the browser sent into the real Apps Script (with mocked Google services)
    {
      const gas = require("./gas-mock.js");
      const { g, state: gs } = gas.load(path.join(ROOT, "quote-form-google-script.gs"));
      const reply = gas.parse(g.doPost(gas.jsonEvent(Object.assign({}, sent, { page: "https://thelawnlads.co.uk/quote.html" }))));
      check("end to end: Apps Script accepts the browser's real submission", reply.ok === true && gs.rows[1] && gs.rows[1][1] === "New", JSON.stringify(reply) + " " + JSON.stringify(gs.rows[1] && gs.rows[1].slice(1, 9)));
      check("end to end: both photos saved as JPEG and emailed", gs.files.length === 2 && gs.files.every((f) => f.type === "image/jpeg") && gs.mails[0] && gs.mails[0].options.attachments.length === 2);
      check("end to end: area check from the browser kept", gs.rows[1] && gs.rows[1][6] === "In area (Hinckley)", gs.rows[1] && gs.rows[1][6]);
    }
    await page.evaluate(() => fetch("https://script.googleusercontent.com/macros/echo?user_content_key=test").then((r) => r.json()));
    const csp = await page.evaluate(() => window.__csp);
    check("quote submit and Apps Script's googleusercontent.com hop pass CSP", csp.length === 0 && problems.length === 0, csp.concat(problems).join(" | "));
    await context.close();
  }
  {
    const { context, page, problems } = await newQuotePage();
    const fake = path.join(require("os").tmpdir(), "not-a-photo.jpg");
    fs.writeFileSync(fake, "MZ this is not an image");
    await page.setInputFiles("#q-photos-picker", [fake]);
    await page.waitForFunction(() => /read/.test(document.querySelector("#q-photos-err").textContent), null, { timeout: 5000 }).catch(() => {});
    const err = await page.textContent("#q-photos-err");
    const thumbs = await page.$$eval("#q-thumbs .thumb", (t) => t.length);
    check("fake .jpg rejected in the browser with a clear message", /couldn't be read as a photo/.test(err) && thumbs === 0, err + " thumbs=" + thumbs);
    await page.setInputFiles("#q-photos-picker", [path.join(ROOT, "site.css")]);
    check("non-image file type rejected", /isn't a JPG, PNG or WEBP/.test(await page.textContent("#q-photos-err")));
    check("no errors", problems.length === 0, problems.join(" | "));
    await context.close();
  }
  {
    const { context, page, problems } = await newQuotePage();
    await fillValid(page);
    await page.fill("#q-name", '<img src=x onerror=alert("xss")>');
    await page.click("#q-submit");
    check("HTML in name blocked by browser validation", /Please add your name without/.test(await page.textContent("#q-name-err")) && state.posts.length === 0, await page.textContent("#q-name-err"));
    await page.fill("#q-name", "Sam Taylor");
    await page.fill("#q-email", "a@b.com, c@d.com");
    await page.click("#q-submit");
    check("two email addresses blocked", /doesn't look quite right/.test(await page.textContent("#q-email-err")));
    check("no script ran", problems.length === 0, problems.join(" | "));
    await context.close();
  }
  {
    const { context, page, problems } = await newQuotePage();
    state.endpointReply = { ok: false, error: '<img src=x onerror=alert("xss")>Bad' };
    await fillValid(page);
    await page.click("#q-submit");
    await page.waitForFunction(() => document.querySelector("#q-status").textContent.length > 0);
    const html = await page.innerHTML("#q-status");
    check("server error text shown as text, not HTML", html.indexOf("&lt;img") !== -1 && html.indexOf("<img") === -1, html);
    check("no script ran", problems.length === 0, problems.join(" | "));
    await context.close();
  }
  {
    const { context, page, problems } = await newQuotePage('quote.html?postcode=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
    await page.waitForTimeout(300);
    check("script in ?postcode= URL is inert", problems.length === 0 && (await page.inputValue("#q-postcode")).indexOf("<script>") !== -1, problems.join(" | "));
    await context.close();
  }
  // ---- Bot check (Cloudflare Turnstile) switched on in config.js ----
  // Fake loader following Cloudflare's client API (render / reset, callback with a token), which
  // adds a real cross-origin iframe so the quote page's CSP is exercised the way the widget would.
  const FAKE_TURNSTILE = `(function () {
    var n = 0; window.__ts = { renders: [], resets: 0 };
    window.turnstile = {
      render: function (el, o) {
        window.__ts.renders.push({ sitekey: o.sitekey, action: o.action, appearance: o.appearance });
        var f = document.createElement("iframe");
        f.src = "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/fake"; f.width = 300; f.height = 65; f.style.border = "0";
        el.appendChild(f);
        window.__ts.issue = function () { setTimeout(function () { o.callback("GOOD-" + (++n) + "-token-xxxxxxxx"); }, 300); };
        window.__ts.issue();
        return "w1";
      },
      reset: function () { window.__ts.resets++; window.__ts.issue(); },
      getResponse: function () { return ""; }
    };
  })();`;
  const withBotCheck = async (url, how) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    await setup(context, state);
    await context.route(base + "config.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript",
      body: fs.readFileSync(path.join(ROOT, "config.js"), "utf8").replace('turnstileSiteKey: ""', 'turnstileSiteKey: "0x4AAAAAAATESTSITEKEY"') }));
    const cf = [];
    await context.route("https://challenges.cloudflare.com/**", (r) => {
      cf.push(r.request().url());
      if (how === "blocked") return r.abort();
      if (/api\.js/.test(r.request().url())) return r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_TURNSTILE });
      return r.fulfill({ status: 200, contentType: "text/html", body: "<p>widget</p>" });
    });
    await context.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
    const page = await context.newPage(); const problems = []; watch(page, problems);
    await page.goto(base + url);
    return { context, page, problems, cf };
  };

  const botRendered = (page) => page.waitForFunction(() => window.__ts && window.__ts.renders.length === 1, null, { timeout: 8000 }).then(() => true, () => false);

  console.log("Bot check (Cloudflare Turnstile) switched on");
  {
    const { context, page, problems, cf } = await withBotCheck("quote.html");
    const shown = await botRendered(page);
    const r = shown ? await page.evaluate(() => window.__ts.renders[0]) : {};
    check("widget loads on the quote page with the site key, action 'quote', invisible mode", shown && r.sitekey === "0x4AAAAAAATESTSITEKEY" && r.action === "quote" && r.appearance === "interaction-only",
      shown ? JSON.stringify(r) : "never rendered. CSP: " + (await page.evaluate(() => window.__csp)).join(", "));
    check("loader requested with explicit rendering", cf.some((u) => u === "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"), cf.join(", "));
    check("privacy note about Turnstile shown", await page.isVisible("[data-bot-note]"));
    state.posts = [];
    await fillValid(page);
    await page.waitForTimeout(3200);
    await page.click("#q-submit");
    await page.waitForSelector("#quote-success:not([hidden])", { timeout: 15000 });
    const sent = JSON.parse(state.posts[0].body);
    check("token sent with the quote", /^GOOD-1-/.test(sent._turnstile), sent._turnstile);
    check("token thrown away after use", (await page.evaluate(() => window.__ts && window.__ts.resets)) === 1);
    const csp = await page.evaluate(() => window.__csp);
    check("Turnstile script and iframe allowed by the quote page's CSP, no errors", csp.length === 0 && problems.length === 0, csp.concat(problems).join(" | "));
    {
      const gas = require("./gas-mock.js");
      const { g, state: gs } = gas.load(path.join(ROOT, "quote-form-google-script.gs"));
      gs.props.set("TURNSTILE_SECRET", "secret"); gs.props.set("TURNSTILE_ENFORCE", "yes");
      gs.fetch = (u, o) => ({ code: 200, body: JSON.stringify(/^GOOD-/.test(o.payload.response) ? { success: true, hostname: "thelawnlads.co.uk", action: "quote" } : { success: false, "error-codes": ["invalid-input-response"] }) });
      const reply = gas.parse(g.doPost(gas.jsonEvent(Object.assign({}, sent, { page: "https://thelawnlads.co.uk/quote.html" }))));
      check("end to end: enforced script accepts the browser's real submission and token", reply.ok === true && gs.rows[1] && gs.rows[1][1] === "New" && gs.fetches.length === 1, JSON.stringify(reply));
    }
    await context.close();
  }
  {
    const { context, page, problems } = await withBotCheck("quote.html");
    await botRendered(page);
    state.posts = []; state.endpointReply = { ok: false, error: "We couldn't confirm you're not a robot. Please press Send again.", code: "robot" };
    await fillValid(page);
    await page.click("#q-submit");
    await page.waitForFunction(() => document.querySelector("#q-status").textContent.length > 0);
    const msg = await page.textContent("#q-status");
    check("robot rejection: asks to press Send again, WhatsApp/phone as backup", /press Send again/.test(msg) && /If it keeps happening/.test(msg), msg);
    state.endpointReply = { ok: true };
    await page.waitForTimeout(500);
    await page.click("#q-submit");
    await page.waitForSelector("#quote-success:not([hidden])", { timeout: 15000 });
    const tokens = state.posts.map((x) => JSON.parse(x.body)._turnstile);
    check("retry sends a fresh token, not the used one", tokens.length === 2 && tokens[0] !== tokens[1] && /^GOOD-2-/.test(tokens[1]), tokens.join(" / "));
    check("no errors", problems.length === 0, problems.join(" | "));
    await context.close();
  }
  {
    const { context, page, problems } = await withBotCheck("quote.html", "blocked");
    state.posts = [];
    await fillValid(page);
    await page.click("#q-submit");
    await page.waitForSelector("#quote-success:not([hidden])", { timeout: 15000 });
    const sent = JSON.parse(state.posts[0].body);
    const real = problems.filter((x) => !/Failed to load resource/.test(x));
    check("Cloudflare can't load: form still sends (empty token), the script decides", sent._turnstile === "" && real.length === 0, JSON.stringify(sent._turnstile) + " " + real.join(" | "));
    await context.close();
  }
  {
    const { context, page, cf } = await withBotCheck("index.html");
    await page.waitForTimeout(500);
    check("other pages never load Turnstile", cf.length === 0, cf.join(", "));
    await context.close();
  }
  {
    const { context, page } = await newQuotePage();
    state.posts = [];
    await fillValid(page); await page.click("#q-submit");
    await page.waitForSelector("#quote-success:not([hidden])", { timeout: 15000 });
    check("site key empty (default): no token field sent, note stays hidden", !("_turnstile" in JSON.parse(state.posts[0].body)) && !(await page.isVisible("[data-bot-note]")));
    await context.close();
  }

  {
    // Visitor with JavaScript switched off: the plain HTML form must still post (CSP form-action).
    const context = await browser.newContext({ javaScriptEnabled: false });
    await setup(context, state);
    const page = await context.newPage();
    await page.goto(base + "quote.html");
    await page.fill("#q-name", "Jo Bloggs"); await page.fill("#q-phone", "01455 123456"); await page.fill("#q-email", "jo@example.com");
    await page.fill("#q-postcode", "LE10 1AA"); await page.selectOption("#q-service", "Hedge trimming");
    await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.click("#q-submit")]);
    check("JavaScript off: form still posts to Apps Script", /script\.google\.com/.test(page.url()) && state.posts.some((p) => /urlencoded/.test(p.type || "")), page.url());
    await context.close();
  }

  await browser.close();
  srv.close();
  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
