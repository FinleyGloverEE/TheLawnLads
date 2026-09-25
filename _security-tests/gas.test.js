/*
 * Runs quote-form-google-script.gs against mocked Google services and checks
 * the security behaviour. Run from the repo root:  node _security-tests/gas.test.js
 */
"use strict";
const path = require("path");
const m = require("./gas-mock.js");
const SCRIPT = path.join(__dirname, "..", "quote-form-google-script.gs");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else { failed++; console.log("  FAIL " + name + (detail ? "\n       " + detail : "")); }
}
function fresh(opts) { return m.load(SCRIPT, opts); }
function post(g, ev) { return m.parse(g.doPost(ev)); }
const b64 = (buf) => buf.toString("base64");
const photo = (buf, type) => ({ name: "garden.jpg", type: type || "image/jpeg", data: b64(buf) });

console.log("Normal use");
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ photos: [photo(m.JPEG), photo(m.PNG, "image/png"), photo(m.WEBP, "image/webp")] })));
  check("valid quote with 3 real photos is accepted", r.ok === true, JSON.stringify(r));
  check("row saved with status New", state.rows.length === 2 && state.rows[1][1] === "New", JSON.stringify(state.rows[1]));
  check("3 photos saved with detected types", state.files.map((f) => f.type).join() === "image/jpeg,image/png,image/webp", JSON.stringify(state.files));
  check("one email sent to the fixed address", state.mails.length === 1 && state.mails[0].to === "admin@thelawnlads.co.uk");
  check("email has 3 attachments", state.mails[0].options.attachments.length === 3);
  check("reply-to is the customer's address", state.mails[0].options.replyTo === "sam@example.com");
  check("phone stored as text (leading 0 kept)", state.rows[1][3] === "'07700 900123");
}
{
  const { g, state } = fresh();
  const r = post(g, m.formEvent({ name: "Jo Bloggs", phone: "01455 123456", email: "jo@example.co.uk", postcode: "le101aa", service: "Hedge trimming", description: "Hedge", _honey: "" }));
  check("no-JavaScript form post accepted (HTML reply)", r.html && /Thanks/.test(r.html), JSON.stringify(r));
  check("no-JS: postcode normalised, missing size = Not given", state.rows[1][5] === "LE10 1AA" && state.rows[1][8] === "Not given", JSON.stringify(state.rows[1]));
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ name: "Zoë O'Brien-Nuñez", phone: "+44 7700 900123", description: "Line one\nLine two" })));
  check("accented names, +44 phones and multi-line descriptions allowed", state.rows.length === 2 && state.rows[1][2] === "Zoë O'Brien-Nuñez" && state.rows[1][9] === "Line one\nLine two", JSON.stringify(state.rows[1]));
}

