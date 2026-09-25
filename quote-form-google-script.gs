/**
 * THE LAWN LADS — QUOTE FORM RECEIVER (Google Apps Script)
 *
 * What it does with every quote request from the website:
 *   1. Checks it (right kinds of details, real photos, not a bot, not too many)
 *   2. Adds a row to the "Quotes" tab of this Google Sheet
 *   3. Saves any photos into a Google Drive folder ("Lawn Lads quote photos")
 *   4. Emails you the details with the photos attached
 *
 * It also keeps an eye on the live website every hour (see "site monitor" near
 * the bottom) and emails you if your phone, WhatsApp, email or the quote form's
 * destination ever changes.
 *
 * Even if the email ever goes missing, the request is still in the Sheet.
 *
 * Setup steps are in SECURITY.md (section 1). The only line you normally change
 * is NOTIFY_EMAIL below. Private keys go in Project Settings -> Script Properties,
 * never in this file.
 *
 * Everything sent to this script comes from the public internet, so none of it
 * is trusted: every field is re-checked here even though the website checks it too.
 */

var CONFIG = {
  NOTIFY_EMAIL: 'admin@thelawnlads.co.uk',   // where new quote emails go (fixed: customers can never change it)
  SHEET_NAME: 'Quotes',
  DRIVE_FOLDER_NAME: 'Lawn Lads quote photos',
  MAX_PHOTOS: 3,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,           // per photo, after the website shrinks it (usually 200–600KB)
  MAX_REQUEST_BYTES: 22 * 1024 * 1024,        // whole request: 3 photos at the limit, base64-encoded, plus text
  MAX_PER_HOUR: 30,                           // all quote requests together
  MAX_PER_PERSON_PER_HOUR: 3,                 // from the same email address or phone number
  MAX_PHOTO_MB_PER_DAY: 100,                  // stops anyone filling your Google storage (which Gmail shares)
  EMAIL_RESERVE: 5,                           // emails kept back each day for the warning emails below
  MIN_FILL_SECONDS: 3,                        // nobody fills the form in faster than this; bots do
  MAX_BOT_CHECKS_PER_HOUR: 600,               // questions to Cloudflare per hour (Google allows 20,000 a day in total)
  MAX_UNCHECKED_PER_HOUR: 20,                 // quotes kept, without photos or email, when the bot check can't run
  SITE_URL: 'https://thelawnlads.co.uk/',
  SITE_HOSTNAMES: ['thelawnlads.co.uk', 'www.thelawnlads.co.uk']
};

// These must match the choices in quote.html. A value that isn't listed is still
// saved (as "Other: …") so no quote is lost if you add a choice and forget this list.
var SERVICES = ['Lawn mowing / grass cutting', 'Overgrown lawn', 'Strimming & edging', 'Hedge trimming',
                'Garden tidy-up', 'One-off garden work', 'Regular garden maintenance', 'Other'];
var LAWN_SIZES = ['Small (up to ~50 m²)', 'Medium (~50–150 m²)', 'Large (~150–300 m²)', 'Very large (300 m²+)',
                  "Doesn't know the size"];

var COLUMNS = ['Received', 'Status', 'Name', 'Phone', 'Email', 'Postcode', 'Area check',
               'Service', 'Lawn size', 'Description', 'Photos', 'Sent from page'];

var MESSAGES = {
  generic: 'Something went wrong on our side.',
  tooBig: 'That was too much to send in one go — try fewer photos.',
  busy: 'We\'re getting a lot of requests right now — please try again in a little while.',
  person: 'We\'ve already had a few requests from you in the last hour, so we\'ll be in touch soon.',
  invalid: 'Some details need checking:',
  robot: 'We couldn\'t confirm you\'re not a robot. Please press Send again.',
  robotNoScript: 'Sorry, this form needs JavaScript switched on so it can check you\'re not a robot. You can WhatsApp or call us instead (details are on the website).'
};

function doGet() {
  return ContentService.createTextOutput('The Lawn Lads quote form receiver is running.');
}

