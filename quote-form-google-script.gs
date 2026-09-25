/**
 * THE LAWN LADS — QUOTE FORM RECEIVER (Google Apps Script)
 *
 * What it does with every quote request from the website:
 *   1. Adds a row to the "Quotes" tab of this Google Sheet
 *   2. Saves any photos into a Google Drive folder ("Lawn Lads quote photos")
 *   3. Emails you the details with the photos attached
 *
 * Even if the email ever goes missing, the request is still in the Sheet.
 *
 * Setup steps are in SETUP.md (section 1). The only line you may want to
 * change is NOTIFY_EMAIL below.
 */

var CONFIG = {
  NOTIFY_EMAIL: 'admin@thelawnlads.co.uk',   // where new quote emails go
  SHEET_NAME: 'Quotes',
  DRIVE_FOLDER_NAME: 'Lawn Lads quote photos',
  MAX_PHOTOS: 3,
  MAX_PHOTO_BYTES: 5 * 1024 * 1024,           // per photo, after the website shrinks it
  MAX_PER_HOUR: 30                            // stops spam bots filling your Drive
};

var COLUMNS = ['Received', 'Status', 'Name', 'Phone', 'Email', 'Postcode', 'Area check',
               'Service', 'Lawn size', 'Description', 'Photos', 'Sent from page'];

function doGet() {
  return ContentService.createTextOutput('The Lawn Lads quote form receiver is running.');
}

function doPost(e) {
  var fromBrowserScript = e && e.postData && e.postData.type !== 'application/x-www-form-urlencoded';
  try {
    var data = readRequest_(e);

    // Hidden "honeypot" field: real people never fill it in, bots do. Pretend it worked.
    if (data._honey) return reply_(fromBrowserScript, true);

    if (!underHourlyLimit_()) return reply_(fromBrowserScript, false, 'Too many requests right now — please try again later or use WhatsApp.');

    var q = {
      name: clean_(data.name, 80),
      phone: clean_(data.phone, 30),
      email: clean_(data.email, 120),
      postcode: clean_(data.postcode, 10).toUpperCase(),
      area: clean_(data.area_check, 120) || 'Not checked',
      service: clean_(data.service, 60),
      size: clean_(data.lawn_size, 60),
      description: clean_(data.description, 1500),
      page: clean_(data.page, 200)
    };
    if (!q.name || !q.phone || !q.email || !q.postcode) {
      return reply_(fromBrowserScript, false, 'Some details were missing — please fill in name, phone, email and postcode.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var blobs = savePhotos_(data.photos, q);
      var links = blobs.map(function (b) { return b.url; });
      var row = appendRow_(q, links);
      // The request is safely in the Sheet now. If the email fails, flag it there
      // rather than telling the customer it didn't work.
      try {
        sendEmail_(q, blobs);
      } catch (mailErr) {
        console.error(mailErr);
        row.getCell(1, 2).setValue('New (email failed)');
      }
    } finally {
      lock.releaseLock();
    }
    return reply_(fromBrowserScript, true);
  } catch (err) {
    console.error(err && err.stack || err);
    return reply_(fromBrowserScript, false, 'Something went wrong on our side.');
  }
}

/* ---------------- helpers ---------------- */

function readRequest_(e) {
  if (e && e.postData && e.postData.contents && e.postData.type !== 'application/x-www-form-urlencoded') {
    return JSON.parse(e.postData.contents);
  }
  return (e && e.parameter) || {};   // plain HTML form post (browser with JavaScript off)
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

// Stop anything typed into the form being treated as a spreadsheet formula
function safeCell_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

function underHourlyLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'count-' + Utilities.formatDate(new Date(), 'Europe/London', 'yyyyMMddHH');
  var n = Number(cache.get(key) || 0);
  if (n >= CONFIG.MAX_PER_HOUR) return false;
  cache.put(key, String(n + 1), 3700);
  return true;
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

function appendRow_(q, links) {
  var sheet = getSheet_();
  sheet.appendRow([
    new Date(), 'New', safeCell_(q.name), safeCell_(q.phone), safeCell_(q.email), safeCell_(q.postcode),
    safeCell_(q.area), safeCell_(q.service), safeCell_(q.size), safeCell_(q.description),
    links.join('\n'), safeCell_(q.page)
  ]);
  return sheet.getRange(sheet.getLastRow(), 1, 1, COLUMNS.length);
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
  if (!photos || !photos.length) return [];
  var ok = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  var folder = null;
  var stamp = Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd HHmm');
  var saved = [];
  photos.slice(0, CONFIG.MAX_PHOTOS).forEach(function (p, i) {
    if (!p || !p.data || !ok[p.type]) return;
    var bytes = Utilities.base64Decode(String(p.data));
    if (bytes.length > CONFIG.MAX_PHOTO_BYTES) return;
    var name = stamp + ' ' + q.postcode + ' ' + q.name + ' (' + (i + 1) + ').' + ok[p.type];
    var blob = Utilities.newBlob(bytes, p.type, name);
    folder = folder || getFolder_();
    var file = folder.createFile(blob);
    saved.push({ blob: blob, url: file.getUrl() });
  });
  return saved;
}

function esc_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function sendEmail_(q, photos) {
  var outside = /^(OUTSIDE|Probably outside)/.test(q.area);
  var subject = 'Quote request: ' + (q.service || 'Not specified') + ' — ' + q.postcode + (outside ? ' (OUTSIDE AREA)' : '');
  var digits = q.phone.replace(/[^\d+]/g, '');
  var intl = digits.replace(/^\+/, '').replace(/^0044/, '44').replace(/^0/, '44');
  var rows = [
    ['Name', q.name], ['Phone', q.phone], ['Email', q.email], ['Postcode', q.postcode],
    ['Area check', q.area], ['Service', q.service], ['Lawn size', q.size],
    ['Description', q.description || '—'], ['Photos', photos.length ? photos.length + ' attached' : 'None']
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
    (photos.length ? '<p style="margin:6px 0">Photos are also saved in Google Drive: ' +
      photos.map(function (p, i) { return '<a href="' + esc_(p.url) + '">photo ' + (i + 1) + '</a>'; }).join(', ') + '</p>' : '') +
    '<p style="color:#777;font-size:13px">Also logged in your Lawn Lads quotes Google Sheet.</p></div>';

  var options = { htmlBody: html, name: 'The Lawn Lads website', attachments: photos.map(function (p) { return p.blob; }) };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) options.replyTo = q.email;
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, 'New quote request from ' + q.name + ' (' + q.phone + ', ' + q.email + ') for ' + q.postcode + '.', options);
}

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

/**
 * Optional: run this once from the editor (select "testSetup" and press Run)
 * to create the Quotes tab and check the email arrives, before going live.
 */
function testSetup() {
  getSheet_();
  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Lawn Lads quote form — test email',
    'If you can read this, quote emails will reach this inbox. You can delete this email.');
}