console.log("Server-side validation");
for (const [label, extra, field] of [
  ["missing name", { name: "" }, "name"],
  ["HTML in name", { name: "<img src=x onerror=alert(1)>" }, "name"],
  ["link in name", { name: "Visit www.spam.example" }, "name"],
  ["bad phone", { phone: "call me maybe" }, "phone number"],
  ["bad email", { email: "not-an-email" }, "email"],
  ["email with extra recipient", { email: "a@b.com, c@d.com" }, "email"],
  ["email with header break", { email: "a@b.com\r\nBcc: c@d.com" }, "email"],
  ["bad postcode", { postcode: "<svg onload=1>" }, "postcode"],
  ["missing service", { service: "" }, "what you need"]
]) {
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote(extra)));
  check("rejects " + label, r.ok === false && r.error.indexOf(field) !== -1 && state.rows.length === 0 && state.mails.length === 0, JSON.stringify(r));
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ name: "A".repeat(5000), description: "x".repeat(100000) })));
  check("oversized fields are truncated (name 80, description 1500)", state.rows[1][2].length === 80 && state.rows[1][9].length === 1500);
}
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ service: "Mow\r\nBcc: victim@example.com", lawn_size: "<b>huge</b>", area_check: "In area (Hinckley)\r\nX: y" })));
  const mail = state.mails[0] || {};
  check("CR/LF can't reach the email subject", r.ok && !/[\r\n]/.test(mail.subject) && /Quote request: Other/.test(mail.subject), JSON.stringify(mail.subject));
  check("unlisted service kept as 'Other: …' on one line", /^Other: Mow Bcc/.test(state.rows[1][7]), state.rows[1][7]);
  check("tampered area check replaced with 'Not checked'", state.rows[1][6] === "Not checked", state.rows[1][6]);
  check("HTML in fields is escaped in the email", /&lt;b&gt;huge&lt;\/b&gt;/.test(mail.options.htmlBody) && !/<b>huge/.test(mail.options.htmlBody));
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ description: "<script>alert(1)</script>\u202Egnp.exe" })));
  const html = state.mails[0].options.htmlBody;
  check("script tags in description escaped in email", html.indexOf("<script>") === -1 && html.indexOf("&lt;script&gt;") !== -1);
  check("right-to-left override characters removed", state.rows[1][9].indexOf("\u202E") === -1);
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ name: "=HYPERLINK(\"http://x\",\"y\")".replace("http://", "h") , description: "+cmd|' /C calc'!A0" })));
  check("spreadsheet formulas neutralised", state.rows[1][2].startsWith("'=") && state.rows[1][9].startsWith("'+"), JSON.stringify([state.rows[1][2], state.rows[1][9]]));
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ page: "javascript:alert(1)" })));
  check("page field only accepts the site's own URLs", state.rows[1][11] === "");
}

console.log("Malformed requests (no stack traces, generic errors)");
for (const [label, ev] of [["JSON null", m.rawEvent("null")], ["JSON array", m.rawEvent("[1,2]")], ["broken JSON", m.rawEvent("{\"name\":")], ["no event", undefined]]) {
  const { g } = fresh();
  let r; try { r = m.parse(g.doPost(ev)); } catch (e) { r = { threw: String(e) }; }
  const text = JSON.stringify(r);
  const generic = r.ok === false || (r.html && /Something went wrong on our side/.test(r.html));
  check(label + " -> generic error", generic && !/at |\.gs|Error:|line \d/.test(text), text);
}
{
  const { g, state } = fresh();
  const ev = m.jsonEvent(m.validQuote()); ev.postData.length = 30 * 1024 * 1024;
  const r = post(g, ev);
  check("request over 22MB rejected before parsing", r.ok === false && state.rows.length === 0, JSON.stringify(r));
}
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ photos: { length: 5 } })));
  check("photos not an array: quote still saved, no photos", r.ok === true && state.files.length === 0 && /could not read/.test(state.rows[1][10]), JSON.stringify(r));
}

console.log("Upload security");
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ photos: [photo(m.EXE), photo(m.HTMLFILE, "image/png"), { type: "image/jpeg", data: "!!!not base64!!!" }] })));
  check("executable / HTML / garbage 'photos' are not saved", r.ok && state.files.length === 0, JSON.stringify(state.files));
  check("owner is told files were rejected", /3 file\(s\) were not JPG, PNG or WEBP/.test(state.rows[1][10]), state.rows[1][10]);
  check("rejected files not attached to email", state.mails[0].options.attachments.length === 0);
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ name: "../../etc/passwd", photos: [{ name: "../../evil.php", type: "application/x-php", data: b64(m.JPEG) }] })));
  const f = state.files[0];
  check("stored name ignores visitor's filename and name", f && /^2026-09-25 \d{4} LE10 1AA [0-9a-f]{8} \(1\)\.jpg$/.test(f.name), f && f.name);
  check("stored type comes from file bytes, not browser", f && f.type === "image/jpeg");
}
{
  const { g, state } = fresh();
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]);
  post(g, m.jsonEvent(m.validQuote({ photos: [photo(big)] })));
  check("photo over 5MB not saved", state.files.length === 0 && state.rows.length === 2);
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ photos: [1, 2, 3, 4, 5].map(() => photo(m.JPEG)) })));
  check("only the first 3 photos kept", state.files.length === 3 && /Only the first 3/.test(state.rows[1][10]));
}
{
  const { g, state } = fresh();
  const pic = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4.5 * 1024 * 1024)]);
  let n = 0;
  for (let i = 0; i < 12; i++) post(g, m.jsonEvent(m.validQuote({ email: "p" + i + "@example.com", phone: "0770090" + String(1000 + i), photos: [photo(pic), photo(pic), photo(pic)] })));
  const mb = state.files.reduce((s, f) => s + f.size, 0) / 1048576;
  check("daily photo budget caps Drive growth at 100MB", mb <= 100 && mb > 80, mb.toFixed(1) + "MB");
  check("quotes still saved once photo budget used up", state.rows.length === 13);
  const alerts = state.mails.filter((x) => /daily photo limit/.test(x.subject));
  check("owner warned once about the photo limit", alerts.length === 1, state.mails.map((x) => x.subject).join(" | "));
}