function doPost(e) {
  var fromBrowserScript = !!(e && e.postData && e.postData.type !== 'application/x-www-form-urlencoded');
  var lock = null;
  try {
    if (e && e.postData && Number(e.postData.length) > CONFIG.MAX_REQUEST_BYTES) {
      log_('rejected', 'too large');
      return reply_(fromBrowserScript, false, MESSAGES.tooBig);
    }
    var data = readRequest_(e);
    if (!data) {
      log_('rejected', 'unreadable request');
      return reply_(fromBrowserScript, false, MESSAGES.generic);
    }

    // Hidden "honeypot" field: real people never fill it in, bots do. Pretend it worked.
    if (data._honey) {
      log_('ignored', 'honeypot');
      return reply_(fromBrowserScript, true);
    }

    var q = readQuote_(data);
    var problems = checkQuote_(q);
    if (problems.length) {
      log_('rejected', 'invalid ' + problems.join(', '));
      return reply_(fromBrowserScript, false, MESSAGES.invalid + ' ' + problems.join(', ') + '.');
    }

    // Someone who has already sent a few this hour is turned away before anything costly happens
    if (personOverLimit_(q)) {
      log_('rejected', 'per-person limit');
      return reply_(fromBrowserScript, false, MESSAGES.person);
    }

    // Bot check (Cloudflare Turnstile). Does nothing until TURNSTILE_SECRET is set (SECURITY.md).
    var human = checkHuman_(data._turnstile);
    if (human.mode === 'enforce' && human.result === 'fail') {
      log_('rejected', 'bot check failed: ' + human.detail);
      return reply_(fromBrowserScript, false, fromBrowserScript ? MESSAGES.robot : MESSAGES.robotNoScript, 'robot');
    }

    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      lock = null;
      log_('rejected', 'lock timeout');
      return reply_(fromBrowserScript, false, MESSAGES.busy);
    }
    tidyCounters_();

    // Cloudflare couldn't be asked. Keep the quote (no photos, no email) so a real customer isn't
    // lost, but only a few an hour, and never from the allowance that real, checked quotes use.
    if (human.mode === 'enforce' && human.result === 'unavailable') {
      if (!underUncheckedLimit_()) {
        log_('rejected', 'bot check unavailable and unchecked allowance used');
        return reply_(fromBrowserScript, false, MESSAGES.busy);
      }
      appendRow_(q, [], 'Check: bot check unavailable');
      log_('flagged', 'bot check unavailable: ' + human.detail);
      alertOnce_('bot-check', 'the bot check isn\'t working',
        'The quote form couldn\'t check a request with Cloudflare (' + human.detail + '). Requests are being saved in the Quotes sheet ' +
        'marked "Check: bot check unavailable", without photos or an email. Look through them today.\n\n' +
        (/secret/.test(human.detail) ? 'The TURNSTILE_SECRET in Script Properties looks wrong: copy it again from Cloudflare.\n\n' : '') +
        'If you get lots of these, someone may be flooding the form. See SECURITY.md.');
      return reply_(fromBrowserScript, true);
    }

    var limited = checkLimits_(q);
    if (limited === 'hourly') {
      log_('rejected', 'hourly limit');
      alertOnce_('hourly', 'quote form hit its hourly limit',
        'The website quote form has had ' + CONFIG.MAX_PER_HOUR + ' requests this hour, so it is turning new ones away until the hour is up.\n\n' +
        'If these are not real customers, someone may be spamming the form. Check the Quotes sheet. See SECURITY.md for what to do.');
      return reply_(fromBrowserScript, false, MESSAGES.busy);
    }
    if (limited === 'person') {
      log_('rejected', 'per-person limit');
      return reply_(fromBrowserScript, false, MESSAGES.person);
    }

    // Looks automated: keep it in the Sheet for you to glance at, but don't save photos or email.
    var spam = spamSignal_(data, q);
    if (spam) {
      appendRow_(q, [], 'Check: possible spam (' + spam + ')');
      log_('flagged', spam);
      return reply_(fromBrowserScript, true);
    }

    if (human.mode === 'test') q.botCheck = human.result === 'pass' ? 'passed' : human.result + (human.detail ? ' (' + human.detail + ')' : '');
    var photos = savePhotos_(data.photos, q);
    var row = appendRow_(q, photos.saved.map(function (p) { return p.url; }).concat(photos.notes), 'New');
    // The request is safely in the Sheet now. If the email fails, flag it there
    // rather than telling the customer it didn't work.
    try {
      if (MailApp.getRemainingDailyQuota() > CONFIG.EMAIL_RESERVE) {
        sendEmail_(q, photos);
      } else {
        row.getCell(1, 2).setValue('New (not emailed: daily email limit)');
        log_('warning', 'email quota low');
        alertOnce_('email-quota', 'daily email limit nearly used up',
          'Google\'s daily email limit for the quote form is nearly used up, so new quote requests are going into the Quotes sheet without an email.\n\n' +
          'Check the Quotes sheet today. The limit resets within 24 hours.');
      }
    } catch (mailErr) {
      logError_('email', mailErr);
      row.getCell(1, 2).setValue('New (email failed)');
    }
    log_('accepted', photos.saved.length + ' photo(s)');
    return reply_(fromBrowserScript, true);
  } catch (err) {
    logError_('doPost', err);
    return reply_(fromBrowserScript, false, MESSAGES.generic);
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ---------------- reading and checking the request ---------------- */

function readRequest_(e) {
  if (!e) return null;
  var data;
  if (e.postData && e.postData.contents && e.postData.type !== 'application/x-www-form-urlencoded') {
    try { data = JSON.parse(e.postData.contents); } catch (err) { return null; }
  } else {
    data = e.parameter || {};   // plain HTML form post (browser with JavaScript off)
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

// One line of text: no line breaks, tabs or control characters (they could split
// email headers), and no invisible right-to-left tricks that disguise text.
function oneLine_(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim().slice(0, max);
}

// Several lines of text (the job description): keeps line breaks, drops everything else.
function multiLine_(v, max) {
  return String(v == null ? '' : v)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u0085\u2028\u2029]/g, '')
    .replace(/\t/g, ' ')
    .replace(/[\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim().slice(0, max);
}

// Same rules as the website (site.js), so anything the website accepts is accepted here.
var POSTCODE_RE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;
var PHONE_RE = /^(?:\+44|0044|0)\d{9,10}$/;
var EMAIL_RE = /^[^\s@<>()\[\]",;:\\]+@[^\s@<>()\[\]",;:\\]+\.[^\s@<>()\[\]",;:\\]{2,}$/;
var LINK_RE = /https?:|www\.|\/\//i;
// The area check is worked out in the visitor's browser, so only its known wordings are kept.
var AREA_RE = /^(In area \([A-Za-z .'-]{1,40}\)|OUTSIDE — [A-Za-z0-9 .,'-]{1,80}|Probably in area \(offline check of postcode sector — confirm\)|Probably outside \(offline check — confirm\)|Postcode not found by lookup|Not checked)$/;
var PAGE_RE = /^https:\/\/(www\.)?thelawnlads\.co\.uk\/[A-Za-z0-9._\-\/]*(#[A-Za-z0-9_\-]*)?$/;

function normalisePostcode_(raw) {
  var m = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(POSTCODE_RE);
  return m ? m[1] + ' ' + m[2] : '';
}

function pick_(value, allowed) {
  if (!value) return '';
  return allowed.indexOf(value) !== -1 ? value : ('Other: ' + value).slice(0, 60);
}

function readQuote_(data) {
  var area = oneLine_(data.area_check, 120);
  var page = oneLine_(data.page, 200);
  return {
    name: oneLine_(data.name, 80),
    phone: oneLine_(data.phone, 30),
    email: oneLine_(data.email, 120),
    postcode: normalisePostcode_(data.postcode),
    area: AREA_RE.test(area) ? area : 'Not checked',
    service: pick_(oneLine_(data.service, 60), SERVICES),
    size: pick_(oneLine_(data.lawn_size, 60), LAWN_SIZES) || 'Not given',
    description: multiLine_(data.description, 1500),
    page: PAGE_RE.test(page) ? page : ''
  };
}

function checkQuote_(q) {
  var problems = [];
  if (q.name.length < 2 || /[<>]/.test(q.name) || LINK_RE.test(q.name)) problems.push('name');
  if (!PHONE_RE.test(q.phone.replace(/[\s\-().]/g, ''))) problems.push('phone number');
  if (!EMAIL_RE.test(q.email)) problems.push('email');
  if (!q.postcode) problems.push('postcode');
  if (!q.service) problems.push('what you need');
  return problems;
}

function spamSignal_(data, q) {
  if (data._elapsed != null && data._elapsed !== '') {
    var ms = Number(data._elapsed);
    if (!isFinite(ms) || ms < CONFIG.MIN_FILL_SECONDS * 1000) return 'sent too fast';
  }
  if ((q.description.match(/https?:\/\/|www\./gi) || []).length > 2) return 'lots of links';
  return '';
}

/* ---------------- limits ---------------- */

function hourStamp_() { return Utilities.formatDate(new Date(), 'Europe/London', 'yyyyMMddHH'); }
function dayStamp_() { return Utilities.formatDate(new Date(), 'Europe/London', 'yyyyMMdd'); }

// Email addresses and phone numbers are hashed, so they aren't stored as counter names.
function personKey_(kind, value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, kind + ':' + value);
  return 'person-' + hourStamp_() + '-' + Utilities.base64EncodeWebSafe(digest).slice(0, 22);
}

function phoneDigits_(phone) {
  return phone.replace(/[^\d+]/g, '').replace(/^\+44/, '0').replace(/^0044/, '0');
}

// The same inbox written differently (Sam.Taylor+1@gmail.com, samtaylor@gmail.com) counts as one person.
function emailIdentity_(email) {
  var parts = email.toLowerCase().split('@');
  var local = parts[0].split('+')[0], domain = parts[1] || '';
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}

function personKeys_(q) {
  return [personKey_('email', emailIdentity_(q.email)), personKey_('phone', phoneDigits_(q.phone))];
}

// Quick look (nothing counted) so repeat senders don't cost a bot check.
function personOverLimit_(q) {
  var cache = CacheService.getScriptCache();
  return personKeys_(q).some(function (k) { return Number(cache.get(k) || 0) >= CONFIG.MAX_PER_PERSON_PER_HOUR; });
}

function underUncheckedLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'unchecked-' + hourStamp_();
  var n = Number(cache.get(key) || 0);
  if (n >= CONFIG.MAX_UNCHECKED_PER_HOUR) return false;
  cache.put(key, String(n + 1), 3700);
  return true;
}

// Returns '' if the request is within the limits (and counts it), or which limit it hit.
function checkLimits_(q) {
  var cache = CacheService.getScriptCache();
  var hourKey = 'count-' + hourStamp_();
  var hourCount = Number(cache.get(hourKey) || 0);
  if (hourCount >= CONFIG.MAX_PER_HOUR) return 'hourly';

  var keys = personKeys_(q);
  var counts = keys.map(function (k) { return Number(cache.get(k) || 0); });
  if (Math.max(counts[0], counts[1]) >= CONFIG.MAX_PER_PERSON_PER_HOUR) return 'person';

  cache.put(hourKey, String(hourCount + 1), 3700);
  keys.forEach(function (k, i) { cache.put(k, String(counts[i] + 1), 3700); });
  return '';
}

function photoBytesKey_() { return 'photo-bytes-' + dayStamp_(); }

function photoBudgetLeft_() {
  var used = Number(PropertiesService.getScriptProperties().getProperty(photoBytesKey_()) || 0);
  return CONFIG.MAX_PHOTO_MB_PER_DAY * 1024 * 1024 - used;
}

function usePhotoBudget_(bytes) {
  var props = PropertiesService.getScriptProperties();
  var key = photoBytesKey_();
  props.setProperty(key, String(Number(props.getProperty(key) || 0) + bytes));
}

// Daily counters and warnings are kept as Script Properties; clear out old days.
function tidyCounters_() {
  var props = PropertiesService.getScriptProperties();
  var today = dayStamp_();
  props.getKeys().forEach(function (k) {
    if (/^(photo-bytes|alerted)-/.test(k) && k.slice(-8) !== today) props.deleteProperty(k);
  });
}

// Emails you a warning, at most once a day for each kind of problem.
function alertOnce_(what, subject, body) {
  var props = PropertiesService.getScriptProperties();
  var key = 'alerted-' + what + '-' + dayStamp_();
  if (props.getProperty(key)) return;
  props.setProperty(key, '1');
  try {
    if (MailApp.getRemainingDailyQuota() > 0) {
      MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Lawn Lads website: ' + subject, body, { name: 'The Lawn Lads website' });
    }
  } catch (err) {
    logError_('alert', err);
  }
}

/* ---------------- bot check (Cloudflare Turnstile) ---------------- */

// Off until you add TURNSTILE_SECRET in Project Settings -> Script Properties. Then it runs in
// "test" mode (checks and reports in each email, blocks nothing) until you also add
// TURNSTILE_ENFORCE = yes. See SECURITY.md for the steps.
function botCheckMode_() {
  var props = PropertiesService.getScriptProperties();
  if (!String(props.getProperty('TURNSTILE_SECRET') || '').trim()) return 'off';
  // "yes", "Yes", " YES " (phones capitalise), "true" and "on" all count
  return /^(yes|y|true|on|1)$/.test(String(props.getProperty('TURNSTILE_ENFORCE') || '').trim().toLowerCase()) ? 'enforce' : 'test';
}

// result: 'pass', 'fail' (the visitor didn't pass), or 'unavailable' (couldn't ask Cloudflare)
function checkHuman_(token) {
  var mode = botCheckMode_();
  if (mode === 'off') return { mode: mode, result: 'off', detail: '' };
  token = typeof token === 'string' ? token : '';
  if (!token) return { mode: mode, result: 'fail', detail: 'no token' };
  if (token.length < 10 || token.length > 2048) return { mode: mode, result: 'fail', detail: 'malformed token' };

  // Every check is a request to Cloudflare, and Google limits how many the script can make a day.
  // Capping them per hour means fake tokens can't use up the whole day's allowance.
  var cache = CacheService.getScriptCache();
  var key = 'botchecks-' + hourStamp_();
  var n = Number(cache.get(key) || 0);
  if (n >= CONFIG.MAX_BOT_CHECKS_PER_HOUR) return { mode: mode, result: 'unavailable', detail: 'hourly check allowance used' };
  cache.put(key, String(n + 1), 3700);

  var res;
  try {
    res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      payload: { secret: String(PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET')).trim(), response: token },
      muteHttpExceptions: true,
      followRedirects: false
    });
  } catch (err) {
    logError_('bot check', err);
    return { mode: mode, result: 'unavailable', detail: 'could not reach Cloudflare' };
  }
  if (res.getResponseCode() !== 200) return { mode: mode, result: 'unavailable', detail: 'Cloudflare replied ' + res.getResponseCode() };
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (err) { return { mode: mode, result: 'unavailable', detail: 'unreadable reply from Cloudflare' }; }
  var codes = (body['error-codes'] || []).join(' ');
  // A wrong or missing secret is your setup, not the visitor, so it doesn't count as them failing.
  if (/secret|internal-error/.test(codes)) return { mode: mode, result: 'unavailable', detail: 'Cloudflare says: ' + codes };
  if (body.success !== true) return { mode: mode, result: 'fail', detail: codes || 'not passed' };
  if (CONFIG.SITE_HOSTNAMES.indexOf(String(body.hostname)) === -1) return { mode: mode, result: 'fail', detail: 'solved on another website' };
  if (body.action !== 'quote') return { mode: mode, result: 'fail', detail: 'token for a different form' };
  return { mode: mode, result: 'pass', detail: '' };
}

/* ---------------- Sheet ---------------- */

// Stop anything typed into the form being treated as a spreadsheet formula
function safeCell_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendRow_(q, photoLines, status) {
  var sheet = getSheet_();
  sheet.appendRow([
    new Date(), status, safeCell_(q.name),
    "'" + q.phone,   // kept as text so Sheets doesn't drop the leading 0
    safeCell_(q.email), safeCell_(q.postcode), safeCell_(q.area), safeCell_(q.service), safeCell_(q.size),
    safeCell_(q.description), safeCell_(photoLines.join('\n')), safeCell_(q.page)
  ]);
  return sheet.getRange(sheet.getLastRow(), 1, 1, COLUMNS.length);
}

/* ---------------- photos ---------------- */

var IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// Works out the image type from the file's own first bytes. The name and type the
// browser sent are ignored, because anyone can label any file "photo.jpg".
function imageType_(b) {
  if (!b || b.length < 12) return '';
  var at = function (i) { return b[i] & 0xFF; };   // Apps Script bytes are signed
  if (at(0) === 0xFF && at(1) === 0xD8 && at(2) === 0xFF) return 'jpg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4E && at(3) === 0x47 &&
      at(4) === 0x0D && at(5) === 0x0A && at(6) === 0x1A && at(7) === 0x0A) return 'png';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
      at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'webp';
  return '';
}

function getFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* folder deleted — make a new one */ }
  }
  var folder = DriveApp.createFolder(CONFIG.DRIVE_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function savePhotos_(photos, q) {
  var result = { saved: [], notes: [] };
  if (!photos) return result;
  if (!Array.isArray(photos)) {
    result.notes.push('Photos were sent in a form we could not read, so none were saved.');
    return result;
  }
  if (photos.length > CONFIG.MAX_PHOTOS) result.notes.push('Only the first ' + CONFIG.MAX_PHOTOS + ' photos were kept.');

  var stamp = Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd HHmm');
  var maxBase64 = Math.ceil(CONFIG.MAX_PHOTO_BYTES / 3) * 4;
  var budget = photoBudgetLeft_();
  var folder = null, used = 0, rejected = 0, overBudget = false;

  photos.slice(0, CONFIG.MAX_PHOTOS).forEach(function (p) {
    var data = p && typeof p.data === 'string' ? p.data : '';
    if (!data || data.length > maxBase64) { rejected++; return; }   // size check before decoding
    var bytes;
    try { bytes = Utilities.base64Decode(data); } catch (err) { rejected++; return; }
    var ext = imageType_(bytes);
    if (!ext || bytes.length > CONFIG.MAX_PHOTO_BYTES) { rejected++; return; }
    if (used + bytes.length > budget) { overBudget = true; return; }
    used += bytes.length;
    // Our own file name: date, postcode (already checked) and a random tag. Nothing the visitor typed.
    var name = stamp + ' ' + q.postcode + ' ' + Utilities.getUuid().slice(0, 8) + ' (' + (result.saved.length + 1) + ').' + ext;
    var blob = Utilities.newBlob(bytes, IMAGE_TYPES[ext], name);
    folder = folder || getFolder_();
    var file = folder.createFile(blob);
    result.saved.push({ blob: blob, url: file.getUrl() });
  });

  if (used) usePhotoBudget_(used);
  if (rejected) result.notes.push(rejected + ' file(s) were not JPG, PNG or WEBP photos (or were too big) and were not saved.');
  if (overBudget) {
    result.notes.push('Some photos were not saved because the daily photo limit was reached. Ask the customer to WhatsApp them.');
    alertOnce_('photo-budget', 'daily photo limit reached',
      'The quote form has saved ' + CONFIG.MAX_PHOTO_MB_PER_DAY + 'MB of photos today, so it has stopped saving more until tomorrow. ' +
      'Quote details are still being saved.\n\nIf that is not real customers, someone may be abusing the form. See SECURITY.md.');
  }
  return result;
}

/* ---------------- email ---------------- */

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function sendEmail_(q, photos) {
  var outside = /^(OUTSIDE|Probably outside)/.test(q.area);
  var subjectService = SERVICES.indexOf(q.service) !== -1 ? q.service : 'Other';
  var subject = 'Quote request: ' + subjectService + ' — ' + q.postcode + (outside ? ' (OUTSIDE AREA)' : '');
  var digits = q.phone.replace(/[^\d+]/g, '');
  var intl = digits.replace(/^\+/, '').replace(/^0044/, '44').replace(/^0/, '44');
  var saved = photos.saved;
  var rows = [
    ['Name', q.name], ['Phone', q.phone], ['Email', q.email], ['Postcode', q.postcode],
    ['Area check', q.area], ['Service', q.service], ['Lawn size', q.size],
    ['Description', q.description || '—'],
    ['Photos', (saved.length ? saved.length + ' attached' : 'None') + (photos.notes.length ? '. ' + photos.notes.join(' ') : '')]
  ];
  if (q.botCheck) rows.push(['Bot check (test mode)', q.botCheck]);
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#211f16">' +
    '<h2 style="margin:0 0 12px">New quote request' + (outside ? ' <span style="color:#a8432a">(outside area)</span>' : '') + '</h2>' +
    '<table cellpadding="6" style="border-collapse:collapse">' +
    rows.map(function (r) {
      return '<tr><td style="border-bottom:1px solid #ddd;font-weight:bold;vertical-align:top">' + esc_(r[0]) +
             '</td><td style="border-bottom:1px solid #ddd;white-space:pre-wrap">' + esc_(r[1]) + '</td></tr>';
    }).join('') +
    '</table>' +
    '<p style="margin:18px 0 6px"><b>Reply:</b> just hit Reply to email them, or ' +
    '<a href="https://wa.me/' + esc_(intl) + '">WhatsApp them</a> · <a href="tel:' + esc_(digits) + '">call</a></p>' +
    (saved.length ? '<p style="margin:6px 0">Photos are also saved in Google Drive: ' +
      saved.map(function (p, i) { return '<a href="' + esc_(p.url) + '">photo ' + (i + 1) + '</a>'; }).join(', ') + '</p>' : '') +
    '<p style="color:#777;font-size:13px">Also logged in your Lawn Lads quotes Google Sheet. ' +
    'Everything above was typed by a website visitor, so be wary of any links in it.</p></div>';

  var options = { htmlBody: html, name: 'The Lawn Lads website', attachments: saved.map(function (p) { return p.blob; }) };
  options.replyTo = q.email;   // already checked against EMAIL_RE: one plain address, no extra recipients
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, 'New quote request from ' + q.name + ' (' + q.phone + ', ' + q.email + ') for ' + q.postcode + '.', options);
}

/* ---------------- replies and logs ---------------- */

function reply_(isScript, ok, message, code) {
  if (isScript) {
    return ContentService.createTextOutput(JSON.stringify({ ok: ok, error: ok ? undefined : message, code: code }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // JavaScript was off in the visitor's browser: show a simple page
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;padding:24px"><h2>' +
    (ok ? 'Thanks! We\'ve received your request and will get back to you shortly.' : esc_(message || 'Something went wrong.')) +
    '</h2><p><a href="https://thelawnlads.co.uk/" target="_top">Back to The Lawn Lads</a></p></div>');
}

// Logs go to Apps Script's Executions page (only you can see them). They never
// include what the customer typed: just what happened and why.
function log_(outcome, reason) {
  console.log(JSON.stringify({ quote: outcome, reason: reason }));
}

function logError_(where, err) {
  console.error(where + ': ' + String(err && err.name || 'Error') + ' ' + String(err && err.message || err).slice(0, 200));
}

/* ---------------- site monitor ---------------- */
// Your GitHub account can change the website. This runs in your Google account instead, so if
// someone got into GitHub (or took over the domain) and changed where customers' calls, messages
// or quotes go, you'd get an email within about an hour, even if they covered their tracks there.
// It only watches things that matter for that: the settings in config.js, the scripts, every link
// that leaves the site (phone, WhatsApp, email, booking, forms, other websites) and the security
// policy. Changing prices or wording doesn't set it off.

var SITE_FILES = ['', 'services.html', 'our-work.html', 'quote.html', 'about.html', 'faq.html', 'contact.html', 'config.js', 'site.js'];
var WATCHED_SETTINGS = {
  whatsappNumber: 'WhatsApp number', phoneInternational: 'Phone number (dialled)', phoneDisplay: 'Phone number (shown)',
  contactEmail: 'Email address', bookingUrl: 'Booking link', quoteEndpoint: 'Where quote requests are sent',
  turnstileSiteKey: 'Bot check site key'
};

function hash_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(digest).slice(0, 16);
}

function readSite_() {
  var site = { settings: {}, scripts: {}, links: {}, policies: {}, inline: {}, problems: [] };
  SITE_FILES.forEach(function (path) {
    var name = path || 'home page', res;
    try {
      res = UrlFetchApp.fetch(CONFIG.SITE_URL + path, { muteHttpExceptions: true, followRedirects: false });
    } catch (err) {
      site.problems.push(name + ': could not connect');
      return;
    }
    if (res.getResponseCode() !== 200) { site.problems.push(name + ': returned ' + res.getResponseCode()); return; }
    var text = res.getContentText(), m;
    if (/\.js$/.test(path)) {
      site.scripts[path] = hash_(text);
      if (path === 'config.js') {
        var setting = /(\w+)\s*:\s*"([^"]*)"/g;
        while ((m = setting.exec(text))) if (WATCHED_SETTINGS[m[1]]) site.settings[m[1]] = m[2];
      }
      return;
    }
    var attr = /\b(?:href|src|action)\s*=\s*"([^"]+)"/gi;
    while ((m = attr.exec(text))) {
      var url = m[1].replace(/&amp;/g, '&').split('#')[0].split('?')[0];
      if (/^(https?:|tel:|mailto:|\/\/)/i.test(url)) site.links[url] = 1;
    }
    var csp = text.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    site.policies[csp ? csp[1] : '(no security policy on ' + name + ')'] = 1;
    var script = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    while ((m = script.exec(text))) {
      if (/\bsrc\s*=/i.test(m[1]) || /application\/ld\+json/i.test(m[1])) continue;   // external files are checked by address; ld+json is data
      site.inline[hash_(m[2])] = 1;
    }
  });
  return {
    settings: site.settings, scripts: site.scripts, links: Object.keys(site.links).sort(),
    policies: Object.keys(site.policies).sort(), inline: Object.keys(site.inline).sort(), problems: site.problems
  };
}

