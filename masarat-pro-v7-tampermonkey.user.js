// ==UserScript==
// @name         Masarat Pro v7 (Fleet Alerts Sync)
// @namespace    masarat-pro-v7
// @version      7.0
// @description  Scrape Masarat tracking dashboard and sync to your server; detect alerts.
// @match        https://masarat.sa/*
// @match        https://masarat.sa/*/*
// @grant        GM_xmlhttpRequest
// @connect      YOUR_RAILWAY_URL
// ==/UserScript==

(function () {
  'use strict';

  // ============================
  // CONFIG
  // ============================
  const SYNC_URL = 'https://YOUR_RAILWAY_URL/api/sync';
  const ALERT_URL = 'https://YOUR_RAILWAY_URL/api/alert';

  const INTERVAL_MS = 60 * 1000;
  const DEBUG = false;

  // Alert de-duplication (avoid spamming the same alert repeatedly)
  // key: `${plate}|${type}|${payloadHash}` => lastTime
  const sentCache = new Map();
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  function log() {
    if (!DEBUG) return;
    console.log('[MasaratPro v7 TM]', ...arguments);
  }

  function normalizePlate(p) {
    if (!p) return '';
    let s = String(p).trim();
    // Arabic digits => latin digits
    '٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (s = s.replaceAll(d, String(i))));
    s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    // keep alnum Arabic/latin
    return s.replace(/[^a-zA-Z0-9\u0621-\u064A]/g, '');
  }

  function safeText(el) {
    if (!el) return '';
    return (el.textContent || '').trim();
  }

  function getFirstText(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && safeText(el)) return safeText(el);
    }
    return '';
  }

  // ============================
  // SCRAPING
  // ============================
  // NOTE: The exact DOM on masarat.sa can change.
  // The following tries multiple common patterns and falls back gracefully.

  function scrapeVehicles() {
    // Try to locate the vehicles table/list on the dashboard.
    // We'll scan rows and extract common fields.

    const vehicles = [];

    // Common candidates: tables with rows
    const rowCandidates = Array.from(document.querySelectorAll('table tbody tr'));

    // Fallback: cards/grids
    const cardCandidates = Array.from(document.querySelectorAll('[data-plate], .vehicle-card, .card'));

    const rows = rowCandidates.length > 0 ? rowCandidates : [];

    if (rows.length === 0) {
      // Fallback scrape from cards if no table rows exist
      for (const card of cardCandidates.slice(0, 300)) {
        const plate = normalizePlate(card.getAttribute('data-plate') || getFirstText([
          '[class*=plate]',
          '.plate',
          '[aria-label*=plate]',
        ]));

        if (!plate) continue;

        const lat = parseFloat(getFirstText(['[class*=lat]', '[aria-label*=lat]', '[data-lat]'] || ''));
        const lng = parseFloat(getFirstText(['[class*=lng]', '[aria-label*=lng]', '[data-lng]'] || ''));

        const speedStr = getFirstText(['[class*=speed]', '.speed', '[aria-label*=speed]']);
        const speed = Number(String(speedStr).replace(/[^0-9.]/g, '')) || 0;

        const status = getFirstText(['[class*=status]', '.status', '[aria-label*=status]']);

        vehicles.push({
          key: plate,
          plate,
          live: {
            plate,
            lat: isFinite(lat) ? lat : 0,
            lng: isFinite(lng) ? lng : 0,
            speed,
            status,
          },
        });
      }

      return vehicles;
    }

    for (const tr of rows.slice(0, 300)) {
      // Pull all cells
      const tds = Array.from(tr.querySelectorAll('td'));
      if (tds.length === 0) continue;

      // Try to find plate in any cell
      let plate = '';
      for (const td of tds) {
        const txt = safeText(td);
        if (txt && txt.length >= 5 && /[A-Za-z0-9]/.test(txt)) {
          // Heuristic: plate-like strings often contain alnum and are short-ish
          const norm = normalizePlate(txt);
          if (norm && norm.length >= 5 && norm.length <= 12) {
            plate = norm;
            break;
          }
        }
      }

      if (!plate) continue;

      // Extract likely coordinates: search for numbers that look like lat/lng
      const fullText = safeText(tr);

      const latMatch = fullText.match(/(-?\d{1,3}\.\d{5,}|-?\d{1,2}\.\d{5,})/);
      // More robust: try data attributes first
      const latAttr = parseFloat(tr.getAttribute('data-lat') || '');
      const lngAttr = parseFloat(tr.getAttribute('data-lng') || '');

      let lat = isFinite(latAttr) ? latAttr : (latMatch ? parseFloat(latMatch[1]) : 0);

      // lng as the second decimal number found in row
      const decimals = (fullText.match(/-?\d{1,3}\.\d{5,}/g) || []).map(Number);
      let lng = 0;
      if (isFinite(lngAttr)) lng = lngAttr;
      else if (decimals.length >= 2) lng = decimals[1];

      const speedStr = getFirstText([
        '[class*=speed]',
        '.speed',
        '[aria-label*=speed]',
      ]);

      // Speed sometimes appears in cells
      let speed = 0;
      for (const td of tds) {
        const txt = safeText(td);
        if (txt && /km\/h|كم\/س|سرعة|Speed/i.test(tr.innerText)) {
          const n = Number(String(txt).replace(/[^0-9.]/g, ''));
          if (isFinite(n)) speed = n;
        }
      }

      // Status text
      let status = '';
      for (const td of tds) {
        const txt = safeText(td);
        if (txt && /offline|متوقف|متصل|انقطاع|توقف|تشغيل|إيقاف|لا يعمل|online|online/i.test(txt)) {
          status = txt;
          break;
        }
      }
      if (!status) {
        status = getFirstText([
          '[class*=status]',
          '.status',
          '[aria-label*=status]',
        ]);
      }

      vehicles.push({
        key: plate,
        plate,
        live: {
          plate,
          lat: isFinite(lat) ? lat : 0,
          lng: isFinite(lng) ? lng : 0,
          speed: Number.isFinite(speed) ? speed : 0,
          status: status || '---',
        }
      });
    }

    return vehicles;
  }

  // ============================
  // ALERT DETECTION
  // ============================
  // We only detect what we can reliably infer from scraped fields.
  // The server expects specific alert keys. We'll send to /api/alert with:
  // { type, icon, plate, msg, addr, time }
  // For types we can't infer, we skip.

  function hashPayload(obj) {
    try {
      return JSON.stringify(obj).slice(0, 300);
    } catch {
      return String(obj);
    }
  }

  function shouldSendAlert(alertType, plate, payload) {
    const now = Date.now();
    // ttl cleanup
    for (const [k, v] of sentCache.entries()) {
      if (now - v > CACHE_TTL_MS) sentCache.delete(k);
    }

    const key = `${plate}|${alertType}|${hashPayload(payload)}`;
    if (sentCache.has(key)) return false;
    sentCache.set(key, now);
    return true;
  }

  function postJSON(url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(body),
        onload: function (resp) {
          try {
            const text = resp.responseText || '';
            resolve({ status: resp.status, text });
          } catch (e) {
            resolve({ status: resp.status });
          }
        },
        onerror: function (err) {
          reject(err);
        }
      });
    });
  }

  async function sendAlert(type, icon, plate, msg, addr) {
    const time = new Date().toISOString();
    await postJSON(ALERT_URL, { type, icon, plate, msg, addr: addr || '---', time });
  }

  async function detectAndSendAlerts(vehicles) {
    // Heuristic thresholds
    const SPEED_LIMIT_KMH = 90; // adjust if your policy differs

    for (const v of vehicles) {
      const live = v.live || {};
      const plate = normalizePlate(live.plate || v.plate || '');
      if (!plate) continue;

      const speed = Number(live.speed || 0);
      const lat = Number(live.lat || 0);
      const lng = Number(live.lng || 0);

      const addr = (lat && lng && lat !== 0 && lng !== 0)
        ? `${lat.toFixed(6)},${lng.toFixed(6)}`
        : '---';

      // engine stop (best-effort): if status contains stop keywords and speed ~0
      const statusTxt = String(live.status || '').toLowerCase();

      // offline device: best-effort keyword
      const isOffline = /offline|انقطاع|غير متصل|disconnected/i.test(statusTxt);

      const isStop = /stop|متوقف|توقف|engine off|إيقاف|مطفأ/i.test(statusTxt) && speed <= 5;

      const isSpeeding = speed > SPEED_LIMIT_KMH;

      // external/industrial/security/geofence/towing/oil... are not inferable reliably here
      // without the exact dashboard fields (zone name, ignition, oil remaining, offlineTime, etc.)
      // We'll only generate the alerts we can infer.

      const nowPayloadBase = { speed, lat, lng, status: statusTxt };

      if (isStop) {
        if (shouldSendAlert('stop', plate, nowPayloadBase)) {
          await sendAlert('stop', '🔴', plate, 'تم رصد توقف المحرك (حسب حالة الشاشة).', addr);
        }
      }

      if (isOffline) {
        if (shouldSendAlert('offline', plate, nowPayloadBase)) {
          await sendAlert('offline', '📵', plate, 'تم رصد انقطاع الجهاز (حسب حالة الشاشة).', addr);
        }
      }

      if (isSpeeding) {
        if (shouldSendAlert('speed', plate, { ...nowPayloadBase, speed })) {
          await sendAlert('speed', '⚡', plate, `سرعة مفرطة: ${speed} كم/س (حسب العداد في الشاشة).`, addr);
        }
      }
    }
  }

  // ============================
  // MAIN LOOP
  // ============================
  async function tick() {
    try {
      const vehicles = scrapeVehicles();
      log('vehicles scraped:', vehicles.length);
      if (!vehicles.length) return;

      // Send sync every tick
      await postJSON(SYNC_URL, { vehicles });

      // Detect & send alerts
      await detectAndSendAlerts(vehicles);
    } catch (e) {
      console.error('[MasaratPro TM] Tick error:', e);
    }
  }

  // Start immediately and then every interval
  tick();
  setInterval(tick, INTERVAL_MS);
})();