console.log("Spam and abuse");
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ _honey: "http://spam" })));
  check("honeypot: pretends success, stores nothing", r.ok && state.rows.length === 0 && state.mails.length === 0);
}
{
  const { g, state } = fresh();
  const r = post(g, m.jsonEvent(m.validQuote({ _elapsed: 800, photos: [photo(m.JPEG)] })));
  check("filled in under 3s: saved as possible spam, no photos or email", r.ok && /possible spam/.test(state.rows[1][1]) && state.files.length === 0 && state.mails.length === 0, JSON.stringify(state.rows[1]));
}
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ description: "http://a.example http://b.example www.c.example cheap pills" })));
  check("link-stuffed description flagged, not emailed", /possible spam/.test(state.rows[1][1]) && state.mails.length === 0);
}
{
  const { g, state } = fresh();
  for (let i = 0; i < 30; i++) post(g, m.jsonEvent({ name: "" }));
  const r = post(g, m.jsonEvent(m.validQuote()));
  check("invalid junk no longer uses up the hourly limit", r.ok === true && state.rows.length === 2, JSON.stringify(r));
}
{
  const { g, state } = fresh();
  const replies = [];
  for (let i = 0; i < 5; i++) replies.push(post(g, m.jsonEvent(m.validQuote())));
  check("same person limited to 3 per hour", replies.filter((r) => r.ok).length === 3 && replies[4].ok === false && /already had a few/.test(replies[4].error), JSON.stringify(replies[4]));
  const other = post(g, m.jsonEvent(m.validQuote({ email: "other@example.com", phone: "07700 900999" })));
  check("a different customer still gets through", other.ok === true);
  const samePhone = post(g, m.jsonEvent(m.validQuote({ email: "new@example.com", phone: "+447700900123" })));
  check("same phone in a different format is still the same person", samePhone.ok === false);
}
{
  const { g, state } = fresh();
  let ok = 0;
  for (let i = 0; i < 35; i++) if (post(g, m.jsonEvent(m.validQuote({ email: "u" + i + "@example.com", phone: "0770090" + String(2000 + i) }))).ok) ok++;
  check("global hourly limit still applies (30)", ok === 30, String(ok));
  check("owner warned once when hourly limit hit", state.mails.filter((x) => /hourly limit/.test(x.subject)).length === 1);
  check("customer counters are hashed, not stored as emails", [...state.cache.keys()].every((k) => k.indexOf("@") === -1 && k.indexOf("07700") === -1));
}
{
  const { g, state } = fresh({ mailQuota: 6 });
  post(g, m.jsonEvent(m.validQuote({ email: "q1@example.com", phone: "07700 900001" })));
  const r = post(g, m.jsonEvent(m.validQuote({ email: "q2@example.com", phone: "07700 900002" })));
  check("email quota low: quote kept in Sheet, customer still told OK", r.ok && state.rows.length === 3 && /not emailed/.test(state.rows[2][1]), JSON.stringify(state.rows[2]));
  check("owner warned using the reserved emails", state.mails.some((x) => /email limit/.test(x.subject)));
}
{
  const { g, state } = fresh();
  g.MailApp.sendEmail = () => { throw new Error("mail down"); };
  const r = post(g, m.jsonEvent(m.validQuote()));
  check("email failure: quote kept and flagged, customer told OK", r.ok && state.rows[1][1] === "New (email failed)");
}