function describeChanges_(was, now) {
  var out = [];
  Object.keys(WATCHED_SETTINGS).forEach(function (k) {
    if ((was.settings[k] || '') !== (now.settings[k] || '')) {
      out.push(WATCHED_SETTINGS[k] + ' changed from "' + (was.settings[k] || '') + '" to "' + (now.settings[k] || '') + '"');
    }
  });
  ['config.js', 'site.js'].forEach(function (f) {
    if (was.scripts[f] !== now.scripts[f]) out.push(f + ' has been changed');
  });
  var diff = function (label, a, b) {
    b.forEach(function (x) { if (a.indexOf(x) === -1) out.push('New ' + label + ': ' + x); });
    a.forEach(function (x) { if (b.indexOf(x) === -1) out.push('Removed ' + label + ': ' + x); });
  };
  diff('link or address', was.links, now.links);
  if (was.policies.join('\n') !== now.policies.join('\n')) out.push('The security policy (Content-Security-Policy) has changed on at least one page');
  if (was.inline.join() !== now.inline.join()) out.push('A script written directly into a page has been added or changed');
  return out;
}

function summary_(site) {
  return Object.keys(WATCHED_SETTINGS).map(function (k) { return WATCHED_SETTINGS[k] + ': ' + (site.settings[k] || '(empty)'); }).join('\n');
}

