/* GoBYE website behaviour: renders the content model (site.config.js), the waitlist form and the
   verified social proof. No framework; works from a static host. */
(function () {
  'use strict';
  var C = window.GOBYE_SITE;
  var I = window.GOBYE_ICONS || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var icon = function (name) { return '<span class="icon" aria-hidden="true">' + (I[name] || '') + '</span>'; };
  var isUrl = function (u) { return typeof u === 'string' && /^https:\/\//.test(u); };

  /* ---------- Content ---------- */
  function bindText() {
    document.querySelectorAll('[data-text]').forEach(function (el) {
      var v = el.getAttribute('data-text').split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, C);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-lines]').forEach(function (el) {
      var v = el.getAttribute('data-lines').split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, C);
      if (v && v.join) el.innerHTML = v.map(esc).join('<br>');
    });
    document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = I[el.getAttribute('data-icon')] || ''; });
  }

  /* ---------- Launch actions: waitlist now, store badges once live ---------- */
  function renderLaunch() {
    var live = C.launch.status === 'live' && isUrl(C.stores.appStore.url) && isUrl(C.stores.googlePlay.url);
    var wait = $('#cta-waitlist');
    var stores = $('#cta-stores');
    if (live) {
      wait.hidden = true;
      stores.hidden = false;
      stores.innerHTML =
        '<a href="' + esc(C.stores.appStore.url) + '" rel="noopener"><img src="' + esc(C.stores.appStore.badge) + '" alt="Download on the App Store"></a>' +
        '<a href="' + esc(C.stores.googlePlay.url) + '" rel="noopener"><img src="' + esc(C.stores.googlePlay.badge) + '" alt="Get it on Google Play"></a>';
    }
    // QR card: only with a real destination and a caption that names it.
    var qr = $('#qr-card');
    if (isUrl(C.qr.url) && C.qr.caption) {
      qr.hidden = false;
      $('p', qr).textContent = C.qr.caption;
      var box = $('.qr', qr);
      var draw = function () { /* global QRCode */ new QRCode(box, { text: C.qr.url, width: 264, height: 264, correctLevel: QRCode.CorrectLevel.M }); };
      if (window.QRCode) draw();
      else {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = draw;
        document.head.appendChild(s);
      }
    }
  }

  /* ---------- Trust: prelaunch until verified evidence exists ---------- */
  function verifiedBlocks() {
    var v = C.trust.verified;
    var count = v.riderCount && typeof v.riderCount.value === 'number' && v.riderCount.label && v.riderCount.definition ? v.riderCount : null;
    var ratings = (v.ratings || []).filter(function (r) { return r && r.platform && typeof r.rating === 'number' && isUrl(r.url); });
    var quotes = (v.testimonials || []).filter(function (t) { return t && t.permission === true && t.quote && t.name; });
    return { count: count, ratings: ratings, quotes: quotes };
  }

  function stars(n) {
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="icon" aria-hidden="true" style="opacity:' + (n >= i - 0.25 ? 1 : 0.28) + '">' + (I.starFilled || '') + '</span>';
    return out;
  }

  function quoteCard(t) {
    return (
      '<figure class="quote"><blockquote>' + esc(t.quote) + '</blockquote><figcaption class="who">' +
      (t.photo ? '<img src="' + esc(t.photo) + '" alt="">' : '') +
      '<span><span class="name">' + esc(t.name) + '</span><br><span class="when">' + esc([t.location, t.date].filter(Boolean).join(' · ')) + '</span></span></figcaption></figure>'
    );
  }

  function renderTrust(root, data) {
    root.setAttribute('data-rendered', '1');
    var b = data || verifiedBlocks();
    var anyVerified = b.count || b.ratings.length || b.quotes.length;
    var sec = root.closest && root.closest('section');
    if (sec && sec.id === 'trust') sec.hidden = !anyVerified; // the page shows social proof only when it is real
    if (!anyVerified) {
      var p = C.trust.prelaunch;
      root.innerHTML =
        '<p class="eyebrow">' + esc(p.eyebrow) + '</p><h2 id="trust-title">' + esc(p.heading) + '</h2><p class="sub">' + esc(p.supporting) + '</p>' +
        '<div class="cards">' +
        p.cards.map(function (c) { return '<article class="card">' + icon(c.icon) + '<h3>' + esc(c.title) + '</h3><p>' + esc(c.body) + '</p></article>'; }).join('') +
        '</div>';
      return;
    }
    var v = C.trust.verified;
    var html = '<p class="eyebrow">' + esc(v.eyebrow) + '</p><h2 id="trust-title" class="sr">What riders say about GoBYE</h2>';
    if (b.count) {
      html += '<div class="count"><span class="value">' + Number(b.count.value).toLocaleString('en-NG') + '</span><span class="label">' + esc(b.count.label) + '</span>' +
        '<span class="def">' + esc(b.count.definition) + (b.count.asOf ? ' As of ' + esc(b.count.asOf) + '.' : '') + '</span></div>';
    }
    if (b.ratings.length) {
      html += '<div class="ratings">' + b.ratings.slice(0, 2).map(function (r) {
        return '<a class="rating" href="' + esc(r.url) + '" rel="noopener" aria-label="' + esc(r.platform + ' rating ' + r.rating + ' out of 5' + (r.reviews ? ', ' + r.reviews + ' reviews' : '')) + '">' +
          '<span class="stars">' + stars(r.rating) + '</span><span class="score">' + r.rating.toFixed(1) + '</span>' +
          '<span class="meta"><span class="platform">' + esc(r.platform) + '</span>' + (r.reviews ? ' · ' + Number(r.reviews).toLocaleString('en-NG') + ' reviews' : '') + '</span></a>';
      }).join('') + '</div>';
    }
    if (b.quotes.length) {
      var half = Math.ceil(b.quotes.length / 2);
      var rows = [b.quotes.slice(0, half), b.quotes.slice(half)].filter(function (r) { return r.length; });
      html += '<div class="reviews" id="reviews"><div class="marquee-controls"><button class="btn btn-ghost" type="button" id="marquee-toggle" aria-pressed="false">' + icon('pause') + '<span>Pause</span></button></div>' +
        rows.map(function (row, i) {
          var cards = row.map(quoteCard).join('');
          // The copy that makes the loop seamless is hidden from screen readers and keyboard focus.
          return '<div class="row' + (i ? ' reverse' : '') + '" role="list" aria-label="Rider reviews, row ' + (i + 1) + '"><div class="track" style="--dur:' + Math.max(40, row.length * 14) + 's"><div style="display:contents" role="listitem">' + cards + '</div><div style="display:contents" aria-hidden="true" inert>' + cards + '</div></div></div>';
        }).join('') + '</div>';
    }
    root.innerHTML = html;
    var t = $('#marquee-toggle', root);
    if (t) t.addEventListener('click', function () {
      var paused = $('#reviews', root).classList.toggle('paused');
      t.setAttribute('aria-pressed', String(paused));
      t.innerHTML = icon(paused ? 'play' : 'pause') + '<span>' + (paused ? 'Play' : 'Pause') + '</span>';
    });
  }

  /* ---------- Waitlist form ---------- */
  function setupWaitlist() {
    var dlg = $('#waitlist');
    var form = $('#waitlist-form');
    // Where sign ups go: Supabase (insert only, via the public anon key) or any POST endpoint.
    var sb = C.waitlist.supabase || {};
    var useSupabase = isUrl(sb.url) && !!sb.anonKey;
    var noEndpoint = !useSupabase && !C.waitlist.endpoint; // nothing can be stored until one is set
    var opened = null;
    var sel = $('#wl-city');
    sel.innerHTML = '<option value="">Choose a city</option>' + C.waitlist.cities.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

    function open(e) {
      opened = e && e.currentTarget;
      showForm();
      // Start from the audience the visitor is reading about; they can still change it.
      var want = opened && opened.getAttribute && opened.getAttribute('data-intent');
      if (want) { var r = document.getElementById(want === 'drive' ? 'wl-drive' : 'wl-ride'); if (r) r.checked = true; }
      else if (!form.querySelector('input[name="intent"]:checked')) {
        var pre = document.getElementById(audience === 'driver' ? 'wl-drive' : 'wl-ride');
        if (pre) pre.checked = true;
      }
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
      setTimeout(function () { $('#wl-email').focus(); }, 30);
    }
    function close() {
      if (typeof dlg.close === 'function') dlg.close();
      else dlg.removeAttribute('open');
      if (opened) opened.focus();
    }
    function showForm() {
      form.hidden = false;
      $('#wl-result').hidden = true;
      $('#wl-error').hidden = true;
    }
    function fieldError(id, msg) {
      var input = document.getElementById(id);
      var err = document.getElementById(id + '-err');
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (err) { err.textContent = msg || ''; err.hidden = !msg; }
    }
    function validate() {
      var email = $('#wl-email').value.trim();
      var city = sel.value;
      var intent = (form.querySelector('input[name="intent"]:checked') || {}).value;
      var ok = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fieldError('wl-email', 'Enter an email address like name@example.com'); ok = false; } else fieldError('wl-email');
      if (!city) { fieldError('wl-city', 'Choose a city'); ok = false; } else fieldError('wl-city');
      if (!intent) { fieldError('wl-intent', 'Choose ride or drive'); ok = false; } else fieldError('wl-intent');
      return ok ? { email: email, city: city, intent: intent, source: 'website' } : null;
    }
    function result(kind, title, body) {
      form.hidden = true;
      var r = $('#wl-result');
      r.hidden = false;
      $('.badge', r).className = 'badge ' + kind;
      $('.badge', r).innerHTML = icon(kind === 'ok' ? 'check' : 'info');
      $('h3', r).textContent = title;
      $('p', r).textContent = body;
      $('#wl-done').focus();
    }

    document.querySelectorAll('[data-open-waitlist]').forEach(function (b) { b.addEventListener('click', open); });
    $('#wl-close').addEventListener('click', close);
    $('#wl-done').addEventListener('click', close);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = validate();
      if (!data) { var bad = form.querySelector('[aria-invalid="true"]'); if (bad) bad.focus(); return; }
      var btn = $('#wl-submit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin" aria-hidden="true"></span><span>Joining</span>';
      $('#wl-error').hidden = true;
      var done = function () { btn.disabled = false; btn.textContent = 'Join the waitlist'; };

      if (noEndpoint) {
        // Prototype: nothing is sent or stored. Never shown as a registration.
        setTimeout(function () {
          done();
          result('soon', 'Sign ups open soon', 'We aren’t taking sign ups just yet, so ' + data.email + ' wasn’t saved. Please check back soon.');
        }, 700);
        return;
      }
      // Bots fill the hidden field; humans never see it. Pretend it worked and store nothing.
      if (form.querySelector('[name="company"]') && form.querySelector('[name="company"]').value) {
        setTimeout(function () { done(); result('ok', 'You’re on the list', 'Thanks.'); }, 600);
        return;
      }
      var place = data.city === 'Another city' ? 'your city' : data.city;
      var req = useSupabase
        ? fetch(sb.url.replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(sb.table || 'waitlist'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: sb.anonKey, Authorization: 'Bearer ' + sb.anonKey, Prefer: 'return=minimal' },
            body: JSON.stringify({ email: data.email.toLowerCase(), city: data.city, intent: data.intent, source: data.source }),
          })
        : fetch(C.waitlist.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      req
        .then(function (res) {
          done();
          // Already signed up: the database refused a duplicate email, so they are on the list.
          if (res.status === 409) { result('ok', 'You’re already on the list', 'We’ll email ' + data.email + ' when GoBYE launches in ' + place + '.'); return; }
          if (!res.ok) throw new Error(String(res.status));
          // Success only after the backend confirms it stored the sign up.
          result('ok', 'You’re on the list', 'We’ll email ' + data.email + ' when GoBYE launches in ' + place + '.');
        })
        .catch(function () {
          done();
          var er = $('#wl-error');
          er.hidden = false;
          er.textContent = 'We couldn’t add you just now. Your details are still here; try again in a moment.';
        });
    });
  }

  /* ---------- Hero video: pause control, reduced motion, blocked autoplay ---------- */
  function heroVideo() {
    var v = document.getElementById('hero-video');
    var t = document.getElementById('video-toggle');
    if (!v || !t) return;
    var setState = function (playing) {
      t.setAttribute('aria-pressed', String(!playing));
      t.setAttribute('aria-label', playing ? 'Pause background video' : 'Play background video');
      t.innerHTML = icon(playing ? 'pause' : 'play');
    };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { v.removeAttribute('autoplay'); v.pause(); setState(false); }
    else {
      var p = v.play();
      if (p && typeof p.catch === 'function') p.catch(function () { setState(false); });
    }
    v.addEventListener('play', function () { setState(true); });
    v.addEventListener('pause', function () { setState(false); });
    t.addEventListener('click', function () { if (v.paused) v.play(); else v.pause(); });
  }

  /* ---------- Audience: riders or drivers ---------- */
  var reduce = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var phone = function () { return !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches); };
  var TICK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.3 5 8.6 9.6 3.6"/></svg>';
  var CROSS = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3.2 3.2l5.6 5.6M8.8 3.2 3.2 8.8"/></svg>';
  var audience = 'rider';
  var get = function (obj, path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj); };

  function renderSteps(a) {
    var deck = $('#deck');
    if (!deck) return;
    deck.innerHTML = a.steps.items.map(function (s, i) {
      var deep = i % 2 === 1;
      return '<li class="step' + (deep ? ' deep' : '') + '" style="--i:' + i + '"><div class="txt"><span class="pill">Step ' + (i + 1) + '</span><h3>' + esc(s.title) + '</h3><p>' + esc(s.body) + '</p></div>' +
        (s.ui ? '<div class="ui"><img src="' + esc(s.ui) + '" alt="' + esc(s.alt || '') + '" loading="lazy"></div>' : '<span class="num" aria-hidden="true">0' + (i + 1) + '</span>') + '</li>';
    }).join('');
    $('#stack').style.setProperty('--n', a.steps.items.length);
    updateDeck();
  }

  function renderFeatures(a) {
    var rail = $('#rail');
    if (!rail) return;
    // One anatomy for every card: title and line at the top, a tinted stage below with an app snippet
    // rising out of it, and an optional 3D object in front. Stage tints alternate warm and lilac.
    rail.innerHTML = a.features.items.map(function (f, i) {
      // Bento rhythm on a 12 column grid: narrow, wide / wide, narrow / narrow, wide.
      var wide = i % 4 === 1 || i % 4 === 2;
      return '<li class="feat' + (wide ? ' wide' : '') + '"><div class="feat-copy"><h3>' + esc(f.title) + '</h3><p>' + esc(f.body) + '</p></div>' +
        '<div class="stage ' + (i % 2 ? 'lilac' : 'warm') + '">' +
        (f.frag ? '<img class="frag" src="' + esc(f.frag) + '" alt="" loading="lazy" draggable="false">' : '') +
        (f.art ? '<img class="accent" src="' + esc(f.art) + '" alt="" loading="lazy" draggable="false">' : '') + '</div></li>';
    }).join('');
  }

  function renderSafety(a) {
    var g = $('#safe-grid');
    if (!g || !a.safety) return;
    // Same anatomy as the feature cards: title and line on top, an app snippet rising from a tinted stage.
    g.innerHTML = a.safety.items.map(function (it, i) {
      return '<article class="feat safe"><div class="feat-copy"><h3>' + esc(it.title) + '</h3><p>' + esc(it.body) + '</p></div>' +
        '<div class="stage ' + (i % 2 ? 'warm' : 'lilac') + '">' +
        '<img class="frag" src="' + esc(it.frag) + '" alt="" loading="lazy" draggable="false">' +
        (it.art ? '<img class="accent" src="' + esc(it.art) + '" alt="" loading="lazy" draggable="false">' : '') + '</div></article>';
    }).join('');
  }

  function renderStatement(text) {
    var el = $('#statement');
    if (!el) return;
    el.setAttribute('aria-label', text);
    el.innerHTML = text.split(/\s+/).map(function (w) { return '<span class="w" aria-hidden="true">' + esc(w) + '</span>'; }).join(' ');
    updateFill();
  }

  function renderCompare(a) {
    var vs = $('#vs');
    if (!vs) return;
    var c = a.compare;
    var hl = c.ours.items.length - (c.ours.highlightLast || 0);
    var stage = function (frag, cls) { return frag ? '<div class="pstage ' + cls + '"><img src="' + esc(frag) + '" alt="" loading="lazy" draggable="false"></div>' : ''; };
    vs.innerHTML =
      '<article class="plan old">' + stage(c.old.frag, 'muted') +
      '<div class="pbody"><span class="ptag">The old way</span><h3>' + esc(c.old.title) + '</h3><p class="psub">' + esc(c.old.tag) + '</p><ul>' +
      c.old.items.map(function (t, i) { return '<li style="--i:' + i + '"><span class="mark no" aria-hidden="true">' + CROSS + '</span><span><span class="sr">Drawback: </span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div></article>' +
      '<article class="plan ours">' + stage(c.ours.frag, 'brand') +
      '<div class="pbody"><span class="ptag brand"><img src="' + esc(C.brand.logoDark) + '" alt="">With ' + esc(C.brand.name) + '</span><h3 class="grad-text">' + esc(c.ours.tag) + '</h3><p class="psub">' + esc(c.ours.sub || '') + '</p><ul>' +
      c.ours.items.map(function (t, i) { return '<li style="--i:' + (i + 1) + '"' + (i >= hl ? ' class="hl"' : '') + '><span class="mark yes" aria-hidden="true">' + TICK + '</span><span' + (i >= hl ? ' class="grad-text"' : '') + '><span class="sr">Included: </span>' + esc(t) + '</span></li>'; }).join('') + '</ul></div></article>';
  }

  function setAudience(key, remember, animate) {
    if (!C.audiences || !C.audiences[key]) return;
    document.querySelectorAll('[data-aud]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-aud') === key)); });
    document.querySelectorAll('.seg').forEach(function (s) { s.setAttribute('data-on', key); });
    var root = document.documentElement;
    // A soft crossfade: content fades down, swaps, then fades back in.
    if (animate && key !== audience && root.classList.contains('js-motion')) {
      root.classList.add('swapping');
      setTimeout(function () { applyAudience(key, remember); requestAnimationFrame(function () { root.classList.remove('swapping'); }); }, 180);
      return;
    }
    applyAudience(key, remember);
  }

  function applyAudience(key, remember) {
    audience = key;
    var a = C.audiences[key];
    document.querySelectorAll('[data-a]').forEach(function (el) { var v = get(a, el.getAttribute('data-a')); if (v != null) el.textContent = v; });
    document.querySelectorAll('[data-a-lines]').forEach(function (el) { var v = get(a, el.getAttribute('data-a-lines')); if (v) el.innerHTML = v.map(esc).join('<br>'); });
    renderSteps(a);
    renderFeatures(a);
    renderSafety(a);
    renderStatement(a.statement);
    renderCompare(a);
    if (remember) { try { localStorage.setItem('gobye-audience', key); } catch (e) { /* storage unavailable */ } }
  }

  function setupAudience() {
    if (!C.audiences) return;
    var saved = null;
    try { saved = localStorage.getItem('gobye-audience'); } catch (e) { /* storage unavailable */ }
    setAudience(saved === 'driver' ? 'driver' : 'rider');
    document.querySelectorAll('[data-aud]').forEach(function (b) { b.addEventListener('click', function () { setAudience(b.getAttribute('data-aud'), true, true); }); });
    document.querySelectorAll('[data-aud-link]').forEach(function (l) { l.addEventListener('click', function () { setAudience(l.getAttribute('data-aud-link'), true, false); }); });
  }

  /* ---------- Navbar: clear at the top, frosted white once the page scrolls ---------- */
  function setupNav() {
    var bar = $('#topbar');
    var hero = $('.hero');
    if (!bar || !hero) return;
    var check = function () { bar.classList.toggle('solid', window.scrollY > 4); }; // the hero is white, so the bar only needs its frosted background once content scrolls under it
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    check();
  }

  /* ---------- Step deck: pinned, each card tilts in and flattens as it lands ---------- */
  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  function updateDeck() {
    var stack = $('#stack');
    if (!stack) return;
    var cards = stack.querySelectorAll('.step');
    if (reduce()) { cards.forEach(function (c) { c.style.transform = ''; c.style.zIndex = ''; c.style.filter = ''; }); return; }
    if (phone()) {
      // Sticky stack: as the next card slides over this one, it eases back and dims, keeping the front card in focus.
      cards.forEach(function (c, i) {
        var next = cards[i + 1];
        var p = 0;
        if (next) {
          var a = c.getBoundingClientRect(), b = next.getBoundingClientRect();
          p = clamp(1 - (b.top - a.top) / Math.max(1, a.height));
        }
        c.style.zIndex = String(i + 1);
        c.style.transform = p ? 'scale(' + (1 - 0.07 * p).toFixed(3) + ')' : '';
        c.style.filter = p ? 'brightness(' + (1 - 0.12 * p).toFixed(3) + ')' : '';
      });
      return;
    }
    var r = stack.getBoundingClientRect();
    var vh = window.innerHeight;
    var travel = Math.max(1, r.height - vh);
    var progress = clamp(-r.top / travel) * (cards.length - 1); // 0 … n-1: how many cards have landed past the first
    cards.forEach(function (c, i) {
      var p = i === 0 ? 1 : clamp(progress - (i - 1)); // this card's landing progress
      var above = Math.max(0, progress - i); // how far later cards have covered it
      var e = 1 - Math.pow(1 - p, 3);
      var y = (1 - e) * (vh * 0.85) + i * 14 - Math.min(above, 3) * 14;
      var s = 1 - Math.min(above, 3) * 0.045;
      var rx = (1 - e) * 22;
      var rz = (1 - e) * (i % 2 ? 5 : -5);
      c.style.zIndex = String(i + 1);
      c.style.transform = 'translateY(' + y.toFixed(1) + 'px) rotateX(' + rx.toFixed(2) + 'deg) rotateZ(' + rz.toFixed(2) + 'deg) scale(' + s.toFixed(3) + ')';
      c.style.filter = above > 0 ? 'brightness(' + (1 - Math.min(above, 1) * 0.1).toFixed(3) + ')' : ''; // covered cards step back
    });
  }

  /* ---------- Statement: words fill from light grey to black as you scroll ---------- */
  function updateFill() {
    var el = $('#statement');
    if (!el) return;
    var words = el.querySelectorAll('.w');
    if (reduce()) { words.forEach(function (w) { w.classList.add('on'); }); return; }
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight;
    var p = clamp((vh * 0.85 - r.top) / (vh * 0.55 + r.height * 0.6));
    var n = Math.round(p * words.length);
    words.forEach(function (w, i) { w.classList.toggle('on', i < n); });
  }

  /* ---------- People: photographs with a GoBYE notification on top ---------- */
  function renderPeople() {
    var m = $('#mosaic');
    if (!m || !C.people) return;
    var logo = esc(C.brand.logoDark || C.brand.logo);
    m.innerHTML = C.people.tiles.filter(function (t) { return t.photo; }).map(function (t) {
      return '<figure class="tile' + (t.big ? ' big' : '') + '"><img src="' + esc(t.photo) + '" alt="' + esc(t.alt) + '" loading="lazy" style="object-position:' + esc(t.pos || '50% 50%') + '">' +
        (t.chip ? '<div class="note' + (t.noteRight ? ' right' : '') + '" aria-hidden="true"><img src="' + logo + '" alt=""><span><b>' + esc(C.brand.name) + '</b> ' + esc(t.chip) + '</span></div>' : '') +
        '<figcaption>' + esc(t.title) + '</figcaption></figure>';
    }).join('');
  }

  /* ---------- Footer, founder card: only real links and real people ---------- */
  function renderFooter() {
    var apps = $('#foot-apps');
    if (apps) {
      var live = C.launch.status === 'live';
      var item = function (label, url) { return '<li>' + (live && isUrl(url) ? '<a href="' + esc(url) + '" rel="noopener">' + esc(label) + '</a>' : esc(label) + '<span class="soon">Coming soon</span>') + '</li>'; };
      apps.innerHTML = item('GoBYE for iPhone', C.stores.appStore.url) + item('GoBYE for Android', C.stores.googlePlay.url) + '<li>GoBYE Driver<span class="soon">Coming soon</span></li>';
    }
    var f = C.footer || {};
    var links = [];
    if (f.contactEmail) links.push('<li><a href="mailto:' + esc(f.contactEmail) + '">Contact</a></li>');
    if (isUrl(f.privacyUrl)) links.push('<li><a href="' + esc(f.privacyUrl) + '">Privacy</a></li>');
    if (isUrl(f.termsUrl)) links.push('<li><a href="' + esc(f.termsUrl) + '">Terms</a></li>');
    var co = $('#foot-company');
    if (co && links.length) { co.hidden = false; $('ul', co).innerHTML = links.join(''); }
    var so = $('#social');
    var s = f.social || {};
    if (so) so.innerHTML = [['instagram', 'IG', 'Instagram'], ['linkedin', 'in', 'LinkedIn'], ['x', 'X', 'X']].filter(function (k) { return isUrl(s[k[0]]); })
      .map(function (k) { return '<a href="' + esc(s[k[0]]) + '" rel="noopener" aria-label="GoBYE on ' + k[2] + '">' + k[1] + '</a>'; }).join('');
    if (C.launch.status === 'live' && isUrl(C.stores.appStore.url) && isUrl(C.stores.googlePlay.url)) {
      var l = $('#foot-cta-label'); if (l) l.textContent = 'Book a ride'; // only once the apps are actually in the stores
    }
    var cities = $('#foot-cities');
    if (cities) cities.textContent = C.launch.cities.join(' · ');
    var fd = C.founder || {};
    var card = $('#founder');
    if (card && fd.name && fd.title && fd.photo) {
      card.hidden = false;
      card.innerHTML = '<div class="row1"><img src="' + esc(fd.photo) + '" alt=""><div><h3>Hey! I’m ' + esc(fd.name) + '</h3><span class="when">' + esc(fd.title) + ', GoBYE</span></div></div>' +
        (fd.pitch ? '<p>' + esc(fd.pitch) + '</p>' : '') + (isUrl(fd.callUrl) ? '<a class="btn btn-grad btn-sm" href="' + esc(fd.callUrl) + '" rel="noopener">Book a call</a>' : '');
    }
  }

  /* ---------- Footer road: load the 3D scene only when the footer comes near ---------- */
  function setupRoad() {
    var stage = document.getElementById('foot-stage');
    var canvas = document.getElementById('road-canvas');
    if (!stage || !canvas || !('IntersectionObserver' in window)) return;
    var started = false;
    var near = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting || started) return;
      started = true;
      near.disconnect();
      import('./footer3d.js').then(function (m) {
        window.GOBYE_ROAD = m.mountRoad(canvas, { reduce: reduce() });
        requestAnimationFrame(function () { stage.classList.add('in'); });
      }).catch(function () { /* the wordmark stays on its own */ });
    }, { rootMargin: '700px 0px' });
    near.observe(stage);
    // Gentle parallax on the wordmark as the footer scrolls in.
    if (!reduce()) {
      var word = stage.querySelector('.wordmark');
      var onScroll = function () {
        var r = stage.getBoundingClientRect();
        var p = Math.max(-1, Math.min(1, (r.top - innerHeight * 0.4) / innerHeight));
        word.style.setProperty('--par', (p * 36).toFixed(1) + 'px');
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  }

  function setupScroll() {
    var raf = 0;
    var tick = function () { raf = 0; updateDeck(); updateFill(); };
    var on = function () { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    tick();
  }

  /* ---------- Scroll reveal: content eases in once as it enters the screen ---------- */
  function setupReveal() {
    if (reduce() || !('IntersectionObserver' in window)) return;
    document.documentElement.classList.add('js-motion');
    var groups = [
      ['.sec .head .eyebrow, .sec .head .title, .people .head .eyebrow', 0, 0],
      ['.mosaic .tile', 90, 0],
      ['#safe-grid > *', 80, 0],
      ['#rail .feat', 80, 0],
      ['.vs', 0, 0],
      ['.foot-top > h2, .foot-top > p, .foot-top > .foot-cta', 80, 0],
      ['.foot-nav > *', 60, 0],
    ];
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    groups.forEach(function (g) {
      document.querySelectorAll(g[0]).forEach(function (el, i) {
        if (g[2] && i >= g[2]) return; // only the first cards in a row stagger; the rest are off screen
        el.classList.add('rv');
        el.style.setProperty('--d', (i % 6) * g[1] + 'ms');
        io.observe(el);
      });
    });
    var vs = document.getElementById('vs');
    if (vs) io.observe(vs);
    // Content that changes with the audience toggle crossfades instead of jumping.
    document.querySelectorAll('[data-a], .stack-pin .head .display, #deck, .features .title, #rail, #safe-grid, #statement, .compare .title, #vs').forEach(function (el) { el.classList.add('swap-target'); });
  }

  window.GOBYE_RENDER_TRUST = renderTrust;
  function init() {
    bindText();
    var trust = document.getElementById('trust-content');
    if (trust && !trust.hasAttribute('data-rendered')) renderTrust(trust);
    if (document.getElementById('waitlist')) setupWaitlist();
    heroVideo();
    if (document.getElementById('cta-waitlist')) renderLaunch();
    setupReveal();
    setupAudience();
    setupNav();
    setupScroll();
    renderFooter();
    setupRoad();
    renderPeople();
    var y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
