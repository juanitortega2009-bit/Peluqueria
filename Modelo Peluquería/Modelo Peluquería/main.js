/* ==========================================================================
   CORTEZA — main.js
   Patrón IIFE (sin módulos) para que funcione en file://, FTP y cualquier host.
   ========================================================================== */
(function () {
  "use strict";

  var B = window.__BRAND__ || {};
  var TZ = B.timeZone || "Europe/Madrid";
  var SCHEDULE = B.schedule || {};
  var HOLIDAYS = B.holidays || [];
  var BK = B.booking || { slotStep: 30, daysAhead: 21, minNotice: 60, demoBusyRate: 0.3 };
  var STORE_KEY = "corteza.bookings";

  var DAYS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  var DAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  var MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function safe(fn, name) { try { fn(); } catch (e) { console.warn("[" + name + "]", e); } }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toMin(hhmm) { var p = hhmm.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function fmtMin(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ---------- Hora del salón (independiente de la zona del visitante) ---------- */
  var dtf = null;
  try {
    dtf = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch (e) { dtf = null; }

  function salonNow() {
    var d = new Date(), y, mo, da, h, mi, s;
    if (dtf && dtf.formatToParts) {
      var parts = {};
      dtf.formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
      y = +parts.year; mo = +parts.month; da = +parts.day; h = +parts.hour % 24; mi = +parts.minute; s = +parts.second;
    } else {
      y = d.getFullYear(); mo = d.getMonth() + 1; da = d.getDate(); h = d.getHours(); mi = d.getMinutes(); s = d.getSeconds();
    }
    var key = y + "-" + pad(mo) + "-" + pad(da);
    return { key: key, dow: dowOf(key), min: h * 60 + mi, h: h, m: mi, s: s };
  }

  // Fechas como "YYYY-MM-DD" manejadas en UTC para evitar saltos de zona horaria.
  function keyToUTC(key) { var p = key.split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function dowOf(key) { return new Date(keyToUTC(key)).getUTCDay(); }
  function addDays(key, n) {
    var d = new Date(keyToUTC(key) + n * 86400000);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function dateLabel(key, long) {
    var d = new Date(keyToUTC(key));
    var w = long ? DAYS_ES[d.getUTCDay()] : DAYS_SHORT[d.getUTCDay()];
    return w + " " + d.getUTCDate() + " " + MONTHS_SHORT[d.getUTCMonth()];
  }

  function intervalsFor(key) {
    if (HOLIDAYS.indexOf(key) !== -1) return [];
    return (SCHEDULE[dowOf(key)] || []).map(function (r) { return [toMin(r[0]), toMin(r[1])]; });
  }

  function getStatus() {
    var now = salonNow();
    var today = intervalsFor(now.key);
    for (var i = 0; i < today.length; i++) {
      if (now.min >= today[i][0] && now.min < today[i][1]) {
        return { open: true, now: now, closesAt: today[i][1], left: today[i][1] - now.min, today: today };
      }
    }
    // Próxima apertura
    for (var d = 0; d < 14; d++) {
      var key = addDays(now.key, d);
      var iv = intervalsFor(key);
      for (var j = 0; j < iv.length; j++) {
        if (d > 0 || iv[j][0] > now.min) {
          return { open: false, now: now, nextKey: key, nextAt: iv[j][0], dayOffset: d, today: today };
        }
      }
    }
    return { open: false, now: now, today: today };
  }

  function humanLeft(min) {
    var h = Math.floor(min / 60), m = min % 60;
    if (h && m) return h + " h " + m + " min";
    if (h) return h + " h";
    return m + " min";
  }
  function whenLabel(st) {
    if (st.dayOffset === 0) return "hoy a las " + fmtMin(st.nextAt);
    if (st.dayOffset === 1) return "mañana a las " + fmtMin(st.nextAt);
    return DAYS_ES[dowOf(st.nextKey)].toLowerCase() + " a las " + fmtMin(st.nextAt);
  }

  /* ---------- Horario en tiempo real ---------- */
  function initWeekTable() {
    var body = $("[data-week]");
    if (!body) return;
    var order = [1, 2, 3, 4, 5, 6, 0];
    body.innerHTML = order.map(function (d) {
      var iv = SCHEDULE[d] || [];
      var txt = iv.length ? iv.map(function (r) { return r[0] + "–" + r[1]; }).join(" · ") : "Cerrado";
      return '<tr data-day="' + d + '"' + (iv.length ? "" : ' class="is-closed"') + "><th>" + DAYS_ES[d] + "</th><td>" + txt + "</td></tr>";
    }).join("");
  }

  var DAY_START = 8 * 60, DAY_END = 22 * 60;
  function pct(m) { return Math.max(0, Math.min(100, (m - DAY_START) / (DAY_END - DAY_START) * 100)); }

  function renderDayline(st) {
    var track = $("[data-dayline]"), now = $("[data-dayline-now]");
    if (!track || !now) return;
    var sig = JSON.stringify(st.today) + st.open;
    if (track.dataset.sig !== sig) {
      track.dataset.sig = sig;
      track.innerHTML = st.today.map(function (r) {
        var on = st.open && st.now.min >= r[0] && st.now.min < r[1];
        return '<i class="' + (on ? "is-now" : "") + '" style="left:' + pct(r[0]) + "%;width:" + (pct(r[1]) - pct(r[0])) + '%"></i>';
      }).join("");
    }
    now.style.left = pct(st.now.min + st.now.s / 60) + "%";
  }

  function updateLive() {
    var st = getStatus();
    var label, sub;
    if (st.open) {
      label = "Abierto ahora";
      sub = "Cierra a las " + fmtMin(st.closesAt) + " · quedan " + humanLeft(st.left);
    } else if (st.nextKey) {
      label = "Cerrado ahora";
      sub = "Abrimos " + whenLabel(st);
    } else {
      label = "Cerrado";
      sub = "Consulta próximas fechas";
    }

    $$("[data-status-mini]").forEach(function (el) {
      el.classList.toggle("is-open", st.open);
      var s = el.querySelector("span:not(.dot)");
      if (s) s.textContent = st.open ? "Abierto" : "Cerrado";
    });
    var card = $("[data-status-card]");
    if (card) {
      card.classList.toggle("is-open", st.open);
      $("[data-status-label]").textContent = label;
      $("[data-status-sub]").textContent = sub;
    }

    var state = $("[data-live-state]");
    if (state) {
      state.textContent = st.open ? "Abierto" : "Cerrado";
      state.classList.toggle("is-closed", !st.open);
    }
    var clock = $("[data-live-clock]");
    if (clock) clock.textContent = pad(st.now.h) + ":" + pad(st.now.m) + ":" + pad(st.now.s);
    var lsub = $("[data-live-sub]");
    if (lsub) lsub.textContent = sub + ".";

    $$("[data-week] tr").forEach(function (tr) {
      tr.classList.toggle("is-today", +tr.dataset.day === st.now.dow);
    });
    renderDayline(st);
  }

  function initLive() {
    initWeekTable();
    updateLive();
    setInterval(function () { safe(updateLive, "updateLive"); }, 1000);
  }

  /* ---------- Nav ---------- */
  function initNav() {
    var nav = $("[data-nav]"), burger = $("[data-burger]"), menu = $("[data-menu]"), fab = $("[data-fab]");
    var hero = $(".hero");
    function onScroll() {
      var y = window.scrollY || 0;
      nav.classList.toggle("is-scrolled", y > 40);
      if (fab && hero) {
        var booking = $("#cita");
        var inBooking = booking && booking.getBoundingClientRect().top < window.innerHeight * 0.6 && booking.getBoundingClientRect().bottom > 0;
        fab.classList.toggle("is-shown", y > hero.offsetHeight * 0.7 && !inBooking);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    function setMenu(open) {
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { menu.hidden = false; document.body.style.overflow = "hidden"; }
      else { menu.hidden = true; document.body.style.overflow = ""; }
    }
    if (burger && menu) {
      burger.addEventListener("click", function () { setMenu(burger.getAttribute("aria-expanded") !== "true"); });
      menu.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") setMenu(false); });
    }

    // Enlace activo
    var links = $$("[data-navlink]");
    if ("IntersectionObserver" in window && links.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id); });
        });
      }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
      links.forEach(function (a) { var t = $(a.getAttribute("href")); if (t) io.observe(t); });
    }
  }

  /* ---------- Scroll suave con offset ---------- */
  function initAnchors() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute("href");
      if (!id || id === "#") return;
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      var off = id === "#inicio" ? 0 : 0;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - off,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    });
  }

  /* ---------- Reveals ---------- */
  function initReveals() {
    var els = $$(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("is-visible"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          var el = en.target;
          var sibs = el.parentElement ? $$(".reveal", el.parentElement) : [];
          var idx = Math.max(0, sibs.indexOf(el));
          el.style.transitionDelay = Math.min(idx * 70, 420) + "ms";
          el.classList.add("is-visible");
          io.unobserve(el);
        }
      });
    }, { threshold: 0.01, rootMargin: "0px 0px -4% 0px" });
    els.forEach(function (e) { io.observe(e); });
    setTimeout(function () {
      $$(".reveal:not(.is-visible)").forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("is-visible");
      });
    }, 6000);
  }

  /* ---------- Parallax del hero + tijera que se abre con el scroll ---------- */
  function initScrollFx() {
    var media = $("[data-parallax]");
    var sec = $("[data-scissors-section]"), svg = $("[data-scissors]");
    var a = $('[data-half="a"]'), b = $('[data-half="b"]');
    var ticking = false;
    function frame() {
      ticking = false;
      var vh = window.innerHeight;
      if (media) {
        var y = window.scrollY;
        if (y < vh * 1.2) media.style.transform = "translate3d(0," + (y * 0.22).toFixed(1) + "px,0)";
      }
      if (sec && svg && a && b) {
        var r = sec.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) {
          var p = Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height)));  // 0 → 1
          var open = Math.sin(p * Math.PI * 3) * 0.5 + 0.5;                 // abre y cierra
          var ang = 2 + open * 16;
          a.style.transform = "rotate(" + (-ang).toFixed(2) + "deg)";
          b.style.transform = "rotate(" + (-ang).toFixed(2) + "deg)";
          svg.style.transform = "rotate(" + ((p - 0.5) * 40).toFixed(2) + "deg) translateY(" + ((0.5 - p) * 40).toFixed(1) + "px)";
        }
      }
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
    window.addEventListener("scroll", req, { passive: true });
    window.addEventListener("resize", req);
    frame();
  }

  /* ---------- Filtro de servicios ---------- */
  function initTabs() {
    var tabs = $$("[data-tab]"), items = $$("[data-services] .svc");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        var cat = t.dataset.tab;
        tabs.forEach(function (x) { var on = x === t; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
        items.forEach(function (li) { li.hidden = !(cat === "all" || li.dataset.cat === cat); });
      });
    });
  }

  /* ==========================================================================
     RESERVA DE CITA
     ========================================================================== */
  function loadBookings() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; } }
  function saveBookings(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* sin almacenamiento */ } }

  function hash01(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }

  var SERVICES = [], STYLISTS = [];
  var state = { step: 1, service: null, stylist: null, date: null, time: null };

  function readData() {
    SERVICES = $$("[data-service]").map(function (li) {
      var priceTxt = (li.querySelector(".svc__price") || {}).textContent || (li.dataset.price + " €");
      return { id: li.dataset.service, name: li.dataset.name, duration: +li.dataset.duration, price: +li.dataset.price, priceTxt: priceTxt.trim(), cat: li.dataset.cat };
    });
    STYLISTS = [{ id: "any", name: "Sin preferencia", mono: "∗", role: "El primer hueco libre" }].concat(
      $$("[data-stylist]").map(function (el) {
        return {
          id: el.dataset.stylist, name: el.dataset.name,
          mono: (el.querySelector(".member__mono") || {}).textContent || el.dataset.name[0],
          role: ((el.querySelector(".member__role") || {}).textContent || "").split("—")[0].trim()
        };
      })
    );
  }
  function svcById(id) { for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i]; return null; }
  function styById(id) { for (var i = 0; i < STYLISTS.length; i++) if (STYLISTS[i].id === id) return STYLISTS[i]; return null; }

  function isBusy(dateKey, start, dur, stylistId) {
    var rate = BK.demoBusyRate || 0;
    var realStylists = STYLISTS.filter(function (s) { return s.id !== "any"; });
    function busyFor(sid) {
      // Ocupación simulada estable por bloque de 30 min + citas guardadas en este navegador
      for (var t = start; t < start + dur; t += 30) {
        if (hash01(dateKey + "|" + t + "|" + sid) < rate) return true;
      }
      return loadBookings().some(function (b) {
        if (b.date !== dateKey || (b.stylistAssigned !== sid)) return false;
        var bs = toMin(b.time), be = bs + b.duration;
        return start < be && bs < start + dur;
      });
    }
    if (stylistId === "any") return realStylists.every(function (s) { return busyFor(s.id); });
    return busyFor(stylistId);
  }
  function firstFreeStylist(dateKey, start, dur) {
    var list = STYLISTS.filter(function (s) { return s.id !== "any"; });
    for (var i = 0; i < list.length; i++) if (!isBusy(dateKey, start, dur, list[i].id)) return list[i];
    return list[0];
  }

  function slotsFor(dateKey, dur, stylistId) {
    var now = salonNow();
    var out = [];
    intervalsFor(dateKey).forEach(function (r) {
      for (var t = r[0]; t + dur <= r[1]; t += (BK.slotStep || 30)) {
        if (dateKey === now.key && t < now.min + (BK.minNotice || 0)) continue;
        out.push({ t: t, busy: isBusy(dateKey, t, dur, stylistId) });
      }
    });
    return out;
  }

  function initBooking() {
    var root = $("[data-booking]");
    if (!root) return;
    readData();

    var prev = $("[data-prev]"), next = $("[data-next]");

    // Paso 1: servicios
    var svcWrap = $("[data-choices-services]");
    if (svcWrap && !svcWrap.querySelector(".choice")) {
      svcWrap.innerHTML = SERVICES.map(function (s) {
        return '<button type="button" class="choice" data-pick-service="' + s.id + '">' +
          '<span class="choice__t">' + esc(s.name) + "</span>" +
          '<span class="choice__m"><span>' + s.duration + " min</span><span>" + esc(s.priceTxt) + "</span></span></button>";
      }).join("");
    }
    // Paso 2: equipo
    var teamWrap = $("[data-choices-team]");
    if (teamWrap && !teamWrap.children.length) {
      teamWrap.innerHTML = STYLISTS.map(function (s) {
        return '<button type="button" class="choice" data-pick-stylist="' + s.id + '">' +
          '<span class="choice__mono">' + esc(s.mono) + "</span>" +
          '<span><span class="choice__t">' + esc(s.name) + '</span><br><span class="choice__m">' + esc(s.role) + "</span></span></button>";
      }).join("");
    }

    root.addEventListener("click", function (e) {
      var t;
      if ((t = e.target.closest("[data-pick-service]"))) {
        state.service = t.dataset.pickService; state.time = null;
        mark("[data-pick-service]", t); refresh();
        setTimeout(function () { go(2); }, 260);
      } else if ((t = e.target.closest("[data-pick-stylist]"))) {
        state.stylist = t.dataset.pickStylist; state.time = null;
        mark("[data-pick-stylist]", t); refresh();
        setTimeout(function () { go(3); }, 260);
      } else if ((t = e.target.closest("[data-pick-day]"))) {
        state.date = t.dataset.pickDay; state.time = null;
        mark("[data-pick-day]", t); renderSlots(); refresh();
      } else if ((t = e.target.closest("[data-pick-time]"))) {
        state.time = +t.dataset.pickTime;
        mark("[data-pick-time]", t); refresh();
      }
    });

    function mark(sel, el) { $$(sel, root).forEach(function (x) { x.classList.toggle("is-selected", x === el); }); }

    function renderDays() {
      var wrap = $("[data-days]");
      var svc = svcById(state.service);
      if (!wrap || !svc) return;
      var today = salonNow().key, html = "", firstOk = null;
      for (var i = 0; i < (BK.daysAhead || 21); i++) {
        var k = addDays(today, i);
        var free = slotsFor(k, svc.duration, state.stylist || "any").filter(function (s) { return !s.busy; }).length;
        var d = new Date(keyToUTC(k));
        var label = i === 0 ? "Hoy" : i === 1 ? "Mañana" : DAYS_SHORT[d.getUTCDay()];
        if (free && !firstOk) firstOk = k;
        html += '<button type="button" class="day' + (state.date === k ? " is-selected" : "") + '" data-pick-day="' + k + '"' + (free ? "" : " disabled") + ">" +
          "<small>" + label + "</small><b>" + d.getUTCDate() + "</b><small>" + (free ? free + " libres" : "Completo") + "</small></button>";
      }
      wrap.innerHTML = html;
      if (!state.date || !slotsFor(state.date, svc.duration, state.stylist).some(function (s) { return !s.busy; })) {
        state.date = firstOk;
        var b = firstOk && wrap.querySelector('[data-pick-day="' + firstOk + '"]');
        if (b) b.classList.add("is-selected");
      }
      renderSlots();
    }

    function renderSlots() {
      var wrap = $("[data-slots]");
      var svc = svcById(state.service);
      if (!wrap) return;
      if (!svc || !state.date) { wrap.innerHTML = '<p class="slots__empty">No quedan huecos en las próximas semanas. Llámanos y te buscamos uno.</p>'; return; }
      var list = slotsFor(state.date, svc.duration, state.stylist || "any");
      if (!list.length) { wrap.innerHTML = '<p class="slots__empty">Ese día no hay horas disponibles.</p>'; return; }
      wrap.innerHTML = list.map(function (s) {
        return '<button type="button" class="slot' + (state.time === s.t ? " is-selected" : "") + '" data-pick-time="' + s.t + '"' + (s.busy ? " disabled aria-label=\"" + fmtMin(s.t) + " ocupado\"" : "") + ">" + fmtMin(s.t) + "</button>";
      }).join("");
    }

    function canNext() {
      if (state.step === 1) return !!state.service;
      if (state.step === 2) return !!state.stylist;
      if (state.step === 3) return !!(state.date && state.time != null);
      if (state.step === 4) return true;
      return false;
    }

    function refresh() {
      var svc = svcById(state.service), sty = styById(state.stylist);
      setSum("service", svc ? svc.name : "—");
      setSum("stylist", sty ? sty.name : "—");
      setSum("date", state.date ? dateLabel(state.date, true) : "—");
      setSum("time", state.time != null ? fmtMin(state.time) + " h" : "—");
      setSum("duration", svc ? svc.duration + " min" : "—");
      setSum("price", svc ? svc.priceTxt : "—");
      prev.disabled = state.step <= 1 || state.step >= 5;
      next.disabled = !canNext();
      next.textContent = state.step === 4 ? "Confirmar cita" : "Continuar";
      $(".booking__nav").style.display = state.step >= 5 ? "none" : "";
    }
    function setSum(k, v) { var el = $('[data-sum="' + k + '"]'); if (el) el.textContent = v; }

    function go(n) {
      if (n === 3) renderDays();
      state.step = n;
      $$("[data-step]", root).forEach(function (s) { s.classList.toggle("is-active", +s.dataset.step === n); });
      $$("[data-step-ind]", root).forEach(function (li) {
        var i = +li.dataset.stepInd;
        li.classList.toggle("is-active", i === n);
        li.classList.toggle("is-done", i < n);
      });
      refresh();
      var top = root.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) {
        window.scrollTo({ top: top + window.scrollY - 90, behavior: "smooth" });
      }
    }

    prev.addEventListener("click", function () { if (state.step > 1) go(state.step - 1); });
    next.addEventListener("click", function () {
      if (!canNext()) return;
      if (state.step < 4) { go(state.step + 1); return; }
      confirmBooking();
    });

    function validate(form) {
      var ok = true;
      $$("input", form).forEach(function (inp) {
        var wrap = inp.closest(".field, .check");
        var bad = !inp.checkValidity();
        if (wrap) wrap.classList.toggle("is-invalid", bad);
        if (bad) ok = false;
      });
      return ok;
    }

    function confirmBooking() {
      var form = $("[data-form]");
      if (!validate(form)) { var f = form.querySelector(".is-invalid input"); if (f) f.focus(); return; }
      var svc = svcById(state.service);
      var assigned = state.stylist === "any" ? firstFreeStylist(state.date, state.time, svc.duration) : styById(state.stylist);
      var f = form.elements;
      var data = {
        id: Date.now().toString(36),
        service: svc.name, serviceId: svc.id, duration: svc.duration, price: svc.priceTxt,
        stylist: assigned.name, stylistAssigned: assigned.id,
        date: state.date, time: fmtMin(state.time),
        name: f.namedItem("name").value.trim(), phone: f.namedItem("phone").value.trim(),
        email: f.namedItem("email").value.trim(), notes: f.namedItem("notes").value.trim()
      };

      // Lo que llega al email de la peluquería vía Web3Forms
      var payload = {
        access_key: B.web3formsKey || "",
        subject: "Nueva cita: " + data.service + " — " + dateLabel(data.date, true) + " " + data.time,
        from_name: (B.name || "Web") + " · Reservas online",
        botcheck: f.namedItem("botcheck").checked,
        "Servicio": data.service,
        "Profesional": data.stylist + (state.stylist === "any" ? " (sin preferencia)" : ""),
        "Fecha": dateLabel(data.date, true) + " (" + data.date + ")",
        "Hora": data.time,
        "Duración": data.duration + " min",
        "Precio": data.price,
        "Nombre": data.name,
        "Teléfono": data.phone,
        "Notas": data.notes || "—"
      };
      if (data.email) payload.email = data.email;   // Web3Forms lo usa como "responder a"

      next.disabled = true;
      next.textContent = "Enviando…";
      sendToWeb3Forms(payload).then(function (ok) {
        finishBooking(form, data, ok);
      });
    }

    function sendToWeb3Forms(payload) {
      if (!window.fetch || !payload.access_key) return Promise.resolve(false);
      return fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); })
        .then(function (j) { return !!(j && j.success); })
        .catch(function () { return false; });
    }

    function finishBooking(form, data, sent) {
      var list = loadBookings(); list.push(data); saveBookings(list);
      var status = $("[data-send-status]");
      if (status) {
        status.textContent = sent
          ? "Hemos recibido tu solicitud. Te confirmaremos la cita por teléfono o WhatsApp."
          : "No hemos podido enviar la solicitud. Confírmala por WhatsApp con el botón de abajo.";
        status.classList.toggle("is-error", !sent);
      }

      $("[data-confirm]").innerHTML = [
        ["Servicio", data.service], ["Con", data.stylist], ["Día", dateLabel(data.date, true)],
        ["Hora", data.time + " h"], ["Duración", data.duration + " min"], ["Precio", data.price], ["A nombre de", data.name]
      ].map(function (r) { return "<div><dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("");

      var msg = "Hola " + (B.name || "") + ", he reservado online:\n" +
        "• " + data.service + " con " + data.stylist + "\n" +
        "• " + dateLabel(data.date, true) + " a las " + data.time + "\n" +
        "Nombre: " + data.name + " · Tel: " + data.phone + (data.notes ? "\nNota: " + data.notes : "");
      var wa = $("[data-wa]");
      wa.href = "https://wa.me/" + (B.whatsapp || "") + "?text=" + encodeURIComponent(msg);
      $("[data-gcal]").href = googleCalendarUrl(data);

      form.reset();
      $$(".is-invalid", form).forEach(function (x) { x.classList.remove("is-invalid"); });
      go(5);
      renderMine();
      safe(updateNextSlot, "updateNextSlot");
    }

    $("[data-restart]").addEventListener("click", function () {
      state = { step: 1, service: null, stylist: null, date: null, time: null };
      $$(".is-selected", root).forEach(function (x) { x.classList.remove("is-selected"); });
      go(1);
    });

    // Botones "Reservar" de la carta de servicios
    $$("[data-book]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.service = btn.dataset.book; state.time = null;
        var c = $('[data-pick-service="' + state.service + '"]');
        if (c) mark("[data-pick-service]", c);
        go(2);
        var el = $("#cita");
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: "smooth" });
      });
    });

    // Validación al escribir
    $$("[data-form] input").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var wrap = inp.closest(".field, .check");
        if (wrap && wrap.classList.contains("is-invalid") && inp.checkValidity()) wrap.classList.remove("is-invalid");
      });
    });

    refresh();
    renderMine();
  }

  // Enlace "Añadir a Google Calendar" con la cita ya rellenada (hora del salón)
  function googleCalendarUrl(b) {
    var d = b.date.replace(/-/g, ""), s = toMin(b.time), e = s + b.duration;
    var t = function (m) { return pad(Math.floor(m / 60)) + pad(m % 60) + "00"; };
    var params = [
      ["action", "TEMPLATE"],
      ["text", b.service + " — " + (B.name || "Peluquería")],
      ["dates", d + "T" + t(s) + "/" + d + "T" + t(e)],
      ["ctz", TZ],
      ["details", "Con " + b.stylist + ". Precio: " + b.price + ".\nPara cambiar o cancelar: " + (B.phone || "")],
      ["location", B.address || ""]
    ];
    return "https://calendar.google.com/calendar/render?" + params.map(function (p) {
      return p[0] + "=" + encodeURIComponent(p[1]);
    }).join("&");
  }

  function renderMine() {
    var box = $("[data-mine]"), ul = $("[data-mine-list]");
    if (!box || !ul) return;
    var now = salonNow();
    var list = loadBookings().filter(function (b) { return b.date > now.key || (b.date === now.key && toMin(b.time) >= now.min); })
      .sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
    box.hidden = !list.length;
    ul.innerHTML = list.map(function (b) {
      return "<li><div>" + esc(b.service) + " · " + esc(b.stylist) + "<br><span>" + dateLabel(b.date, true) + " · " + esc(b.time) + " h</span></div>" +
        '<button class="btn btn--ghost btn--sm" type="button" data-cancel="' + esc(b.id) + '">Cancelar</button></li>';
    }).join("");
    if (!ul.dataset.bound) {
      ul.dataset.bound = "1";
      ul.addEventListener("click", function (e) {
        var t = e.target.closest("[data-cancel]");
        if (!t) return;
        saveBookings(loadBookings().filter(function (b) { return b.id !== t.dataset.cancel; }));
        renderMine();
        safe(updateNextSlot, "updateNextSlot");
      });
    }
  }

  /* ---------- "Próximo hueco libre" en el hero ---------- */
  function updateNextSlot() {
    var el = $("[data-next-slot]");
    if (!el || !STYLISTS.length) return;
    var today = salonNow().key;
    for (var i = 0; i < 14; i++) {
      var k = addDays(today, i);
      var free = slotsFor(k, 30, "any").filter(function (s) { return !s.busy; });
      if (free.length) {
        var when = i === 0 ? "hoy" : i === 1 ? "mañana" : dateLabel(k, true).toLowerCase();
        el.textContent = "Próximo hueco libre: " + when + " a las " + fmtMin(free[0].t);
        return;
      }
    }
  }

  /* ---------- Datos de contacto desde la configuración ---------- */
  function initContactData() {
    if (B.phone) $$("[data-phone]").forEach(function (a) { a.textContent = B.phone; a.href = "tel:" + B.phone.replace(/\s/g, ""); });
    if (B.whatsapp) $$("[data-wa-link]").forEach(function (a) { a.href = "https://wa.me/" + B.whatsapp; });
    if (B.email) $$("[data-mail]").forEach(function (a) { a.textContent = B.email; a.href = "mailto:" + B.email; });
    if (B.address) $$("[data-addr]").forEach(function (a) { a.textContent = B.address; });
  }

  function boot() {
    document.documentElement.classList.remove("no-js");
    safe(initContactData, "initContactData");
    safe(initNav, "initNav");
    safe(initAnchors, "initAnchors");
    safe(initReveals, "initReveals");
    safe(initScrollFx, "initScrollFx");
    safe(initTabs, "initTabs");
    safe(initLive, "initLive");
    safe(initBooking, "initBooking");
    safe(updateNextSlot, "updateNextSlot");
    setInterval(function () { safe(updateNextSlot, "updateNextSlot"); }, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