/**
 * Run this after YOU change the website (so the monitor learns the new version), and once
 * when setting up. Check the list it prints in the Execution log is right before trusting it.
 */
function approveCurrentSite() {
  var site = readSite_();
  if (site.problems.length) throw new Error('Could not read the whole website, so nothing was approved: ' + site.problems.join('; '));
  PropertiesService.getScriptProperties().setProperty('SITE_APPROVED', JSON.stringify(site));
  PropertiesService.getScriptProperties().deleteProperty('SITE_CHECK_FAILS');
  console.log('Website approved. These are the details customers see. Check every one is yours:\n' + summary_(site));
}

/** Run once: checks the website every hour from now on (and approves how it looks right now). */
function setUpSiteMonitor() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkSite') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkSite').timeBased().everyHours(1).create();
  approveCurrentSite();
}

/** Runs every hour by itself once setUpSiteMonitor has been run. */
function checkSite() {
  var props = PropertiesService.getScriptProperties();
  var approved = props.getProperty('SITE_APPROVED');
  if (!approved) { log_('site check', 'not set up'); return; }
  tidyCounters_();
  var now = readSite_();
  if (now.problems.length) {
    // One blip isn't worth an email; three checks in a row is.
    var fails = Number(props.getProperty('SITE_CHECK_FAILS') || 0) + 1;
    props.setProperty('SITE_CHECK_FAILS', String(fails));
    log_('site check', 'could not read site (' + fails + ' in a row)');
    if (fails >= 3) {
      alertOnce_('site-down', 'the website check keeps failing',
        'The hourly check couldn\'t read thelawnlads.co.uk properly 3 times in a row:\n\n' + now.problems.join('\n') +
        '\n\nOpen the website on your phone. If it\'s down or looks wrong, check GitHub (repository Settings -> Pages) and your domain.');
    }
    return;
  }
  props.deleteProperty('SITE_CHECK_FAILS');
  var changes = describeChanges_(JSON.parse(approved), now);
  if (!changes.length) { log_('site check', 'unchanged'); return; }
  log_('site check', changes.length + ' change(s)');
  alertOnce_('site-' + hash_(changes.join('\n')).slice(0, 10), 'THE WEBSITE HAS CHANGED: check it was you',
    'These changed on thelawnlads.co.uk since you last approved it:\n\n- ' + changes.join('\n- ') + '\n\n' +
    'If YOU made these changes: open the quote form script, choose approveCurrentSite next to Run, and press Run.\n\n' +
    'If you did NOT:\n1. Change your GitHub password and check two-step login is on.\n' +
    '2. In the repository, look at the latest commits and undo any you didn\'t make.\n' +
    '3. Open the website and check the phone number, WhatsApp and email are yours.\n\n' +
    'You\'ll get this once a day until it\'s approved or put back.');
}

