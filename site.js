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
    var fail = function (message) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send my quote request";
      statusEl.className = "form-status error";
      statusEl.innerHTML = escapeHtml(message) +
        ' Please <a class="text-link" href="' + escapeHtml(waHref) + '" target="_blank" rel="noopener noreferrer">send it on WhatsApp</a>' +
        ' or call <a class="text-link" href="tel:' + escapeHtml(C.phoneInternational) + '">' + escapeHtml(C.phoneDisplay) + '</a> instead.';
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

      Promise.all([lookupPostcode(pc), Promise.all(photos.map(function (p) { return p.ready; }))]).then(function (out) {
        var area = out[0], files = out[1].filter(Boolean);
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
        if (body && body.ok) showSuccess();
        else fail((body && body.error) || "That didn't go through.");
      }).catch(function (err) {
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