console.log("Logging");
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ name: "Secret Person", email: "secret@example.com", phone: "07700 900555" })));
  post(g, m.jsonEvent(m.validQuote({ email: "bad" })));
  post(g, m.rawEvent("{bad json"));
  const all = state.logs.map((l) => l[1]).join("\n");
  check("logs contain no names, emails or phone numbers", !/Secret|secret@|900555|LE10/.test(all), all);
  check("logs record what happened", /accepted/.test(all) && /invalid email/.test(all) && /unreadable/.test(all), all);
}

/* ---------- H2: bot check (Cloudflare Turnstile), verified by the script ---------- */
// Fake Cloudflare siteverify, following https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
function cloudflare(state, how) {
  state.fetch = (url, o) => {
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      if (how === "down") return { code: 503, body: "unavailable" };
      if (how === "throw") throw new Error("DNS error");
      const { secret, response } = o.payload;
      if (secret === "BADSECRET") return { code: 200, body: JSON.stringify({ success: false, "error-codes": ["invalid-input-secret"] }) };
      const ok = /^(GOOD|OTHERSITE|OTHERACTION)-/.test(response);
      return { code: 200, body: JSON.stringify(ok
        ? { success: true, hostname: response.startsWith("OTHERSITE") ? "evil.example" : "thelawnlads.co.uk", action: response.startsWith("OTHERACTION") ? "login" : "quote", "error-codes": [] }
        : { success: false, "error-codes": ["invalid-input-response"] }) };
    }
    throw new Error("unexpected fetch " + url);
  };
}
function botMode(state, mode, secret) {
  state.props.set("TURNSTILE_SECRET", secret || "0x4AAAAAAA-test-secret");
  if (mode === "enforce") state.props.set("TURNSTILE_ENFORCE", "yes");
}
const person = (i) => ({ email: "p" + i + "@example.com", phone: "0770090" + String(3000 + i) });
const tok = () => "GOOD-" + Math.random().toString(36).slice(2).padEnd(12, "x");

console.log("Bot check: off / test mode / enforced");
{
  const { g, state } = fresh();
  post(g, m.jsonEvent(m.validQuote({ _turnstile: tok() })));
  check("off by default: no Cloudflare calls, works as before", state.fetches.length === 0 && state.rows.length === 2 && state.mails.length === 1);
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "test");
  const a = post(g, m.jsonEvent(m.validQuote(Object.assign(person(1), { _turnstile: tok() }))));
  const b = post(g, m.jsonEvent(m.validQuote(person(2))));
  check("test mode never blocks (good token and no token both accepted)", a.ok && b.ok && state.rows.length === 3);
  check("test mode reports the result in the email", /Bot check \(test mode\)<\/td><td[^>]*>passed/.test(state.mails[0].options.htmlBody) && /fail \(no token\)/.test(state.mails[1].options.htmlBody));
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce");
  const good = post(g, m.jsonEvent(m.validQuote(Object.assign(person(1), { _turnstile: tok() }))));
  check("enforced: valid token accepted", good.ok && state.rows.length === 2 && state.mails.length === 1);
  const sent = state.fetches[0].options;
  check("secret sent to Cloudflare only, by POST, no redirects", state.fetches[0].url === "https://challenges.cloudflare.com/turnstile/v0/siteverify" && sent.method === "post" && sent.followRedirects === false);
  for (const [label, t] of [["missing token", undefined], ["made-up token", "FAKE-abcdefghijkl"], ["token from another website", "OTHERSITE-abcdefghij"], ["token for another form", "OTHERACTION-abcdefg"], ["absurdly long token", "GOOD-" + "x".repeat(5000)]]) {
    const before = state.rows.length;
    const r = post(g, m.jsonEvent(m.validQuote(Object.assign(person(10 + label.length), { _turnstile: t }))));
    check("enforced: " + label + " rejected, nothing saved", r.ok === false && r.code === "robot" && state.rows.length === before, JSON.stringify(r));
  }
  check("missing / oversized tokens never cost a Cloudflare call", state.fetches.length === 4, String(state.fetches.length));
  const html = m.parse(g.doPost(m.formEvent({ name: "Jo Bloggs", phone: "01455 123456", email: "jo@example.com", postcode: "LE10 1AA", service: "Hedge trimming", _honey: "" })));
  check("enforced: JavaScript-off visitors told to switch it on or WhatsApp/call", html.html && /needs JavaScript/.test(html.html));
}