/* ---------------- monthly clean-up (see the privacy notice) ---------------- */
// The privacy notice promises that quote requests that don't turn into work are deleted
// 6 months after they arrive. Once set up (setUpMonthlyCleanup), this runs every morning
// but only acts once a month: it emails you a list of what's due to go, waits 7 days so
// you can keep anything by setting its Status to Booked (or Keep), then deletes those rows
// and moves their photos to Drive's bin (Google empties the bin after 30 days).
// It can't delete emails, so the list email tells you which ones to delete yourself.

var CLEANUP = { KEEP_MONTHS: 6, NOTICE_DAYS: 7, MAX_PER_MONTH: 200, KEEP_STATUS: /book|keep|customer/i };

function quoteKey_(received, email) {
  return received.getTime() + '|' + hash_(String(email || '').toLowerCase());
}

function cleanupCutoff_() {
  var cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - CLEANUP.KEEP_MONTHS);
  return cutoff;
}

// Rows older than 6 months whose Status doesn't say Booked / Keep / Customer.
function expiredQuotes_() {
  var values = getSheet_().getDataRange().getValues();
  var cutoff = cleanupCutoff_(), out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i], received = r[0], status = String(r[1] || '');
    if (!(received instanceof Date) || isNaN(received.getTime())) continue;   // can't tell its age: never delete
    if (received >= cutoff || CLEANUP.KEEP_STATUS.test(status)) continue;
    out.push({ row: i + 1, key: quoteKey_(received, r[4]), received: received, name: String(r[2] || ''),
               postcode: String(r[5] || ''), status: status, photos: String(r[10] || '') });
  }
  return out;
}

