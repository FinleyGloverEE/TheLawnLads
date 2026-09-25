/**
 * THE LAWN LADS — QUOTE FORM RECEIVER (Google Apps Script)
 *
 * What it does with every quote request from the website:
 *   1. Checks it (right kinds of details, real photos, not a bot, not too many)
 *   2. Adds a row to the "Quotes" tab of this Google Sheet
 *   3. Saves any photos into a Google Drive folder ("Lawn Lads quote photos")
 *   4. Emails you the details with the photos attached
 *
 * Even if the email ever goes missing, the request is still in the Sheet.
 *
 * Setup steps are in SETUP.md (section 1). Security notes are in SECURITY.md.
 * The only line you normally change is NOTIFY_EMAIL below.
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
  MIN_FILL_SECONDS: 3                         // nobody fills the form in faster than this; bots do
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
  invalid: 'Some details need checking:'
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

    lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      lock = null;
      log_('rejected', 'lock timeout');
      return reply_(fromBrowserScript, false, MESSAGES.busy);
    }
    tidyCounters_();

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

// Returns '' if the request is within the limits (and counts it), or which limit it hit.
function checkLimits_(q) {
  var cache = CacheService.getScriptCache();
  var hourKey = 'count-' + hourStamp_();
  var hourCount = Number(cache.get(hourKey) || 0);
  if (hourCount >= CONFIG.MAX_PER_HOUR) return 'hourly';

  var keys = [personKey_('email', q.email.toLowerCase()), personKey_('phone', phoneDigits_(q.phone))];
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

function reply_(isScript, ok, message) {
  if (isScript) {
    return ContentService.createTextOutput(JSON.stringify({ ok: ok, error: ok ? undefined : message }))
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

/**
 * Optional: run this once from the editor (select "testSetup" and press Run)
 * to create the Quotes tab and check the email arrives, before going live.
 */
function testSetup() {
  getSheet_();
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Lawn Lads quote form — test email',
    'If you can read this, quote emails will reach this inbox. You can delete this email.\n\n' +
    'Emails left today: ' + MailApp.getRemainingDailyQuota());
}
