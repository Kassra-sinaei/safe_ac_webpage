/* ============================================================
   Safe Adaptive Control — deck engine
   Fixed 1600x900 stage, fragment stepping, overlays, timer.
   ============================================================ */
(function () {
  'use strict';

  var TALK_SECONDS = 170;                       // 2 min 50 s of podium time
  var stage    = document.getElementById('stage');
  var slides   = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var progress = document.getElementById('progress');
  var counter  = document.getElementById('counter');
  var secmark  = document.getElementById('sectionmark');
  var hint     = document.getElementById('hint');
  var timerEl  = document.getElementById('timer');
  var ovOverlay = document.getElementById('overview');
  var ovGrid    = document.getElementById('ovGrid');
  var helpOverlay  = document.getElementById('help');
  var notesOverlay = document.getElementById('notes');
  var notesBody    = document.getElementById('notesBody');

  /* Corner QR dock: one template, copied into every slide marked data-scan. */
  var scanTpl = document.getElementById('scan-tpl');
  if (scanTpl) {
    slides.forEach(function (s) {
      if (s.hasAttribute('data-scan')) s.appendChild(scanTpl.content.cloneNode(true));
    });
  }

  var cur = 0;      // current slide index
  var step = 0;     // fragments revealed on current slide

  /* Backup slides live after the talk and are numbered B-1, B-2, … They are
     deliberately kept out of the main count so "13 / 13" reads as the end of
     the talk, not as three slides still to go. */
  var isBackup = slides.map(function (s) {
    return (s.dataset.section || '').toLowerCase() === 'backup' || s.hasAttribute('data-backup');
  });
  var mainTotal = isBackup.filter(function (b) { return !b; }).length;
  var label = [];                       // per-slide display number
  var mainIndex = [];                   // main-deck ordinal, or -1 for backups
  (function () {
    var m = 0, bk = 0;
    slides.forEach(function (s, i) {
      if (isBackup[i]) { bk++; label[i] = 'B-' + bk; mainIndex[i] = -1; }
      else { m++; label[i] = String(m).padStart(2, '0'); mainIndex[i] = m; }
    });
  })();
  function firstBackup() { return isBackup.indexOf(true); }

  /* ---------- scale the 1600x900 stage into the viewport ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- fragments ---------- */
  function fragsOf(i) {
    return Array.prototype.slice.call(slides[i].querySelectorAll('.frag'))
      .sort(function (a, b) {
        return (+a.dataset.f || 0) - (+b.dataset.f || 0);
      });
  }
  // ?all — reveal every fragment on every slide (review / print-to-PDF)
  var REVEAL_ALL = /(\?|&)all\b/.test(location.search);

  function applyFrags() {
    fragsOf(cur).forEach(function (el, k) {
      el.classList.toggle('in', REVEAL_ALL || k < step);
    });
  }

  /* ---------- media ---------- */
  function media(i) {
    return Array.prototype.slice.call(slides[i].querySelectorAll('video'));
  }
  function startMedia(i) {
    media(i).forEach(function (v) {
      if (v.hasAttribute('data-autoplay')) {
        // data-rate="2" plays the clip sped up (e.g. to fit a 40 s run into a 24 s slide)
        var rate = parseFloat(v.dataset.rate) || 1;
        v.defaultPlaybackRate = rate; v.playbackRate = rate;
        try { v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); }
        catch (e) {}
      }
    });
  }
  function stopMedia(i) {
    media(i).forEach(function (v) { try { v.pause(); } catch (e) {} });
  }

  /* ---------- rendering ---------- */
  function render(prev) {
    if (prev !== cur && prev != null) {
      slides[prev].classList.remove('active', 'enter');
      stopMedia(prev);
    }
    var s = slides[cur];
    s.classList.add('active');
    if (prev !== cur) {
      s.classList.remove('enter');
      void s.offsetWidth;              // restart the entry animation
      s.classList.add('enter');
      startMedia(cur);
    }
    applyFrags();

    if (isBackup[cur]) {
      progress.style.width = '100%';
      progress.classList.add('backup');
      counter.innerHTML = '<b>' + label[cur] + '</b> <span class="bk">backup</span>';
    } else {
      progress.style.width = (mainIndex[cur] / mainTotal * 100) + '%';
      progress.classList.remove('backup');
      counter.innerHTML = '<b>' + label[cur] + '</b> / ' + String(mainTotal).padStart(2, '0');
    }
    var sec = s.dataset.section || '';
    secmark.innerHTML = sec ? '<span class="dot">&#9679;</span> ' + sec : '';
    // the QR dock owns the top-right corner, so the timer steps aside (deck.css)
    document.body.classList.toggle('scan-on', s.hasAttribute('data-scan'));
    if (history.replaceState) {
      history.replaceState(null, '', '#' + (isBackup[cur] ? label[cur].toLowerCase() : cur + 1));
    }
    syncOverview();
    syncNotes();
  }

  function goto(i, atEnd) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    if (REVEAL_ALL) atEnd = false;
    var prev = cur;
    cur = i;
    step = atEnd ? fragsOf(cur).length : 0;
    render(prev);
  }

  function next() {
    var f = fragsOf(cur);
    if (step < f.length) { step++; applyFrags(); return; }
    if (cur < slides.length - 1) goto(cur + 1, false);
  }
  function prev() {
    if (step > 0) { step--; applyFrags(); return; }
    if (cur > 0) goto(cur - 1, true);
  }
  function nextSlide() { if (cur < slides.length - 1) goto(cur + 1, false); }
  function prevSlide() { if (cur > 0) goto(cur - 1, false); }

  /* ---------- overlays ---------- */
  function anyOverlayOpen() {
    return ovOverlay.classList.contains('on') ||
           helpOverlay.classList.contains('on') ||
           notesOverlay.classList.contains('on');
  }
  function closeOverlays() {
    [ovOverlay, helpOverlay, notesOverlay].forEach(function (o) { o.classList.remove('on'); });
  }
  function toggleOverlay(o) {
    var was = o.classList.contains('on');
    closeOverlays();
    if (!was) o.classList.add('on');
  }

  function buildOverview() {
    ovGrid.innerHTML = '';
    slides.forEach(function (s, i) {
      var d = document.createElement('div');
      d.className = 'ovcell' + (isBackup[i] ? ' isbackup' : '');
      d.innerHTML =
        '<div class="n' + (isBackup[i] ? ' bk' : '') + '">' + label[i] + '</div>' +
        '<div class="t">' + (s.dataset.title || 'Slide ' + (i + 1)) + '</div>' +
        '<div class="s">' + (s.dataset.section || '') + '</div>';
      d.addEventListener('click', function () { closeOverlays(); goto(i, false); });
      ovGrid.appendChild(d);
    });
  }
  function syncOverview() {
    Array.prototype.forEach.call(ovGrid.children, function (c, i) {
      c.classList.toggle('cur', i === cur);
    });
  }

  function buildNotes() {
    notesBody.innerHTML = '';
    slides.forEach(function (s, i) {
      var a = s.querySelector('aside.notes');
      var d = document.createElement('div');
      d.className = 'noteitem';
      d.innerHTML =
        '<div class="nh"><span class="nn' + (isBackup[i] ? ' bk' : '') + '">' + label[i] + '</span>' +
        '<span class="nt">' + (s.dataset.title || '') + '</span>' +
        '<span class="nsec">' + (s.dataset.section || '') +
        (s.dataset.time ? ' &middot; ' + s.dataset.time + 's' : '') + '</span></div>' +
        '<div class="nb">' + (a ? a.innerHTML : '<i>&mdash;</i>') + '</div>';
      d.addEventListener('click', function () { closeOverlays(); goto(i, false); });
      notesBody.appendChild(d);
    });
  }
  function syncNotes() {
    Array.prototype.forEach.call(notesBody.children, function (c, i) {
      c.classList.toggle('cur', i === cur);
    });
    if (notesOverlay.classList.contains('on') && notesBody.children[cur]) {
      notesBody.children[cur].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  /* ---------- timer ---------- */
  var tStart = null, tRun = false, tTick = null;
  function fmt(x) {
    var neg = x < 0; x = Math.abs(x);
    return (neg ? '−' : '') + Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0');
  }
  function tickTimer() {
    if (!tRun) return;
    var el = Math.floor((Date.now() - tStart) / 1000);
    var left = TALK_SECONDS - el;
    // where should we be, by cumulative per-slide budget?
    var budget = 0, total = 0;
    slides.forEach(function (s, i) {
      var t = +s.dataset.time || 0;
      total += t;
      if (i < cur) budget += t;
    });
    var expected = total ? Math.round(budget / total * TALK_SECONDS) : 0;
    var drift = el - expected;
    var pace = Math.abs(drift) <= 8 ? 'ON PACE'
             : (drift > 0 ? 'BEHIND ' + fmt(drift) : 'AHEAD ' + fmt(-drift));
    timerEl.innerHTML = fmt(left) + '<span class="pace">' + pace + '</span>';
    timerEl.classList.toggle('warn', left <= 30 && left > 0);
    timerEl.classList.toggle('over', left <= 0);
  }
  function toggleTimer() {
    if (!timerEl.classList.contains('on')) {
      timerEl.classList.add('on');
      tStart = Date.now(); tRun = true;
      tTick = setInterval(tickTimer, 250); tickTimer();
    } else {
      timerEl.classList.remove('on', 'warn', 'over');
      tRun = false; clearInterval(tTick);
    }
  }
  function resetTimer() { if (tRun) { tStart = Date.now(); tickTimer(); } }

  /* ---------- fullscreen ---------- */
  function toggleFS() {
    var d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      var e = d.documentElement;
      (e.requestFullscreen || e.webkitRequestFullscreen || function () {}).call(e);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || function () {}).call(d);
    }
  }

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;

    if (k === 'Escape') { if (anyOverlayOpen()) { closeOverlays(); e.preventDefault(); } return; }

    switch (k) {
      case 'ArrowRight': case ' ': case 'PageDown': case 'n':
        next(); e.preventDefault(); break;
      case 'ArrowLeft': case 'PageUp': case 'p': case 'Backspace':
        prev(); e.preventDefault(); break;
      case 'ArrowDown':
        nextSlide(); e.preventDefault(); break;
      case 'ArrowUp':
        prevSlide(); e.preventDefault(); break;
      case 'Home': goto(0, false); e.preventDefault(); break;
      case 'End': {
        var lastMain = mainIndex.lastIndexOf(mainTotal);
        goto(cur === lastMain ? slides.length - 1 : lastMain, false);
        e.preventDefault(); break;
      }
      case 'f': case 'F': toggleFS(); e.preventDefault(); break;
      case 'o': case 'O': toggleOverlay(ovOverlay); e.preventDefault(); break;
      case 's': case 'S': toggleOverlay(notesOverlay); syncNotes(); e.preventDefault(); break;
      case 't': case 'T': toggleTimer(); e.preventDefault(); break;
      case 'r': case 'R': resetTimer(); e.preventDefault(); break;
      case 'b': case 'B': document.body.classList.toggle('blackout'); e.preventDefault(); break;
      case '?': case '/': toggleOverlay(helpOverlay); e.preventDefault(); break;
      default:
        if (/^[0-9]$/.test(k)) {                       // type a number, then Enter
          jumpBuf += k;
          clearTimeout(jumpTimer);
          jumpTimer = setTimeout(function () {
            var i = parseInt(jumpBuf, 10);
            jumpBuf = '';
            var t = mainIndex.indexOf(i);          // main-deck numbering
            if (t >= 0) goto(t, false);
          }, 550);
          e.preventDefault();
        }
    }
  });
  var jumpBuf = '', jumpTimer = null;

  /* ---------- pointer / touch ---------- */
  document.addEventListener('click', function (e) {
    if (anyOverlayOpen()) return;
    if (e.target.closest('a, video, button, .ovcell, .noteitem')) return;
    (e.clientX < window.innerWidth * 0.22 ? prev : next)();
  });

  var tx = 0, ty = 0;
  document.addEventListener('touchstart', function (e) {
    tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - tx;
    var dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
  }, { passive: true });

  /* ---------- boot ---------- */
  buildOverview();
  buildNotes();

  var h = (location.hash || '').replace('#', '').toLowerCase();
  var bm = h.match(/^b-?(\d+)$/);
  if (bm) {
    var bi = firstBackup() + (parseInt(bm[1], 10) - 1);
    cur = (firstBackup() >= 0 && bi < slides.length) ? bi : 0;
  } else {
    var start = parseInt(h, 10);
    cur = (start >= 1 && start <= slides.length) ? start - 1 : 0;
  }
  step = 0;
  render(null);
  startMedia(cur);

  hint.classList.add('show');
  setTimeout(function () { hint.classList.remove('show'); }, 5200);
})();