function ukDate_(d, fmt) { return Utilities.formatDate(d, 'Europe/London', fmt || 'd MMM yyyy'); }

/** Runs every morning once setUpMonthlyCleanup has been run. */
function cleanUpOldQuotes() {
  var props = PropertiesService.getScriptProperties();
  var today = ukDate_(new Date(), 'yyyy-MM-dd');
  var pending = props.getProperty('CLEANUP_PENDING');
  if (pending) {
    pending = JSON.parse(pending);
    if (today < pending.due) return;
    props.deleteProperty('CLEANUP_PENDING');
    deleteExpired_(pending.keys);
    return;
  }
  var month = today.slice(0, 7);
  if (props.getProperty('CLEANUP_MONTH') === month) return;   // already looked this month
  props.setProperty('CLEANUP_MONTH', month);

  var due = expiredQuotes_().slice(0, CLEANUP.MAX_PER_MONTH);
  if (!due.length) { log_('clean-up', 'nothing due'); return; }
  var when = new Date();
  when.setDate(when.getDate() + CLEANUP.NOTICE_DAYS);
  props.setProperty('CLEANUP_PENDING', JSON.stringify({ due: ukDate_(when, 'yyyy-MM-dd'), keys: due.map(function (q) { return q.key; }) }));
  var cutoff = cleanupCutoff_();
  log_('clean-up', due.length + ' due on ' + ukDate_(when, 'yyyy-MM-dd'));
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL,
    'Lawn Lads: ' + due.length + ' old quote request(s) will be deleted on ' + ukDate_(when),
    'Your privacy notice says quote requests that don\'t turn into work are deleted after ' + CLEANUP.KEEP_MONTHS + ' months.\n\n' +
    'On ' + ukDate_(when) + ' these rows will be deleted from the Quotes sheet, and their photos moved to the Drive bin:\n\n' +
    due.map(function (q) { return '- ' + ukDate_(q.received) + '  ' + q.name + '  ' + q.postcode + '  (' + (q.status || 'no status') + ')'; }).join('\n') +
    '\n\nTo KEEP any of them (for example a customer), change its Status to Booked (or Keep) before then.\n\n' +
    'The script can\'t delete emails, so please delete the matching quote emails yourself:\n' +
    '- In the admin@thelawnlads.co.uk inbox: search for "Quote request" and delete any from before ' + ukDate_(cutoff) + ' (unless they became customers).\n' +
    '- In Gmail, search:  in:sent subject:"Quote request" before:' + ukDate_(cutoff, 'yyyy/MM/dd') + '  and delete those too.',
    { name: 'The Lawn Lads website' });
}