console.log("Bot check: forgiving settings");
for (const [value, want] of [["yes", "enforce"], ["Yes", "enforce"], [" YES ", "enforce"], ["true", "enforce"], ["no", "test"], ["", "test"]]) {
  const { g, state } = fresh(); cloudflare(state); botMode(state, "test");
  state.props.set("TURNSTILE_ENFORCE", value);
  const r = post(g, m.jsonEvent(m.validQuote({ _turnstile: undefined })));
  const got = r.ok === false && r.code === "robot" ? "enforce" : "test";
  check('TURNSTILE_ENFORCE = "' + value + '" -> ' + want, got === want, got);
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce", "  0x4AAAAAAA-test-secret \n");
  post(g, m.jsonEvent(m.validQuote({ _turnstile: tok() })));
  check("secret pasted with spaces/newline is trimmed before sending", state.fetches[0].options.payload.secret === "0x4AAAAAAA-test-secret");
}
{
  const { g, state } = fresh(); botMode(state, "test"); state.props.set("TURNSTILE_ENFORCE", "yess");
  g.testSetup();
  check("testSetup email explains an unrecognised TURNSTILE_ENFORCE value", /TEST MODE.*TURNSTILE_ENFORCE is set to "yess"/.test(state.mails[0].body), state.mails[0].body);
}

