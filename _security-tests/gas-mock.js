/*
 * Minimal mocks of the Google Apps Script services used by
 * quote-form-google-script.gs, so the real script can be exercised in Node.
 * Quirks copied from Apps Script: base64Decode returns SIGNED bytes (-128..127)
 * and throws on invalid input; computeDigest returns signed bytes.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

function signed(buf) { return Array.from(buf, (b) => (b > 127 ? b - 256 : b)); }

function load(scriptPath, opts) {
  opts = opts || {};
  const state = {
    rows: [], files: [], mails: [], logs: [], cache: new Map(), props: new Map(),
    mailQuota: opts.mailQuota == null ? 100 : opts.mailQuota, folders: 0, now: opts.now || new Date("2026-09-25T10:15:00Z"),
    fetches: [], triggers: [], trashed: [],
    // Replace to simulate Cloudflare / the live website: (url, options) => ({ code, body }) or throw
    fetch: opts.fetch || (() => { throw new Error("no network in tests"); })
  };
  const sheet = {
    appendRow(r) { state.rows.push(r.slice()); },
    getLastRow() { return state.rows.length; },
    getRange(row) { return { setFontWeight() {}, getCell(_r, c) { return { setValue(v) { state.rows[row - 1][c - 1] = v; } }; } }; },
    getDataRange() { return { getValues: () => state.rows.map((r) => r.slice()) }; },
    deleteRow(n) { state.rows.splice(n - 1, 1); },
    setFrozenRows() {}
  };
  const g = {
    console: {
      log: (...a) => state.logs.push(["log", a.join(" ")]),
      warn: (...a) => state.logs.push(["warn", a.join(" ")]),
      error: (...a) => state.logs.push(["error", a.join(" ")])
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput(s) { return { kind: "text", content: s, setMimeType() { return this; } }; }
    },
    HtmlService: { createHtmlOutput(s) { return { kind: "html", content: s }; } },
    LockService: { getScriptLock() { return { waitLock() {}, tryLock() { return true; }, releaseLock() {} }; } },
    CacheService: {
      getScriptCache() {
        return { get: (k) => (state.cache.has(k) ? state.cache.get(k) : null), put: (k, v) => { if (k.length > 250) throw new Error("key too long"); state.cache.set(k, String(v)); } };
      }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null),
          setProperty: (k, v) => { state.props.set(k, String(v)); },
          deleteProperty: (k) => { state.props.delete(k); },
          getKeys: () => Array.from(state.props.keys()),
          getProperties: () => Object.fromEntries(state.props)
        };
      }
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() { return { getSheetByName: () => sheet, insertSheet: () => sheet }; }
    },
    DriveApp: {
      getFolderById(id) { if (id !== "folder-1") throw new Error("not found"); return folder; },
      getFileById(id) {
        const f = state.files.find((x) => x.id === id);
        if (!f) throw new Error("File not found: " + id);
        const parents = [{ getId: () => f.parent }];
        return { getId: () => id, getParents: () => ({ hasNext: () => parents.length > 0, next: () => parents.shift() }), setTrashed: (v) => { if (v) state.trashed.push(id); } };
      },
      createFolder() { state.folders++; return folder; }
    },
    MailApp: {
      sendEmail(to, subject, body, options) {
        if (state.mailQuota <= 0) throw new Error("Service invoked too many times for one day: email.");
        state.mailQuota--; state.mails.push({ to, subject, body, options: options || {} });
      },
      getRemainingDailyQuota() { return state.mailQuota; }
    },
    UrlFetchApp: {
      fetch(url, options) {
        state.fetches.push({ url, options: options || {} });
        const r = state.fetch(url, options || {});
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      }
    },
    ScriptApp: {
      getProjectTriggers() { return state.triggers.slice(); },
      deleteTrigger(t) { state.triggers = state.triggers.filter((x) => x !== t); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyHours: (h) => { t.hours = h; return b; }, everyDays: (d) => { t.days = d; return b; }, atHour: (h) => { t.atHour = h; return b; }, create: () => { state.triggers.push(t); return t; } };
        return b;
      }
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      formatDate(d, _tz, fmt) {   // subset of Java SimpleDateFormat (UTC; tests avoid times near midnight)
        const p = (n) => String(n).padStart(2, "0");
        const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const t = { yyyy: d.getUTCFullYear(), MMM: MON[d.getUTCMonth()], MM: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), d: d.getUTCDate(), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()) };
        return fmt.replace(/yyyy|MMM|MM|dd|d|HH|mm/g, (k) => t[k]);
      },
      base64Decode(s) {
        s = String(s);
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) throw new Error("Could not decode string.");
        return signed(Buffer.from(s, "base64"));
      },
      base64EncodeWebSafe(bytes) { return Buffer.from(bytes.map((b) => b & 255)).toString("base64url"); },
      computeDigest(_alg, str) { return signed(crypto.createHash("sha256").update(String(str), "utf8").digest()); },
      getUuid() { return crypto.randomUUID(); },
      newBlob(bytes, type, name) { return { bytes, type, name, getBytes: () => bytes, getContentType: () => type, getName: () => name }; }
    },
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(state.now.getTime()); } static now() { return state.now.getTime(); } },
    JSON, Math, String, Number, Array, Object, RegExp, Error, parseInt, isNaN, isFinite
  };
  const folder = {
    getId: () => "folder-1",
    createFile(blob) {
      const id = "file-" + (state.files.length + 1);
      state.files.push({ id, parent: "folder-1", name: blob.getName(), type: blob.getContentType(), size: blob.getBytes().length, head: blob.getBytes().slice(0, 12) });
      return { getUrl: () => "https://drive.google.com/file/d/" + id + "/view", getId: () => id };
    }
  };
  vm.createContext(g);
  vm.runInContext(fs.readFileSync(scriptPath, "utf8"), g, { filename: scriptPath });
  return { g, state };
}

/* Build a doPost event the way Apps Script does for the two request styles. */
function jsonEvent(obj) {
  const contents = JSON.stringify(obj);
  return { postData: { type: "text/plain", contents, length: Buffer.byteLength(contents) }, parameter: {} };
}
function rawEvent(contents) {
  return { postData: { type: "text/plain", contents, length: Buffer.byteLength(contents) }, parameter: {} };
}
function formEvent(params) {
  const contents = new URLSearchParams(params).toString();
  return { postData: { type: "application/x-www-form-urlencoded", contents, length: contents.length }, parameter: params };
}
function parse(out) { return out.kind === "text" ? JSON.parse(out.content) : { html: out.content }; }

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), crypto.randomBytes(2000), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 "), crypto.randomBytes(500)]);
const EXE = Buffer.concat([Buffer.from("MZ"), crypto.randomBytes(1000)]);
const HTMLFILE = Buffer.from("<html><script>alert(1)</script></html>");

function validQuote(extra) {
  return Object.assign({
    name: "Sam Taylor", phone: "07700 900123", email: "sam@example.com", postcode: "LE10 1AA",
    area_check: "In area (Hinckley)", service: "Lawn mowing / grass cutting", lawn_size: "Medium (~50–150 m²)",
    description: "Back lawn, gate on the left.", page: "https://thelawnlads.co.uk/quote.html", _honey: "", _elapsed: 45000, photos: []
  }, extra || {});
}

module.exports = { load, jsonEvent, rawEvent, formEvent, parse, validQuote, JPEG, PNG, WEBP, EXE, HTMLFILE };