function deleteExpired_(keys) {
  var sheet = getSheet_();
  var wanted = {};
  keys.forEach(function (k) { wanted[k] = true; });
  // Check again: anything changed to Booked/Keep during the week, or already removed, is left alone
  var go = expiredQuotes_().filter(function (q) { return wanted[q.key]; });
  var folderId = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER_ID');
  var binned = 0;
  go.sort(function (a, b) { return b.row - a.row; });   // bottom up, so row numbers don't shift
  go.forEach(function (q) {
    (q.photos.match(/\/d\/[A-Za-z0-9_-]{10,}/g) || []).forEach(function (m) {
      try {
        var file = DriveApp.getFileById(m.slice(3)), parents = file.getParents(), ours = false;
        while (parents.hasNext()) if (parents.next().getId() === folderId) ours = true;
        if (ours) { file.setTrashed(true); binned++; }   // only ever photos in the quote photos folder
      } catch (err) { logError_('clean-up photo', err); }
    });
    sheet.deleteRow(q.row);
  });
  log_('clean-up', 'deleted ' + go.length + ' quote(s), binned ' + binned + ' photo(s)');
  if (go.length || keys.length) {
    MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Lawn Lads: old quote requests deleted',
      'Deleted ' + go.length + ' old quote request(s) from the Quotes sheet and moved ' + binned + ' photo(s) to the Drive bin.' +
      (keys.length > go.length ? '\n' + (keys.length - go.length) + ' were kept because their Status was changed or they were already gone.' : '') +
      '\n\nRemember to delete the matching emails if you haven\'t already.', { name: 'The Lawn Lads website' });
  }
}