console.log("Bot check: the review's lockout attack (H2)");
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce");
  for (let i = 0; i < 30; i++) post(g, m.jsonEvent(m.validQuote(Object.assign(person(100 + i), { _turnstile: "FAKE-" + i + "-xxxxxxxx" }))));
  for (let i = 0; i < 30; i++) post(g, m.jsonEvent(m.validQuote(person(200 + i))));
  const r = post(g, m.jsonEvent(m.validQuote(Object.assign(person(1), { _turnstile: tok() }))));
  check("60 scripted requests without a real token: real customer still gets through", r.ok && state.rows.length === 2 && state.mails.length === 1, JSON.stringify(r));
  check("scripted requests saved nothing and sent no email", state.rows.length === 2 && state.mails.length === 1);
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce");
  for (let i = 0; i < 600; i++) post(g, m.jsonEvent(m.validQuote(Object.assign(person(1000 + i), { _turnstile: "FAKE-" + i + "-xxxxxxxx" }))));
  check("Cloudflare calls capped at 600 an hour (protects Google's 20,000/day allowance)", state.fetches.length === 600);
  const real = post(g, m.jsonEvent(m.validQuote(Object.assign(person(1), { _turnstile: tok() }))));
  const row = state.rows[state.rows.length - 1];
  check("once the cap is used, a real quote is still kept (no photos, no email)", real.ok && row[1] === "Check: bot check unavailable" && state.fetches.length === 600, JSON.stringify(row && row.slice(1, 3)));
  for (let i = 0; i < 25; i++) post(g, m.jsonEvent(m.validQuote(Object.assign(person(5000 + i), { _turnstile: "FAKE-" + i + "-yyyyyyyy" }))));
  check("unchecked quotes limited to 20 an hour", state.rows.filter((x) => x[1] === "Check: bot check unavailable").length === 20);
  check("owner warned once", state.mails.filter((x) => /bot check isn't working/.test(x.subject)).length === 1);
}
for (const how of ["down", "throw"]) {
  const { g, state } = fresh(); cloudflare(state, how); botMode(state, "enforce");
  const r = post(g, m.jsonEvent(m.validQuote({ _turnstile: tok(), photos: [{ type: "image/jpeg", data: m.JPEG.toString("base64") }] })));
  check("Cloudflare " + (how === "down" ? "error" : "unreachable") + ": quote kept, no photos, owner warned", r.ok && state.rows[1][1] === "Check: bot check unavailable" && state.files.length === 0 && state.mails.length === 1 && /bot check isn't working/.test(state.mails[0].subject));
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce", "BADSECRET");
  const r = post(g, m.jsonEvent(m.validQuote({ _turnstile: tok() })));
  check("wrong secret pasted: customers not blamed, owner told the secret looks wrong", r.ok && state.rows[1][1] === "Check: bot check unavailable" && /TURNSTILE_SECRET/.test(state.mails[0].body));
}
{
  const { g, state } = fresh(); cloudflare(state); botMode(state, "enforce");
  for (let i = 0; i < 5; i++) post(g, m.jsonEvent(m.validQuote({ _turnstile: tok() })));
  check("repeat sender stopped before a Cloudflare call (3 checks for 5 requests)", state.fetches.length === 3 && state.rows.length === 4, String(state.fetches.length));
}
{
  const { g } = fresh();
  const rs = ["victim+1@gmail.com", "vic.tim+2@gmail.com", "VICTIM@googlemail.com", "v.i.c.t.i.m+4@gmail.com"].map((e, i) => post(g, m.jsonEvent(m.validQuote({ email: e, phone: "07700 91" + (1000 + i) }))).ok);
  check("Gmail +aliases and dots count as one person", rs.join() === "true,true,true,false", rs.join());
}

/* ---------- H3: site monitor ---------- */
function fakeSite(state, edit) {
  const fs = require("fs");
  const files = {};
  for (const f of ["index.html", "services.html", "our-work.html", "quote.html", "about.html", "faq.html", "contact.html", "config.js", "site.js"]) files[f] = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  if (edit) edit(files);
  state.fetch = (url, o) => {
    if (!url.startsWith("https://thelawnlads.co.uk/")) throw new Error("monitor fetched an unexpected address: " + url);
    const f = url.slice("https://thelawnlads.co.uk/".length) || "index.html";
    if (state.siteDown) throw new Error("timeout");
    return files[f] != null ? { code: 200, body: files[f] } : { code: 404, body: "" };
  };
}
function monitorAfter(edit) {
  const { g, state } = fresh();
  fakeSite(state);
  g.setUpSiteMonitor();
  fakeSite(state, edit);
  g.checkSite();
  return { g, state, alerts: state.mails.filter((x) => /WEBSITE HAS CHANGED/.test(x.subject)) };
}

console.log("Site monitor (H3)");
{
  const { g, state } = fresh(); fakeSite(state);
  g.setUpSiteMonitor(); g.setUpSiteMonitor();
  check("set-up creates exactly one hourly check", state.triggers.length === 1 && state.triggers[0].fn === "checkSite" && state.triggers[0].hours === 1);
  check("approval lists the contact details for the owner to check", state.logs.some((l) => /WhatsApp number: 447912613180/.test(l[1]) && /Where quote requests are sent: https:\/\/script\.google\.com/.test(l[1])));
  g.checkSite();
  check("unchanged site: no email", state.mails.length === 0);
  check("only ever fetches the site's own pages", state.fetches.every((f) => f.url.startsWith("https://thelawnlads.co.uk/")) && state.fetches.length === 27, String(state.fetches.length));
}
{
  const { alerts } = monitorAfter((f) => { f["services.html"] = f["services.html"].replace(/£15/g, "£16"); f["about.html"] = f["about.html"].replace("neighbours", "neighbours and friends"); });
  check("price and wording changes don't set it off", alerts.length === 0);
}
{
  const { alerts } = monitorAfter((f) => { f["config.js"] = f["config.js"].replace('whatsappNumber: "447912613180"', 'whatsappNumber: "447000000001"'); });
  check("changed WhatsApp number: alert says what changed", alerts.length === 1 && /WhatsApp number changed from "447912613180" to "447000000001"/.test(alerts[0].body) && /config\.js has been changed/.test(alerts[0].body), alerts[0] && alerts[0].body);
}
{
  const { alerts } = monitorAfter((f) => { f["quote.html"] = f["quote.html"].replace(/action="https:\/\/script\.google\.com\/macros\/s\/[^"]+"/, 'action="https://script.google.com/macros/s/ATTACKER/exec"'); });
  check("quote form pointed somewhere else: alert names the new address", alerts.length === 1 && /New link or address: https:\/\/script\.google\.com\/macros\/s\/ATTACKER\/exec/.test(alerts[0].body));
}
{
  const { alerts } = monitorAfter((f) => { f["index.html"] = f["index.html"].replace("script-src 'self'", "script-src 'self' https://cdn.evil.example").replace("</body>", '<script src="https://cdn.evil.example/x.js"></script></body>'); });
  check("new outside script + loosened security policy: both reported", alerts.length === 1 && /New link or address: https:\/\/cdn\.evil\.example\/x\.js/.test(alerts[0].body) && /security policy/.test(alerts[0].body));
}
{
  const { alerts } = monitorAfter((f) => { f["contact.html"] = f["contact.html"].replace("</main>", "<script>document.forms[0]</script></main>"); });
  check("script written straight into a page: reported", alerts.length === 1 && /written directly into a page/.test(alerts[0].body));
}
{
  const { alerts } = monitorAfter((f) => { f["site.js"] = f["site.js"] + "\n// tampered"; });
  check("site.js changed: reported", alerts.length === 1 && /site\.js has been changed/.test(alerts[0].body));
}
{
  const { g, state } = monitorAfter((f) => { f["config.js"] = f["config.js"].replace("07912 613180", "07000 000000"); });
  g.checkSite(); g.checkSite();
  check("same change alerts once a day, not every hour", state.mails.filter((x) => /WEBSITE HAS CHANGED/.test(x.subject)).length === 1);
  g.approveCurrentSite(); g.checkSite();
  check("after the owner approves, it goes quiet", state.mails.filter((x) => /WEBSITE HAS CHANGED/.test(x.subject)).length === 1);
}
{
  const { g, state } = fresh(); fakeSite(state); g.setUpSiteMonitor();
  state.siteDown = true;
  g.checkSite(); g.checkSite();
  check("one or two failed checks: no email", state.mails.length === 0);
  g.checkSite();
  check("three failed checks in a row: owner told", state.mails.length === 1 && /keeps failing/.test(state.mails[0].subject));
  state.siteDown = false; g.checkSite();
  check("site back: counter resets, no false change alert", state.props.get("SITE_CHECK_FAILS") == null && state.mails.length === 1);
}
{
  const { g, state } = fresh(); fakeSite(state, (f) => { delete f["site.js"]; });
  let threw = false; try { g.approveCurrentSite(); } catch (e) { threw = /nothing was approved/.test(e.message); }
  check("won't approve a half-loaded site", threw && !state.props.get("SITE_APPROVED"));
}

console.log("Script lists match the form in quote.html");
{
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "quote.html"), "utf8");
  const decode = (t) => t.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  const select = html.slice(html.indexOf('id="q-service"'), html.indexOf("</select>", html.indexOf('id="q-service"')));
  const services = [...select.matchAll(/<option(?: value="([^"]*)")?>([^<]*)<\/option>/g)].map((m) => decode(m[1] != null ? m[1] : m[2])).filter(Boolean);
  const sizes = [...html.matchAll(/name="lawn_size" value="([^"]*)"/g)].map((m) => decode(m[1]));
  const { g } = fresh();
  check("every service option is on the script's list", services.length === 8 && services.every((x) => g.SERVICES.indexOf(x) !== -1), JSON.stringify(services));
  check("every lawn size option is on the script's list", sizes.length === 5 && sizes.every((x) => g.LAWN_SIZES.indexOf(x) !== -1), JSON.stringify(sizes));
  const areas = ["In area (Hinckley)", "In area (Earl Shilton)", "OUTSIDE — on the edge, 1.2 mi from Burbage", "OUTSIDE — 4.0 mi from Stoke Golding", "OUTSIDE — far, 25.3 mi from Hinckley",
    "Probably in area (offline check of postcode sector — confirm)", "Probably outside (offline check — confirm)", "Postcode not found by lookup", "Not checked"];
  check("every area-check wording site.js produces is accepted", areas.every((a) => g.AREA_RE.test(a)));
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
