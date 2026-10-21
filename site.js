/* The Lawn Lads — site behaviour. Settings live in config.js, not here. */
(function () {
  "use strict";
  var C = window.LAWN_LADS_CONFIG;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- apply settings to every link ---------- */
  var waHref = "https://wa.me/" + C.whatsappNumber + "?text=" + encodeURIComponent(C.whatsappMessage);
  $$("[data-wa]").forEach(function (a) { a.href = waHref; });
  $$("[data-tel]").forEach(function (a) { a.href = "tel:" + C.phoneInternational; });
  $$("[data-phone-text]").forEach(function (el) { el.textContent = C.phoneDisplay; });
  $$("[data-book]").forEach(function (a) { a.href = C.bookingUrl; });
  $$("[data-email]").forEach(function (a) { a.href = "mailto:" + C.contactEmail; });
  $$("[data-email-text]").forEach(function (el) { el.textContent = C.contactEmail; });

  /* ---------- visitor statistics (Cloudflare Web Analytics: no cookies) ---------- */
  // Not loaded for anyone who opted out on the privacy page (remembered in their browser only),
  // or whose browser sends Global Privacy Control or Do Not Track.
  var STATS_OFF_KEY = "lawnlads-no-stats";
  var statsOptedOut = function () { try { return window.localStorage.getItem(STATS_OFF_KEY) === "1"; } catch (e) { return false; } };
  var browserSaysNo = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1";
  if (/^[0-9a-f]{32}$/.test(C.analyticsToken || "") && !statsOptedOut() && !browserSaysNo) {
    var beacon = document.createElement("script");
    beacon.defer = true;
    beacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
    beacon.setAttribute("data-cf-beacon", JSON.stringify({ token: C.analyticsToken }));
    document.head.appendChild(beacon);
  }
  var statsBtn = $("[data-stats-toggle]"), statsNote = $("[data-stats-status]");
  if (statsBtn && statsNote) {
    var showStats = function () {
      statsBtn.hidden = browserSaysNo;
      statsBtn.textContent = statsOptedOut() ? "Turn visitor statistics back on" : "Turn off visitor statistics on this device";
      statsNote.textContent = browserSaysNo ? "Your browser asks websites not to track it, so this device isn't counted."
        : statsOptedOut() ? "Visitor statistics are off on this device." : "Visitor statistics are on for this device.";
    };
    statsBtn.addEventListener("click", function () {
      try {
        if (statsOptedOut()) window.localStorage.removeItem(STATS_OFF_KEY); else window.localStorage.setItem(STATS_OFF_KEY, "1");
      } catch (e) {
        statsNote.textContent = "Your browser didn't let us save that choice (private browsing can do this).";
        return;
      }
      showStats();
    });
    showStats();
  }

  /* ---------- mobile menu ---------- */
  var menuBtn = $(".menu-toggle");
  var nav = $("#site-nav");
  if (menuBtn && nav) {
    menuBtn.hidden = false;
    menuBtn.addEventListener("click", function () {
      var open = !nav.classList.contains("open");
      nav.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { var first = $("a", nav); if (first) first.focus(); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("open")) {
        nav.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
        menuBtn.focus();
      }
    });
  }

  /* ---------- postcode helpers ---------- */
  var PC_RE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})$/;
  function normalisePostcode(raw) {
    var s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var m = s.match(PC_RE);
    return m ? m[1] + " " + m[2] : null;
  }
  function milesBetween(lat1, lon1, lat2, lon2) {
    var R = 3958.8, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function nearestArea(lat, lon) {
    var best = null;
    C.serviceAreas.forEach(function (a) {
      var d = milesBetween(lat, lon, a.lat, a.lon);
      if (!best || d < best.miles) best = { name: a.name, miles: d };
    });
    return best;
  }
  var AREA_NAMES = C.serviceAreas.map(function (a) { return a.name.toLowerCase(); });
  function nameMatchesArea(value) {
    if (!value) return null;
    var v = String(value).toLowerCase();
    for (var i = 0; i < AREA_NAMES.length; i++) {
      var n = AREA_NAMES[i];
      if (v === n || v.indexOf(n + " ") === 0 || v.indexOf(n + ",") === 0) return C.serviceAreas[i].name;
    }
    return null;
  }

  var cache = {};
  function lookupPostcode(pc) {
    if (cache[pc]) return cache[pc];
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 6000) : null;
    var p = fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(pc), ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (r.status === 404) return { status: "notfound", postcode: pc };
        if (!r.ok) throw new Error("lookup failed");
        return r.json().then(function (body) { return classify(pc, body.result); });
      })
      .catch(function () { return offlineClassify(pc); });
    cache[pc] = p;
    p.then(function (res) { if (res.status === "offline-in" || res.status === "offline-out") delete cache[pc]; });
    return p;
  }
  function classify(pc, r) {
    var near = nearestArea(r.latitude, r.longitude);
    var place = nameMatchesArea(r.parish) || nameMatchesArea(r.bua) || nameMatchesArea(r.admin_ward);
    var base = { postcode: pc, nearest: near.name, miles: near.miles, place: place };
    if (place) { base.status = "in"; return base; }
    base.status = near.miles <= 1.5 ? "edge" : near.miles <= 10 ? "near" : "far";
    return base;
  }
  function offlineClassify(pc) {
    var sector = pc.slice(0, pc.length - 2);
    var inList = C.fallbackSectors.indexOf(sector) !== -1;
    return { postcode: pc, status: inList ? "offline-in" : "offline-out" };
  }
  function areaSummary(res) {
    var mi = res.miles != null ? res.miles.toFixed(1) + " mi from " + res.nearest : "";
    switch (res.status) {
      case "in": return "In area (" + res.place + ")";
      case "edge": return "OUTSIDE — on the edge, " + mi;
      case "near": return "OUTSIDE — " + mi;
      case "far": return "OUTSIDE — far, " + mi;
      case "offline-in": return "Probably in area (offline check of postcode sector — confirm)";
      case "offline-out": return "Probably outside (offline check — confirm)";
      case "notfound": return "Postcode not found by lookup";
      default: return "Not checked";
    }
  }
  function isInside(res) { return res.status === "in" || res.status === "offline-in"; }

  /* ---------- postcode checker (home page) ---------- */
  var checkerForm = $("#checker-form");
  if (checkerForm) {
    var checkerInput = $("#checker-postcode");
    var checkerResult = $("#checker-result");
    var renderCheck = function (res) {
      var quoteHref = "quote.html?postcode=" + encodeURIComponent(res.postcode || "") + "#quote-form";
      var quoteBtn = '<a class="btn btn-primary" href="' + quoteHref + '">Get a quote</a>';
      var bookBtn = '<a class="btn btn-ghost" href="' + escapeHtml(C.bookingUrl) + '" target="_blank" rel="noopener noreferrer">Book a service</a>';
      var anywayBtn = '<a class="btn btn-primary" href="' + quoteHref + '">Request a quote anyway</a>';
      var html = "";
      if (res.status === "in") {
        html = '<div class="result-box in"><strong class="headline">Good news! We cover your area 🌱</strong>' +
               '<p>' + escapeHtml(res.postcode) + ' is in ' + escapeHtml(res.place) + '.</p>' +
               '<div class="result-actions">' + quoteBtn + bookBtn + '</div></div>';
      } else if (res.status === "offline-in") {
        html = '<div class="result-box in"><strong class="headline">Good news! That looks like our area 🌱</strong>' +
               '<p>Couldn\'t double-check the exact address just now, so I\'ll confirm when I reply.</p>' +
               '<div class="result-actions">' + quoteBtn + bookBtn + '</div></div>';
      } else if (res.status === "edge" || res.status === "near") {
        var extra = res.status === "edge"
          ? "You're only about " + res.miles.toFixed(1) + " miles from " + res.nearest + ", so it's worth asking."
          : "The nearest place we cover is " + res.nearest + ", about " + res.miles.toFixed(1) + " miles away. Send a request anyway — if enough people nearby ask, we'll start covering it.";
        html = '<div class="result-box out"><strong class="headline">You\'re just outside our current service area.</strong>' +
               '<p>' + escapeHtml(extra) + '</p><div class="result-actions">' + anywayBtn + '</div></div>';
      } else if (res.status === "far") {
        html = '<div class="result-box out"><strong class="headline">That\'s outside the area we cover right now.</strong>' +
               '<p>' + escapeHtml(res.postcode) + ' is about ' + Math.round(res.miles) + ' miles from ' + escapeHtml(res.nearest) + '. You can still send a request and we\'ll let you know.</p>' +
               '<div class="result-actions">' + anywayBtn + '</div></div>';
      } else if (res.status === "offline-out") {
        html = '<div class="result-box out"><strong class="headline">You\'re just outside our current service area.</strong>' +
               '<p>At least, it looks that way — the postcode lookup isn\'t responding, so I\'ll double-check when I reply.</p>' +
               '<div class="result-actions">' + anywayBtn + '</div></div>';
      } else if (res.status === "notfound") {
        html = '<div class="result-box error"><strong class="headline">We couldn\'t find ' + escapeHtml(res.postcode) + '.</strong><p>Check it for typos and try again.</p></div>';
      } else if (res.status === "invalid") {
        html = '<div class="result-box error"><strong class="headline">That doesn\'t look like a full UK postcode.</strong><p>Try the whole thing, like LE10 1AA.</p></div>';
      }
      checkerResult.innerHTML = html;
    };
    checkerForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var pc = normalisePostcode(checkerInput.value);
      if (!pc) { renderCheck({ status: "invalid" }); checkerInput.setAttribute("aria-invalid", "true"); checkerInput.focus(); return; }
      checkerInput.removeAttribute("aria-invalid");
      checkerInput.value = pc;
      checkerResult.innerHTML = '<p class="checking">Checking ' + escapeHtml(pc) + '…</p>';
      lookupPostcode(pc).then(renderCheck);
    });
  }

  /* ---------- quote form (quote page) ---------- */
  var form = $("#quote-form");
  if (form) {
    var successBox = $("#quote-success");
    var statusEl = $("#q-status");
    var submitBtn = $("#q-submit");
    var areaChip = $("#q-postcode-area");
    var pcInput = $("#q-postcode");

    var showAreaChip = function (res) {
      if (!res || res.status === "invalid" || res.status === "notfound") { areaChip.textContent = ""; areaChip.className = "area-chip"; return; }
      if (isInside(res)) { areaChip.textContent = "✓ We cover this area"; areaChip.className = "area-chip in"; }
      else { areaChip.textContent = "Just outside our usual area — send it anyway and we'll let you know."; areaChip.className = "area-chip out"; }
    };
    var checkFormPostcode = function () {
      var pc = normalisePostcode(pcInput.value);
      if (!pc) { showAreaChip(null); return; }
      pcInput.value = pc;
      lookupPostcode(pc).then(function (res) {
        if (normalisePostcode(pcInput.value) !== pc) return;
        showAreaChip(res);
        form.querySelector('[name="area_check"]').value = areaSummary(res);
      });
    };

    var params = new URLSearchParams(location.search);
    // Thank-you message after FormSubmit sends people back here
    if (params.get("quote") === "sent") {
      form.hidden = true;
      successBox.hidden = false;
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
      setTimeout(function () { successBox.focus(); }, 300);
    }
    // Postcode carried over from the checker on the home page
    if (params.get("postcode")) {
      pcInput.value = params.get("postcode");
      checkFormPostcode();
    }

    // Settings -> form (JS handles validation with friendlier messages)
    form.noValidate = true;
    if (C.quoteEndpoint) form.action = C.quoteEndpoint;

    var errors = {
      name: function (v) {
        v = v.trim();
        if (v.length < 2) return "Please add your name.";
        return /[<>]|https?:|www\.|\/\//i.test(v) ? "Please add your name without links or < > symbols." : "";
      },
      phone: function (v) {
        var d = v.replace(/[\s\-().]/g, "");
        if (!d) return "Please add a phone number so I can reach you.";
        return /^(?:\+44|0044|0)\d{9,10}$/.test(d) ? "" : "That doesn't look like a UK phone number.";
      },
      email: function (v) {
        if (!v.trim()) return "Please add your email.";
        // Same rule as the Google Script: one plain address, nothing that could add extra recipients
        return /^[^\s@<>()\[\]",;:\\]+@[^\s@<>()\[\]",;:\\]+\.[^\s@<>()\[\]",;:\\]{2,}$/.test(v.trim()) ? "" : "That email address doesn't look quite right.";
      },
      postcode: function (v) {
        if (!v.trim()) return "Please add your postcode.";
        return normalisePostcode(v) ? "" : "Please enter a full UK postcode, like LE10 1AA.";
      },
      service: function (v) { return v ? "" : "Please pick what you need."; }
    };
    var fieldIds = { name: "q-name", phone: "q-phone", email: "q-email", postcode: "q-postcode", service: "q-service" };
    var attempted = false;

    var validateField = function (key) {
      var input = $("#" + fieldIds[key]);
      var msg = errors[key](input.value);
      $("#" + fieldIds[key] + "-err").textContent = msg;
      if (msg) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
      return !msg;
    };
    var validateSize = function () {
      var picked = form.querySelector('[name="lawn_size"]:checked');
      $("#q-size-err").textContent = picked ? "" : "Please pick a size — \"I don't know\" is fine.";
      $("#q-size-options").classList.toggle("invalid", !picked);
      return !!picked;
    };
    Object.keys(fieldIds).forEach(function (key) {
      var input = $("#" + fieldIds[key]);
      input.addEventListener("blur", function () { if (attempted || input.value) validateField(key); });
      input.addEventListener("input", function () { if (input.getAttribute("aria-invalid")) validateField(key); });
    });
    $$('[name="lawn_size"]').forEach(function (r) { r.addEventListener("change", function () { if (attempted) validateSize(); }); });
    var clearStatusIfFixed = function () {
      if (!statusEl.classList.contains("error") || submitBtn.disabled) return;
      var stillBad = $$(".field-error", form).some(function (el) { return el.textContent.trim() && el.id !== "q-photos-err"; });
      if (!stillBad) { statusEl.textContent = ""; statusEl.className = "form-status"; }
    };
    form.addEventListener("input", clearStatusIfFixed);
    form.addEventListener("change", clearStatusIfFixed);
    pcInput.addEventListener("blur", checkFormPostcode);

    /* photos: pick, preview, shrink */
    var MAX_PHOTOS = 3;
    var MAX_BYTES = 10 * 1024 * 1024;
    var OK_TYPES = ["image/jpeg", "image/png", "image/webp"];
    var photos = [];
    var picker = $("#q-photos-picker");
    var thumbs = $("#q-thumbs");
    var photoErr = $("#q-photos-err");
    var dropzone = $("#q-dropzone");
    var nextId = 1;

    var shrink = function (file) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var maxSide = 1600;
            var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
            var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
            var canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            // Always send the re-drawn copy: it drops hidden data (like GPS location) and anything that isn't picture
            canvas.toBlob(function (blob) {
              URL.revokeObjectURL(url);
              if (!blob) { resolve(file); return; }
              var name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
              try { resolve(new File([blob], name, { type: "image/jpeg" })); }
              catch (e) { blob.name = name; resolve(blob); }
            }, "image/jpeg", 0.82);
          } catch (e) { URL.revokeObjectURL(url); resolve(file); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };   // not a picture the browser can read
        img.src = url;
      });
    };
    var renderThumbs = function () {
      thumbs.innerHTML = "";
      photos.forEach(function (p, i) {
        var div = document.createElement("div");
        div.className = "thumb";
        var img = document.createElement("img");
        img.src = p.url; img.alt = "Garden photo " + (i + 1);
        var btn = document.createElement("button");
        btn.type = "button"; btn.textContent = "×";
        btn.setAttribute("aria-label", "Remove photo " + (i + 1));
        btn.addEventListener("click", function () {
          URL.revokeObjectURL(p.url);
          photos = photos.filter(function (x) { return x.id !== p.id; });
          renderThumbs();
          photoErr.textContent = "";
          picker.focus();
        });
        div.appendChild(img); div.appendChild(btn);
        thumbs.appendChild(div);
      });
      dropzone.hidden = photos.length >= MAX_PHOTOS;
    };
    var addFiles = function (fileList) {
      var msgs = [];
      Array.prototype.forEach.call(fileList, function (f) {
        if (photos.length >= MAX_PHOTOS) { msgs.push("Only " + MAX_PHOTOS + " photos can be added — the rest were left out."); return; }
        var typeOk = OK_TYPES.indexOf(f.type) !== -1 || /\.(jpe?g|png|webp)$/i.test(f.name);
        if (!typeOk) { msgs.push(f.name + " isn't a JPG, PNG or WEBP."); return; }
        if (f.size > MAX_BYTES) { msgs.push(f.name + " is over 10MB — try a smaller one."); return; }
        var entry = { id: nextId++, original: f, ready: shrink(f), url: URL.createObjectURL(f) };
        entry.ready.then(function (out) {
          if (out) return;
          URL.revokeObjectURL(entry.url);
          photos = photos.filter(function (x) { return x.id !== entry.id; });
          renderThumbs();
          photoErr.textContent = (photoErr.textContent ? photoErr.textContent + " " : "") + f.name + " couldn't be read as a photo — try a JPG instead.";
        });
        photos.push(entry);
      });
      photoErr.textContent = msgs.filter(function (m, i, a) { return a.indexOf(m) === i; }).join(" ");
      renderThumbs();
    };
    picker.addEventListener("change", function () { addFiles(picker.files); picker.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("drag"); });
    });
    dropzone.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

    var toBase64 = function (file) {
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
        r.onerror = function () { reject(new Error("read failed")); };
        r.readAsDataURL(file);
      });
    };
    /* bot check (Cloudflare Turnstile): only loads when a site key is set in config.js */
    var bot = null;
    var botBox = $("#q-bot-check");
    if (C.turnstileSiteKey && botBox) {
      bot = { token: "", widget: null, gaveUp: false, waiting: [] };
      var botAnswer = function (token) {
        bot.token = token || "";
        var waiting = bot.waiting; bot.waiting = [];
        waiting.forEach(function (resolve) { resolve(bot.token); });
      };
      var ts = document.createElement("script");
      ts.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      ts.async = true;
      ts.onload = function () {
        try {
          bot.widget = window.turnstile.render(botBox, {
            sitekey: C.turnstileSiteKey,
            action: "quote",                    // the Google Script only accepts tokens made for this form
            appearance: "interaction-only",     // invisible unless Cloudflare needs the visitor to tick a box
            callback: botAnswer,
            "expired-callback": function () { bot.token = ""; }
          });
        } catch (e) { bot.gaveUp = true; botAnswer(""); }
      };
      ts.onerror = function () { bot.gaveUp = true; botAnswer(""); };
      document.head.appendChild(ts);
      $$("[data-bot-note]").forEach(function (el) { el.hidden = false; });
    }
    // A token, or "" if the check couldn't run. The Google Script decides what happens without one,
    // so a problem loading Cloudflare never stops the form on its own.
    var botToken = function () {
      if (!bot || bot.token || bot.gaveUp) return Promise.resolve(bot ? bot.token : undefined);
      return new Promise(function (resolve) {
        bot.waiting.push(resolve);
        setTimeout(function () { resolve(bot.token); }, 20000);
      });
    };
    // Each token works once, so get a fresh one after every attempt
    var botReset = function () {
      if (!bot || bot.widget == null || !window.turnstile) return;
      bot.token = "";
      try { window.turnstile.reset(bot.widget); } catch (e) {}
    };

    var fail = function (message, canRetry) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send my quote request";
      statusEl.className = "form-status error";
      var wa = '<a class="text-link" href="' + escapeHtml(waHref) + '" target="_blank" rel="noopener noreferrer">send it on WhatsApp</a>';
      var tel = '<a class="text-link" href="tel:' + escapeHtml(C.phoneInternational) + '">' + escapeHtml(C.phoneDisplay) + '</a>';
      statusEl.innerHTML = escapeHtml(message) +
        (canRetry ? ' If it keeps happening, ' + wa + ' or call ' + tel + '.' : ' Please ' + wa + ' or call ' + tel + ' instead.');
    };
    var showSuccess = function () {
      form.hidden = true;
      successBox.hidden = false;
      successBox.scrollIntoView({ block: "start" });
      successBox.focus({ preventScroll: true });
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      attempted = true;
      statusEl.textContent = ""; statusEl.className = "form-status";
      var ok = true, firstBad = null;
      Object.keys(fieldIds).forEach(function (key) {
        if (!validateField(key)) { ok = false; firstBad = firstBad || $("#" + fieldIds[key]); }
      });
      if (!validateSize()) { ok = false; firstBad = firstBad || form.querySelector('[name="lawn_size"]'); }
      if (!ok) {
        statusEl.textContent = "A couple of things need fixing — they're marked in red above.";
        statusEl.className = "form-status error";
        firstBad.focus();
        return;
      }
      if (!C.quoteEndpoint) {
        fail("Sorry, online quotes aren't switched on just yet.");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = photos.length ? "Preparing photos…" : "Sending…";

      var pc = normalisePostcode(pcInput.value);
      pcInput.value = pc;
      var sizePicked = form.querySelector('[name="lawn_size"]:checked');

      if (bot && !bot.token && !bot.gaveUp) submitBtn.textContent = "Checking you're not a robot…";
      Promise.all([lookupPostcode(pc), Promise.all(photos.map(function (p) { return p.ready; })), botToken()]).then(function (out) {
        var area = out[0], files = out[1].filter(Boolean), token = out[2];
        var total = files.reduce(function (sum, f) { return sum + f.size; }, 0);
        if (total > 12 * 1024 * 1024) {
          throw new Error("TOO_BIG");
        }
        return Promise.all(files.map(toBase64)).then(function (encoded) {
          submitBtn.textContent = "Sending…";
          var payload = {
            name: $("#q-name").value.trim(),
            phone: $("#q-phone").value.trim(),
            email: $("#q-email").value.trim(),
            postcode: pc,
            area_check: areaSummary(area),
            service: $("#q-service").value,
            lawn_size: sizePicked ? sizePicked.value : "",
            description: $("#q-desc").value.trim(),
            page: location.origin + location.pathname,
            _honey: $("#hp-honey").value,
            _elapsed: window.performance && performance.now ? Math.round(performance.now()) : null,   // time on page; bots are instant
            _turnstile: token,
            photos: files.map(function (f, i) {
              return { name: f.name || ("photo-" + (i + 1) + ".jpg"), type: f.type || "image/jpeg", data: encoded[i] };
            })
          };
          // text/plain keeps this a "simple" request, which Google Apps Script accepts from any site
          return fetch(C.quoteEndpoint, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload),
            redirect: "follow"
          });
        });
      }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      }).then(function (body) {
        botReset();
        if (body && body.ok) showSuccess();
        else fail((body && body.error) || "That didn't go through.", body && body.code === "robot");
      }).catch(function (err) {
        botReset();
        if (err && err.message === "TOO_BIG") fail("Those photos are too big to send together — try removing one.");
        else fail("That didn't go through — it might be your connection.");
      });
    });

    window.addEventListener("pageshow", function () {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send my quote request";
    });
  }

  /* ---------- before & after: category labels, filters, lightbox ---------- */
  var CATEGORY_LABELS = {
    mowing: "Lawn mowing",
    overgrown: "Overgrown lawns",
    tidy: "Garden tidy-ups",
    hedge: "Hedge trimming",
    oneoff: "One-off jobs"
  };
  var jobs = $$(".jobs .job");
  jobs.forEach(function (job) {
    var label = $("[data-cat-label]", job);
    if (label) label.textContent = CATEGORY_LABELS[job.dataset.category] || "";
  });

  var filterBar = $("#gallery-filters");
  if (filterBar && jobs.length) {
    var present = [];
    jobs.forEach(function (j) { if (present.indexOf(j.dataset.category) === -1) present.push(j.dataset.category); });
    if (present.length > 1) {
      var cats = ["all"].concat(Object.keys(CATEGORY_LABELS).filter(function (k) { return present.indexOf(k) !== -1; }));
      cats.forEach(function (cat) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "filter-chip";
        var count = cat === "all" ? jobs.length : jobs.filter(function (j) { return j.dataset.category === cat; }).length;
        b.textContent = (cat === "all" ? "All jobs" : CATEGORY_LABELS[cat]) + " (" + count + ")";
        b.setAttribute("aria-pressed", cat === "all" ? "true" : "false");
        b.addEventListener("click", function () {
          $$(".filter-chip", filterBar).forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          jobs.forEach(function (j) { j.hidden = !(cat === "all" || j.dataset.category === cat); });
        });
        filterBar.appendChild(b);
      });
      filterBar.hidden = false;
    }
  }

  var lb = $("#lightbox");
  if (lb && jobs.length) {
    var lbIndex = 0;
    var visibleJobs = function () { return jobs.filter(function (j) { return !j.hidden; }); };
    var fillLightbox = function () {
      var list = visibleJobs();
      var job = list[lbIndex];
      var figs = $$(".ba-card", job);
      $("#lb-title").textContent = $("h3", job).textContent;
      [["#lb-before", "#lb-before-tag", figs[0]], ["#lb-after", "#lb-after-tag", figs[1]]].forEach(function (t) {
        var img = $("img", t[2]);
        $(t[0]).src = img.currentSrc || img.src;
        $(t[0]).alt = img.alt;
        $(t[1]).textContent = $(".ba-tag", t[2]).textContent;
      });
      $("#lb-note").textContent = $(".job-meta p", job).textContent;
      $("#lb-nav").hidden = list.length < 2;
      $("#lb-count").textContent = (lbIndex + 1) + " of " + list.length;
    };
    var openLightbox = function (job) {
      lbIndex = Math.max(0, visibleJobs().indexOf(job));
      fillLightbox();
      if (typeof lb.showModal === "function") lb.showModal(); else lb.setAttribute("open", "");
    };
    var closeLightbox = function () { if (lb.close) lb.close(); else lb.removeAttribute("open"); };
    var step = function (d) {
      var n = visibleJobs().length;
      lbIndex = (lbIndex + d + n) % n;
      fillLightbox();
    };
    jobs.forEach(function (job) {
      $$(".ba-open, .job-open", job).forEach(function (btn) {
        btn.addEventListener("click", function () { openLightbox(job); });
      });
    });
    $(".lb-close", lb).addEventListener("click", closeLightbox);
    $("#lb-prev").addEventListener("click", function () { step(-1); });
    $("#lb-next").addEventListener("click", function () { step(1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) closeLightbox(); });
    lb.addEventListener("keydown", function (e) {
      if (visibleJobs().length < 2) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    });
  }

  /* ---------- FAQ structured data, built from the FAQ on the page ---------- */
  var faqDetails = $$("#faq details");
  if (faqDetails.length) {
    var ld = document.createElement("script");
    ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqDetails.map(function (d) {
        return {
          "@type": "Question",
          name: $("summary", d).textContent.trim(),
          acceptedAnswer: { "@type": "Answer", text: $(".faq-answer", d).textContent.trim().replace(/\s+/g, " ") }
        };
      })
    });
    document.head.appendChild(ld);
  }

  /* ---------- home page scroll effects ---------- */
  // The lawn that gets mown, price cards tilting in, the photo stack and the mown path. They only
  // animate when FX_QUERY matches, which is the same media query site.css uses for the pinned
  // layout, so "reduce motion", older browsers and JavaScript-off visitors all get the still page.
  var FX_QUERY = "(scripting: enabled) and (prefers-reduced-motion: no-preference)";
  var lawnCanvas = $("#lawn"), stackEl = $("#stack"), howPath = $("#how-path");
  if (lawnCanvas || stackEl || howPath) {
    var fx = !!(window.matchMedia && window.matchMedia(FX_QUERY).matches);
    var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
    var easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
    var rootCss = getComputedStyle(document.documentElement);
    var token = function (name) { return rootCss.getPropertyValue(name).trim(); };
    // How far through a pinned scene we are: 0 when its stage first sticks, 1 when it lets go
    var sceneProgress = function (stage) {
      var r = stage.parentNode.getBoundingClientRect();
      var run = r.height - stage.offsetHeight;
      return run > 0 ? clamp(((parseFloat(getComputedStyle(stage).top) || 0) - r.top) / run, 0, 1) : 0;
    };

    /* the lawn in the hero */
    var lawn = lawnCanvas && (function () {
      var ctx = lawnCanvas.getContext("2d");
      var wrap = $("#lawn-wrap"), status = $("#lawn-status"), bar = $("#lawn-bar"), barFill = $("#lawn-bar span"), hint = $("#mow-hint");
      var P = {
        base: token("--grass-base"), dark: token("--grass-dark"), olive: token("--grass-olive"), green: token("--grass-green"),
        straw: token("--straw"), straw2: token("--straw-2"), pale: token("--straw-pale"),
        daisy: token("--surface"), dandelion: token("--dandelion"), dandelionDk: token("--dandelion-dk"),
        stripeA: token("--stripe-a"), stripeB: token("--stripe-b"), cutLight: token("--cut-light"), cutDark: token("--cut-dark"),
        ink: token("--ink"), body: token("--accent"), bag: token("--mower-bag")
      };
      var w = 0, h = 0, dpr = 1, rows = 4, rowH = 0, L = 0, Wd = 0, longGrass = null, stripes = null, shownStatus = "";
      // The same "random" grass every time, so it doesn't change when the page is resized
      var seeded = function (seed) {
        return function () {
          seed = seed + 0x6D2B79F5 | 0;
          var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      };
      var layer = function () {
        var c = document.createElement("canvas");
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
        c.getContext("2d").scale(dpr, dpr);
        return c;
      };
      var drawLongGrass = function () {
        var c = layer(), x = c.getContext("2d"), r = seeded(7), i;
        var under = [P.dark, P.olive, P.green], over = [P.green, P.straw, P.straw2, P.pale];
        var count = Math.round(w * h / 14);
        x.fillStyle = P.base; x.fillRect(0, 0, w, h);
        x.lineCap = "round";
        for (i = 0; i < count; i++) {
          var set = i > count * 0.45 ? over : under;
          var px = r() * w, py = r() * h, len = 7 + r() * 16, bend = (r() - 0.5) * 6;
          var ang = -0.75 + (r() - 0.5) * 1.1 + Math.sin(px * 0.02 + py * 0.015) * 0.35;
          var ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
          x.strokeStyle = set[Math.floor(r() * set.length)];
          x.globalAlpha = 0.55 + r() * 0.45; x.lineWidth = 0.8 + r() * 1.4;
          x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo((px + ex) / 2 + bend, (py + ey) / 2 - bend, ex, ey); x.stroke();
        }
        x.globalAlpha = 1;
        // dandelions and daisies, gone once it's cut
        for (i = Math.round(w * h / 6500); i > 0; i--) {
          var fx0 = r() * w, fy0 = r() * h, daisy = r() < 0.4, s = 2.2 + r() * 1.6;
          x.fillStyle = daisy ? P.daisy : P.dandelion; x.beginPath(); x.arc(fx0, fy0, s, 0, Math.PI * 2); x.fill();
          x.fillStyle = daisy ? P.dandelion : P.dandelionDk; x.beginPath(); x.arc(fx0, fy0, s * 0.42, 0, Math.PI * 2); x.fill();
        }
        return c;
      };
      var drawStripes = function () {
        var c = layer(), x = c.getContext("2d"), r = seeded(11), i;
        for (i = 0; i < rows; i++) { x.fillStyle = i % 2 ? P.stripeB : P.stripeA; x.fillRect(0, i * rowH, w, rowH + 1); }
        x.lineCap = "round"; x.lineWidth = 1;
        for (i = Math.round(w * h / 28); i > 0; i--) {
          var px = r() * w, py = r() * h, dir = Math.floor(py / rowH) % 2 ? -1 : 1;
          x.strokeStyle = r() < 0.5 ? P.cutLight : P.cutDark; x.globalAlpha = 0.18 + r() * 0.22;
          x.beginPath(); x.moveTo(px, py); x.lineTo(px + dir * (2 + r() * 3), py + (r() - 0.5) * 1.5); x.stroke();
        }
        x.globalAlpha = 1;
        return c;
      };
      var box = function (x, y, bw, bh, rad) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, rad); else ctx.rect(x, y, bw, bh);
      };
      // Seen from above, facing the way it's going, with the handle trailing behind
      var drawMower = function (cx, cy, dir, done) {
        if (cx < -L * 1.3 || cx > w + L * 1.3) return;
        var hw = Wd / 2;
        ctx.save();
        ctx.translate(cx, cy + Math.sin(cx * 0.35) * 0.6);   // a little engine judder
        ctx.scale(dir, 1);
        ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = P.ink;
        ctx.lineWidth = 3; ctx.beginPath();
        ctx.moveTo(-L * 0.45, -hw * 0.55); ctx.lineTo(-L * 1.05, -hw * 0.62);
        ctx.moveTo(-L * 0.45, hw * 0.55); ctx.lineTo(-L * 1.05, hw * 0.62); ctx.stroke();
        ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-L * 1.05, -hw * 0.72); ctx.lineTo(-L * 1.05, hw * 0.72); ctx.stroke();
        // hard shadow (same offset as the buttons) and wheels
        ctx.fillStyle = P.ink;
        box(-L * 0.52 + 3 * dir, -hw + 3, L * 1.02, Wd, 9); ctx.fill();
        [-L * 0.14, L * 0.3].forEach(function (wx) {
          box(wx, -hw - 5, L * 0.16, 8, 2); ctx.fill();
          box(wx, hw - 3, L * 0.16, 8, 2); ctx.fill();
        });
        // grass box, filling up as the job goes on
        ctx.lineWidth = 2.5;
        box(-L * 0.52, -hw * 0.82, L * 0.38, hw * 1.64, 4); ctx.fillStyle = P.bag; ctx.fill(); ctx.stroke();
        ctx.fillStyle = P.stripeB;
        ctx.fillRect(-L * 0.52 + 4, -hw * 0.82 + 4, Math.max(0, (L * 0.38 - 8) * done), hw * 1.64 - 8);
        // deck and engine
        box(-L * 0.2, -hw, L * 0.7, Wd, 10); ctx.fillStyle = P.body; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(L * 0.17, 0, Wd * 0.21, 0, Math.PI * 2); ctx.fillStyle = P.bag; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(L * 0.17, 0, Wd * 0.08, 0, Math.PI * 2); ctx.fillStyle = P.body; ctx.fill();
        ctx.restore();
      };
      var build = function () {
        var r = wrap.getBoundingClientRect(), nw = Math.round(r.width), nh = Math.round(r.height);
        if (!nw || !nh || (nw === w && nh === h)) return;
        w = nw; h = nh;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        lawnCanvas.width = Math.round(w * dpr); lawnCanvas.height = Math.round(h * dpr);
        rows = clamp(Math.round(h / 80), 3, 6); rowH = h / rows;
        Wd = rowH * 0.78; L = Wd * 1.15;
        longGrass = drawLongGrass(); stripes = drawStripes();
      };
      // done: 0 = not started, 1 = finished. The mower does one row at a time, back and forth,
      // starting just inside the left edge and finishing with its handle clear of the lawn.
      var draw = function (done) {
        if (!longGrass) return;
        var span = w + 1.65 * L, start = 1.1 * L;
        var d = start + done * (rows * span - start);
        var row = Math.min(rows - 1, Math.floor(d / span)), t = d - row * span;
        var dir = row % 2 ? -1 : 1;
        var cx = dir === 1 ? t - 0.55 * L : w + 0.55 * L - t;
        var y0 = row * rowH, y1 = y0 + rowH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(stripes, 0, 0, w, h);
        // Still long: the rest of this row and every row below it. Its edge casts a hard shadow.
        var from = dir === 1 ? clamp(cx, 0, w) : 0, to = dir === 1 ? w : clamp(cx, 0, w);
        var uncut = new Path2D(), shadow = new Path2D();
        if (to > from) { uncut.rect(from, y0, to - from, rowH); shadow.rect(dir === 1 ? from - 4 : from, y0 - 4, to - from + 4, rowH + 4); }
        if (y1 < h - 0.5) { uncut.rect(0, y1, w, h - y1); shadow.rect(0, y1 - 4, w, h - y1 + 4); }
        ctx.globalAlpha = 0.26; ctx.fillStyle = P.ink; ctx.fill(shadow); ctx.globalAlpha = 1;
        ctx.save(); ctx.clip(uncut); ctx.drawImage(longGrass, 0, 0, w, h); ctx.restore();
        drawMower(cx, y0 + rowH / 2, dir, done);
      };
      var show = function (progress) {
        var done = clamp((progress - 0.04) / 0.86, 0, 1);
        draw(done);
        var text = done <= 0 ? "Overgrown · not started" : done >= 1 ? "Done · clippings taken away" : Math.round(done * 100) + "% cut";
        if (text !== shownStatus) { status.textContent = text; shownStatus = text; }
        barFill.style.width = (done * 100).toFixed(1) + "%";
        hint.style.opacity = String(1 - clamp(done * 5, 0, 1));
      };
      if (fx) { status.hidden = false; bar.hidden = false; hint.hidden = false; }
      return { build: build, draw: draw, show: show };
    })();

    /* price cards tilt into place as they arrive */
    var priceCards = fx ? $$(".home-prices .price-card") : [];
    var priceRise = [];
    var tiltPrices = function () {
      var vh = window.innerHeight;
      var sameRow = priceCards.length > 1 && priceCards[0].offsetTop === priceCards[1].offsetTop;
      priceCards.forEach(function (card, i) {
        var top = card.getBoundingClientRect().top - (priceRise[i] || 0);   // where it sits without the effect
        var v = clamp((vh - top) / (vh * 0.45) - (sameRow ? i * 0.14 : 0), 0, 1);
        var e = 1 - Math.pow(1 - v, 3);
        priceRise[i] = (1 - e) * 70;
        card.style.setProperty("--rise", priceRise[i].toFixed(1) + "px");
        card.style.setProperty("--tilt", ((1 - e) * (i % 2 ? 7 : -7)).toFixed(2) + "deg");
      });
    };

    /* our work: flick through the photos like a stack of prints */
    var stack = stackEl && fx && (function () {
      var wrap = $("#stack-wrap"), cards = $$(".stack-photo", stackEl), n = cards.length;
      var caption = $("#stack-caption"), tag = $("#cap-tag"), title = $("#cap-title"), line = $("#cap-line"), dotsBox = $("#cap-dots");
      var lean = [0, 3, -2.5, 2, -3, 2.5];   // how the photos underneath sit in the pile
      var dots = cards.map(function () { var d = document.createElement("i"); dotsBox.appendChild(d); return d; });
      var cardW = 300, shown = -1;
      caption.hidden = false;
      var size = function () {
        var r = wrap.getBoundingClientRect();
        var ch = Math.max(170, Math.min(r.height - 20, (r.width - 24) / 0.75, 640));
        cardW = ch * 0.75;
        stackEl.style.setProperty("--stack-w", cardW.toFixed(1) + "px");
        stackEl.style.setProperty("--stack-h", ch.toFixed(1) + "px");
      };
      var setCaption = function (i) {
        var card = cards[i], after = !!$(".ba-tag.after", card);
        shown = i;
        tag.textContent = after ? "After" : "Before";
        tag.classList.toggle("after", after);
        title.textContent = card.getAttribute("data-title");
        line.textContent = $("figcaption", card).textContent;
        dots.forEach(function (d, k) { d.classList.toggle("on", k === i); d.classList.toggle("seen", k < i); });
        caption.classList.remove("swap"); void caption.offsetWidth; caption.classList.add("swap");
      };
      var show = function (progress) {
        var f = clamp((progress - 0.05) / 0.88, 0, 1) * (n - 1);
        var oneWay = window.innerWidth > 820;   // beside the text: always flick away from it
        cards.forEach(function (card, k) {
          var away = easeInOut(clamp(f - k, 0, 1));   // 0 on the pile, 1 flicked off
          var depth = Math.max(0, k - f), d3 = Math.min(depth, 3);
          var side = oneWay || k % 2 ? 1 : -1;
          card.style.transform = "translate(" + (side * away * cardW * 1.3).toFixed(1) + "px," + (d3 * 11 - away * 40).toFixed(1) + "px) rotate(" +
            (side * away * 22 + lean[k % lean.length] * Math.min(depth, 1)).toFixed(2) + "deg) scale(" + (1 - d3 * 0.035).toFixed(3) + ")";
          card.style.opacity = depth > 3.2 ? "0" : String(1 - clamp((away - 0.55) / 0.45, 0, 1));
        });
        var top = Math.min(n - 1, Math.floor(f + 0.5));
        if (top !== shown) setCaption(top);
      };
      return { size: size, show: show };
    })();

    /* how it works: the path gets mown as you read down */
    var mowPath = howPath && fx && (function () {
      var fill = $("#how-fill"), mower = $("#how-mower"), steps = $$(".how-step", howPath);
      return function () {
        var r = howPath.getBoundingClientRect();
        var y = clamp((window.innerHeight * 0.62 - r.top) / r.height, 0, 1) * r.height;
        fill.style.height = y.toFixed(1) + "px";
        mower.style.top = Math.min(r.height - 30, y - 10).toFixed(1) + "px";
        steps.forEach(function (s) {
          var num = $(".how-num", s).getBoundingClientRect();
          s.classList.toggle("done", num.top + num.height / 2 <= r.top + y + 2);
        });
      };
    })();

    var mowStage = $(".mow-stage"), workStage = $(".work-stage"), ticking = false;
    var updateEffects = function () {
      ticking = false;
      if (lawn && fx) lawn.show(sceneProgress(mowStage));
      if (stack) stack.show(sceneProgress(workStage));
      if (fx) tiltPrices();
      if (mowPath) mowPath();
    };
    var measureEffects = function () {
      if (lawn) { lawn.build(); if (!fx) lawn.draw(0.55); }   // the still page shows it half done
      if (stack) stack.size();
      updateEffects();
    };
    if (fx) window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(updateEffects); } }, { passive: true });
    window.addEventListener("resize", measureEffects);
    if ("ResizeObserver" in window) {
      var resizePending = false;
      var resized = new ResizeObserver(function () {
        if (resizePending) return;
        resizePending = true;
        requestAnimationFrame(function () { resizePending = false; measureEffects(); });
      });
      [$("#lawn-wrap"), $("#stack-wrap")].forEach(function (el) { if (el) resized.observe(el); });
    }
    measureEffects();
  }

  /* ---------- sticky mobile bar ---------- */
  var body = document.body;
  var hero = $("[data-bar-hide]");
  var heroVisible = !!hero, typing = false;
  var isTextField = function (el) {
    return !!(el && el.matches && el.matches("input:not([type=radio]):not([type=checkbox]):not([type=file]):not([type=hidden]), textarea, select"));
  };
  var updateBar = function () { body.classList.toggle("bar-hidden", heroVisible || typing); };
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
      updateBar();
    }, { threshold: 0.15 }).observe(hero);
  } else { heroVisible = false; }
  document.addEventListener("focusin", function (e) { if (isTextField(e.target)) { typing = true; updateBar(); } });
  document.addEventListener("focusout", function () {
    setTimeout(function () { typing = isTextField(document.activeElement); updateBar(); }, 50);
  });
  updateBar();
})();