/** Run once: checks every morning and clears out expired quote requests once a month. */
function setUpMonthlyCleanup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cleanUpOldQuotes') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cleanUpOldQuotes').timeBased().everyDays(1).atHour(8).create();
  cleanUpOldQuotes();
  console.log('Monthly clean-up is on. It emails you a list a week before deleting anything.');
}

/**
 * Run this from the editor (select "testSetup" and press Run) after pasting in new code.
 * The first run asks Google for permission. It creates the Quotes tab if needed and emails
 * you a short status report.
 */
function testSetup() {
  getSheet_();
  var mode = botCheckMode_();
  var enforceValue = PropertiesService.getScriptProperties().getProperty('TURNSTILE_ENFORCE');
  var monitor = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkSite'; });
  var cleanup = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'cleanUpOldQuotes'; });
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Lawn Lads quote form — test email',
    'If you can read this, quote emails will reach this inbox. You can delete this email.\n\n' +
    'Emails left today: ' + MailApp.getRemainingDailyQuota() + '\n' +
    'Bot check: ' + { off: 'OFF (not set up yet, see SECURITY.md)', test: 'TEST MODE (checks and reports in each quote email, blocks nothing)', enforce: 'ON' }[mode] +
    (mode === 'test' && enforceValue != null ? ' - TURNSTILE_ENFORCE is set to "' + enforceValue + '", which isn\'t "yes"' : '') + '\n' +
    'Website monitor: ' + (monitor ? 'ON (checks every hour)' : 'OFF (run setUpSiteMonitor)') + '\n' +
    'Monthly clean-up of old quotes: ' + (cleanup ? 'ON' : 'OFF (run setUpMonthlyCleanup)'));
}
