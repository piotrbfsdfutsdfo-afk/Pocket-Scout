// content.js — Auto Trader (v3.0.3 — PS v11.0.3 Proof-of-Performance: blocks when <3 high-conf signals)
(function(){
  'use strict';
  if (window.__AT_CONTENT_300) return; // v3.0.0
  window.__AT_CONTENT_300 = true;

  /* ===================== CONSTANTS ===================== */
  const DEFAULT_PRICE_OFFSET_PIPS = 5;  // Default price offset for pending trades
  const TICK_INTERVAL_MS = 700;         // Main loop polling interval

  console.log('[AutoTrader] v3.0.3 - PS v11.0.3 Proof-of-Performance (blocks when <3 high-conf signals)');

  /* ===================== PERSIST / KEYS ===================== */
  const LS = {
    THRESHOLD:'AT_THRESHOLD',      // próg wejścia % (SZANUJEMY W 100%)
    ACTIVE:'AT_ACTIVE',            // ON/OFF (pauza)
    STOP_ABS:'AT_STOP_BAL',        // STOP kwotowy (saldo)
    DD_PCT:'AT_DD_PCT',            // maks. spadek od piku (%)
    PEAK:'AT_PEAK_BAL',            // zapamiętany szczyt salda
    PEAK_TS:'AT_PEAK_TS',
    COOLDOWN:'AT_COOLDOWN_SEC',    // cooldown symbolu (sek)
    MINIMIZED:'AT_PANEL_MIN',      // panel zwinięty (true/false)
    SKIP_LOW_WR:'AT_SKIP_LOW_WR',   // v3.0.0: blokada gdy ogólny WR wszystkich sygnałów < 54%
    SKIP_LOW_WR_CONF50:'AT_SKIP_LOW_WR_CONF50',  // v3.0.0: blokada gdy WR dla conf>=70% < 54%
    PRICE_OFFSET:'AT_PRICE_OFFSET'  // v3.0.0: offset ceny dla pending trades (pips)
  };

  // v3.0.0: WR thresholds for blocking
  const WR_THRESHOLD_OVERALL = 54;      // Block if overall WR < 54%
  const WR_THRESHOLD_CONF50 = 54;       // Block if high-conf WR < 54%

  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lsNum=(k,d)=>{ const v=localStorage.getItem(k); const n=v==null?NaN:parseFloat(v); return Number.isFinite(n)?n:d; };
  const lsBool=(k,d)=>{ const v=localStorage.getItem(k); return v==null?d:(v==='true'); };

  /**
   * ✅ v3.0.0: Mapping from Pocket Scout pair format to Pocket Option asset values
   * Pocket Scout format: "EUR/USD_OTC"
   * Pocket Option dropdown value: "EURUSD_otc"
   */
  const PAIR_TO_ASSET_MAP = {
    'EUR/USD_OTC': 'EURUSD_otc',
    'GBP/USD_OTC': 'GBPUSD_otc',
    'AUD/CAD_OTC': 'AUDCAD_otc',
    'EUR/JPY_OTC': 'EURJPY_otc',
    'USD/JPY_OTC': 'USDJPY_otc',
    'AUD/USD_OTC': 'AUDUSD_otc',
    'NZD/USD_OTC': 'NZDUSD_otc',
    'USD/CHF_OTC': 'USDCHF_otc',
    'USD/CAD_OTC': 'USDCAD_otc',
    'GBP/JPY_OTC': 'GBPJPY_otc'
  };

  /**
   * ✅ v3.0.0: Precision map for different pair types
   * Used to calculate appropriate price offset for pending trades
   */
  const PAIR_PRECISION = {
    'EUR/USD_OTC': 5,  // 5 decimal places (0.00001)
    'GBP/USD_OTC': 5,
    'AUD/CAD_OTC': 5,
    'AUD/USD_OTC': 5,
    'NZD/USD_OTC': 5,
    'USD/CHF_OTC': 5,
    'USD/CAD_OTC': 5,
    'EUR/JPY_OTC': 3,  // 3 decimal places (0.001)
    'USD/JPY_OTC': 3,
    'GBP/JPY_OTC': 3
  };

  /**
   * ✅ v3.0.0: Get the price offset for a given pair
   * Returns offset in the pair's native precision (e.g., 0.00005 for 5-decimal pairs)
   */
  function getPriceOffset(pair) {
    const precision = PAIR_PRECISION[pair] || 5;
    const basePips = lsNum(LS.PRICE_OFFSET, DEFAULT_PRICE_OFFSET_PIPS);
    // For 5-decimal pairs: 5 pips = 0.00005
    // For 3-decimal pairs: 5 pips = 0.005
    return basePips * Math.pow(10, -precision);
  }

  /**
   * ✅ v2.7.0: Read Rolling Window from Pocket Scout Adaptive DOM
   * Priority:
   * 1. DOM input element #ps-rolling-window-input (PS Adaptive v18)
   * 2. localStorage PS_ROLLING_WINDOW_MINUTES (legacy fallback)
   * 3. null if not available
   */
  function getPocketScoutRollingWindow(){
    try {
      // ✅ PRIMARY: Read from PS Adaptive v18 DOM input element
      const inputEl = document.querySelector('#ps-rolling-window-input');
      if (inputEl && inputEl.value) {
        const val = parseInt(inputEl.value, 10);
        if (Number.isFinite(val) && val >= 5 && val <= 180) {
          return val;
        }
      }

      // ✅ SECONDARY: Try to find RW from PS panel text (e.g., "Current: 15min")
      const rwValueEl = document.querySelector('#ps-rolling-window-value');
      if (rwValueEl) {
        const text = rwValueEl.textContent || '';
        const match = text.match(/(\d+)\s*min/i);
        if (match) {
          const val = parseInt(match[1], 10);
          if (Number.isFinite(val) && val >= 5 && val <= 180) {
            return val;
          }
        }
      }

      // ✅ FALLBACK: localStorage (legacy)
      const raw = localStorage.getItem('PS_ROLLING_WINDOW_MINUTES');
      if (raw != null) {
        const val = parseInt(raw, 10);
        if (Number.isFinite(val) && val > 0) return val;
      }
    } catch(e) {
      console.warn('[AutoTrader] Error reading Rolling Window:', e);
    }
    return null;
  }

  /* ===================== FEED z Pocket Scout ===================== */
  // V3.0.0: Priority signal buffer for signals ≥70%
  let __PRIORITY_BUFFER = null;
  let __PRIORITY_BUFFER_TS = 0;
  const PRIORITY_BUFFER_TTL_MS = 45 * 1000; // Keep priority signal for 45s

  /**
   * ✅ v3.0.0: Enhanced feed reading with Multi-Pair support (Pocket Scout v10.7.0)
   * Signal structure now includes:
   * - pair: "EUR/USD_OTC" - the currency pair name (CRITICAL for v3.0.0)
   * - action: "BUY" or "SELL"
   * - confidence: 0-100
   * - duration: minutes (1-15)
   * - entryPrice: the price at which to open the trade
   * - timestamp: signal generation time
   */
  function readPSFeed(){
    try{
      const raw = localStorage.getItem('PS_AT_FEED');
      if (!raw) {
        // Debug: Log when feed is empty
        if (Date.now() % 10000 < 1500) { // Log roughly every 10 seconds
          console.log('[AutoTrader] ℹ️ No feed data in PS_AT_FEED');
        }
        return null;
      }
      const parsed = JSON.parse(raw);

      // v3.0.0: Support PS v10.7.0 format with bestSignal containing pair field
      let signals = null;
      if (Array.isArray(parsed)) {
        signals = parsed; // legacy array
      } else if (parsed && Array.isArray(parsed.signals)) {
        signals = [...parsed.signals];
        if (parsed.bestSignal) signals.unshift(parsed.bestSignal); // ensure best goes first
      } else if (parsed && parsed.bestSignal) {
        // v3.0.0: Primary format - single bestSignal with pair field
        signals = [parsed.bestSignal];
      }

      // Debug: Log feed contents periodically
      if (signals && signals.length > 0 && Date.now() % 10000 < 1500) {
        // v3.0.0: Detect if signal has pair field (PS v10.7.0)
        const hasMultiPair = signals.some(s => s.pair !== undefined);
        const source = hasMultiPair ? 'Pocket Scout v10.7.0 Multi-Pair' : 'Pocket Scout Legacy';

        console.log(`[AutoTrader] ✅ Feed read from ${source}: ${signals.length} signal(s) - ${signals.map(s => {
          const pair = s.pair ? `[${s.pair}]` : '';
          const conf = s.confidence || 0;
          const price = s.entryPrice ? ` @${s.entryPrice}` : '';
          return `${pair} ${s.action || '?'}@${conf}%${price}`;
        }).join(', ')}`);
      }

      // V3.0.0: Store high-confidence signals (≥70%) in priority buffer
      if (signals && signals.length > 0) {
        const bestSignal = signals[0];
        const conf = bestSignal.confidence ?? bestSignal.displayConf ?? bestSignal.autoConfidence ?? 0;
        if (conf >= 70) {
          __PRIORITY_BUFFER = bestSignal;
          __PRIORITY_BUFFER_TS = Date.now();
          const pairInfo = bestSignal.pair ? `[${bestSignal.pair}]` : '';
          console.log(`[AutoTrader] 🎯 Priority signal buffered: ${pairInfo} ${bestSignal.action}@${conf}% (will expire in ${PRIORITY_BUFFER_TTL_MS/1000}s)`);
        }
      }

      return signals;
    }
    catch(e){
      console.warn('[AutoTrader] ❌ Error reading PS feed:', e);
      return null;
    }
  }

  /**
   * ✅ v3.0.0: Read Pocket Scout statistics from localStorage
   * Returns { winRate, highConfWinRate, totalSignals, highConfTotal }
   * Used for WR-based blocking decisions
   */
  function getPocketScoutStats() {
    try {
      const raw = localStorage.getItem('PS_V10_STATS');
      if (!raw) return null;

      const stats = JSON.parse(raw);
      const total = stats.total || 0;
      const wins = stats.wins || 0;
      const highConfTotal = stats.highConfTotal || 0;  // Signals with conf >= 70%
      const highConfWins = stats.highConfWins || 0;

      return {
        totalSignals: total,
        winRate: total > 0 ? (wins / total) * 100 : null,
        highConfTotal: highConfTotal,
        highConfWinRate: highConfTotal > 0 ? (highConfWins / highConfTotal) * 100 : null
      };
    } catch(e) {
      console.warn('[AutoTrader] Error reading PS stats:', e);
      return null;
    }
  }

  function getMinutes(sig){
    // ✅ Primary: explicit minutes or duration (Pocket Scout v3.0)
    if (Number.isFinite(sig.minutes)) return sig.minutes;
    if (Number.isFinite(sig.duration)) return sig.duration; // Pocket Scout v3.0 uses "duration"
    // ✅ From optimalExpiry (Pocket Scout v18 feed) in seconds
    if (Number.isFinite(sig.optimalExpiry)) return Math.round(sig.optimalExpiry / 60);
    // ✅ From expirySeconds (bridge) in seconds
    if (Number.isFinite(sig.expirySeconds)) return Math.round(sig.expirySeconds / 60);
    // ✅ From expiry in seconds (Pocket Scout v3.0)
    if (Number.isFinite(sig.expiry) && sig.expiry > 15) return Math.round(sig.expiry / 60); // If >15, assume seconds
    // ✅ From expiry in minutes (legacy)
    if (Number.isFinite(sig.expiry)) return sig.expiry;
    if (Number.isFinite(sig.expiryMinutes)) return sig.expiryMinutes;
    return null;
  }

  function getConfidence(sig){
    // ✅ V18.0.16: Support all known confidence fields from Pocket Scout v18 feed
    // Priority: explicit confidence > displayConf > other fields
    // Auto-promoted signals have confidence set to 70%+ even if base was lower
    const conf = sig.confidence
        ?? sig.displayConf
        ?? sig.confDisplay
        ?? sig.autoConfidence
        ?? sig.bestConfidence
        ?? sig.winRate // fallback: use WR if confidence missing
        ?? 0;

    // V18.0.16: Log auto-promoted signals for debugging
    if (sig.isAutoPromoted && conf >= 70) {
      console.log(`[AutoTrader] ✅ Auto-promoted signal detected: ${sig.model || sig.groupId} @ ${conf}% confidence`);
    }

    return conf;
  }

  // wybór NAJWIĘKSZEGO sygnału ≥ próg (confidence desc, potem minuty asc)
  // V18.0.17: Enhanced to properly handle auto-promoted signals and timestamp freshness
  // V10.5.0: Extended signal freshness window to 30s for better signal capture
  function pickSignal(feed, thr){
    if(!feed || !Array.isArray(feed)) return null;

    const now = Date.now();
    const MAX_SIGNAL_AGE_MS = 30 * 1000; // Signals older than 30s are considered stale (extended from 15s)

    const candidates = feed.filter(it=>{
      const mins = getMinutes(it);
      const action = (it.action || '').toUpperCase();
      const okMin = Number.isFinite(mins) && mins>=1 && mins<=15;
      const okAct = action==='BUY' || action==='SELL';
      const conf = getConfidence(it);

      // V2.9.0: Check signal freshness using timestamp (Pocket Scout v3.0 compatibility)
      const signalTimestamp = it.timestamp || 0;
      const signalAge = now - signalTimestamp;
      const isFresh = signalTimestamp > 0 && signalAge <= MAX_SIGNAL_AGE_MS;

      // V2.9.0: Support both auto-promoted signals and Pocket Scout v3.0 signals
      const isValid = okMin && okAct && conf >= thr && isFresh;

      // V2.9.0: Enhanced logging for Pocket Scout v3.0 signals
      if (isValid) {
        const source = it.duration !== undefined && it.wr !== undefined ? 'PS v3.0' : (it.isAutoPromoted ? 'Auto-promoted' : 'Legacy');
        const wr = it.wr !== undefined ? ` | WR:${it.wr.toFixed(1)}%` : '';
        console.log(`[AutoTrader] ✅ Valid candidate [${source}]: ${action} @ ${conf}%${wr} (${mins}min, age: ${Math.round(signalAge/1000)}s)`);
      }

      if (!isFresh && signalTimestamp > 0) {
        console.log(`[AutoTrader] ⏸️ Signal too old: ${it.model || it.groupId || 'signal'} (age: ${Math.round(signalAge/1000)}s > ${MAX_SIGNAL_AGE_MS/1000}s)`);
      }

      return isValid;
    });

    if(!candidates.length) return null;

    // V2.9.0: Sort with preference for higher confidence, then WR, then auto-promoted
    return candidates
      .map((it,idx)=>({
        ...it,
        action: (it.action || '').toUpperCase(),
        minutes: getMinutes(it),
        confidence: getConfidence(it),
        wr: it.wr || 0, // Include WR in sorting
        __i: idx,
        __isAutoPromoted: it.isAutoPromoted || false
      }))
      .sort((a,b)=> {
        // Primary: confidence (desc)
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        // Secondary: WR (desc) - prefer signals with better historical performance
        if (b.wr !== a.wr) return b.wr - a.wr;
        // Tertiary: auto-promoted signals preferred (same confidence & WR)
        if (a.__isAutoPromoted !== b.__isAutoPromoted) return b.__isAutoPromoted ? 1 : -1;
        // Quaternary: minutes (asc) - prefer shorter duration
        if (a.minutes !== b.minutes) return a.minutes - b.minutes;
        // Quinary: original index
        return a.__i - b.__i;
      })[0];
  }

  /* ===================== HELPERS (DOM/PO) ===================== */
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const pad2 = n => String(n).padStart(2,'0');

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  const setInput=(el,val)=>{ if(!el) return; if(nativeSetter) nativeSetter.call(el,val); else el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  function isVisible(el){ if(!el) return false; const s=getComputedStyle(el);
    if (s.display==='none'||s.visibility==='hidden'||s.opacity==='0') return false;
    const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }

  // payout % (0..1)
  window.__psGetPayoutFraction = window.__psGetPayoutFraction || function(){
    try{
      const primarySel = '#put-call-buttons-chart-1 .value__val-start';
      let n = document.querySelector(primarySel);
      if(!n){
        const generic = Array.from(document.querySelectorAll('[id^="put-call-buttons-chart"] .value__val-start')).filter(isVisible);
        if (generic.length) n = generic[0];
      }
      if (n){
        const raw=(n.textContent||'').trim(); const m = raw.match(/(\d{1,3})(?:[.,](\d+))?/);
        if(m){ const num=parseFloat(m[1].replace(',','.') + (m[2]?'.'+m[2]:'')); if(Number.isFinite(num) && num>=0 && num<=100) return num/100; }
      }
      const sels=['.payout__percent','[class*="payout"][class*="percent"]','.payout .payout__value','.payout__text'];
      for(const sel of sels){
        for(const el of Array.from(document.querySelectorAll(sel)).filter(isVisible)){
          const t=(el.textContent||'').trim(); const mm=t.match(/(\d{1,3})(?:[.,](\d+))?\s*%/);
          if(mm){ const p=parseFloat(mm[1]+(mm[2]?'.'+mm[2]:'')); if(Number.isFinite(p)) return p/100; }
        }
      }
    }catch(e){}
    return null;
  };

  // odczyt salda
  function getBalance(){
    const sels=[
      'header .balance-info-block__data .balance-info-block__balance > span[data-hd-status="show"]',
      'span.js-hd.js-balance-real[data-hd-status="show"]','span.js-hd.js-balance-demo[data-hd-status="show"]',
      'span.js-balance-real','span.js-balance-demo'
    ];
    for(const sel of sels){
      const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
      if(!el) continue;
      let raw=(el.textContent||'').trim();
      if(!raw || !/[0-9]/.test(raw)){
        const attrs=['data-hd-show','data-balance','data-balance-usd']; for(const a of attrs){ const v=el.getAttribute(a); if(v){ raw=v; break; } }
      }
      if(!raw) continue;
      let s=raw.replace(/\s|\u00A0/g,'').replace(/[^0-9.,]/g,''); if(!s) continue;
      const hasDot=s.includes('.'), hasCom=s.includes(',');
      if (hasDot && hasCom){
        const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
        s = s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1);
      } else if (hasDot || hasCom){
        const sep = hasDot ? '.' : ',';
        const parts = s.split(sep);
        if(parts.length > 2){ s = s.replace(new RegExp('\\'+sep,'g'), ''); }
        else { s = s.replace(sep, '.'); }
      }
      const n=parseFloat(s); if(Number.isFinite(n)) return n;
    }
    return null;
  }

  // Cena bieżąca z DOM
  function readPrice(){
    try{
      const sels = [
        'span.open-time-number',
        'span.one-time-number',
        '.trading-chart__price, .chart-price'
      ];
      for (const sel of sels){
        const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        if (!nodes.length) continue;
        const n = nodes[0];
        let t = (n.textContent||'').trim();
        if(!t) continue;
        t = t.replace(/\u00A0/g,'').replace(/\s/g,'');
        if (t.includes(',') && t.includes('.')){
          const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
          t = t.slice(0,last).replace(/[.,]/g,'') + '.' + t.slice(last+1).replace(/[.,]/g,'');
        } else if (t.includes(',')) {
          const parts = t.split(',');
          if (parts[parts.length-1].length===2 || parts[parts.length-1].length===3) {
            t = parts.slice(0,-1).join('').replace(/[.,]/g,'') + '.' + parts[parts.length-1];
          } else {
            t = t.replace(/,/g,'');
          }
        } else {
          const parts = t.split('.');
          if (parts.length>2){
            const last = t.lastIndexOf('.');
            t = t.slice(0,last).replace(/[.]/g,'') + '.' + t.slice(last+1);
          }
        }
        const v = Number(t.replace(/[^\d.-]/g,''));
        if (Number.isFinite(v)) return v;
      }
    }catch(e){}
    return null;
  }

  // ustawienie czasu (HH:MM:SS)
  async function openTimeModal(){
    const trg = document.querySelector('.control__value.value.value--several-items');
    if (!trg) return null; trg.click(); await sleep(250);
    const inputs = Array.from(document.querySelectorAll('.trading-panel-modal__in input[type=text]'));
    return { trg, inputs };
  }
  async function setTimeInputs(hh, mm, ss){
    const res = await openTimeModal(); if (!res || !res.inputs.length) return false;
    let [hEl, mEl, sEl] = res.inputs.length >= 3 ? [res.inputs[0], res.inputs[1], res.inputs[2]] : [null, res.inputs[0], res.inputs[1] || null];
    if (hEl){ hEl.focus(); setInput(hEl, pad2(hh)); }
    if (mEl){ mEl.focus(); setInput(mEl, pad2(mm)); }
    if (sEl){ sEl.focus(); setInput(sEl, pad2(ss)); }
    document.activeElement?.blur?.(); res.trg.click(); await sleep(200);
    const lbl = document.querySelector('.control__value.value.value--several-items .value__val');
    const expected = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
    return !!(lbl && lbl.textContent && lbl.textContent.trim() === expected);
  }
  async function spinMinutesTo(targetMin){
    const res = await openTimeModal(); if (!res || !res.inputs.length) return false;
    const mEl = (res.inputs.length >= 3) ? res.inputs[1] : res.inputs[0];
    if (!mEl) return false;
    const row = mEl.closest('.rw'); const plus=row?.querySelector('.btn-plus'); const minus=row?.querySelector('.btn-minus');
    const readInt = (v)=>parseInt((v||'0').replace(/\D+/g,''),10)||0;
    let cur = readInt(mEl.value), steps=0; const MAX=160;
    while (cur !== targetMin && steps < MAX){ (targetMin>cur?plus:minus)?.click(); steps++; await new Promise(r=>setTimeout(r,35)); cur = readInt(mEl.value); }
    mEl.blur(); res.trg.click(); await new Promise(r=>setTimeout(r,200));
    const lbl = document.querySelector('.control__value.value.value--several-items .value__val');
    return !!(lbl && lbl.textContent && lbl.textContent.includes(`:${pad2(targetMin)}:`));
  }
  async function ensureExpirationMinutes(total){
    const hh = Math.floor(total/60), mm = total % 60, ss = 0;
    if (await setTimeInputs(hh,mm,ss)) return true;
    if (await spinMinutesTo(mm)) return true;
    const inp = document.querySelector('input[name="minutes"], [data-role="minutes"]');
    if (inp){ setInput(inp, String(total)); return true; }
    return false;
  }

  function findButtonByLabel(label){
    const spans = Array.from(document.querySelectorAll('span.payout__text-lh, span.payout__text, .buttons__wrap .value__val-start')).filter(isVisible);
    const span = spans.find(n => (n.textContent||'').trim().toLowerCase().includes(label.toLowerCase()));
    if(!span) return null; const btn = span.closest('a,button'); return btn||span;
  }

  /* ===================== v3.0.0: PENDING TRADES WINDOW FUNCTIONS ===================== */

  /**
   * ✅ v3.0.0: Task 1 - Select the correct currency pair in the asset dropdown
   * Uses the pending trades asset selector (#pending-trades_asset)
   */
  async function selectAsset(pair) {
    const assetValue = PAIR_TO_ASSET_MAP[pair];
    if (!assetValue) {
      console.warn(`[AutoTrader] ⚠️ Unknown pair: ${pair}, cannot map to asset`);
      return false;
    }

    console.log(`[AutoTrader] 📊 Task 1: Selecting asset ${pair} -> ${assetValue}`);

    try {
      // Find the asset dropdown container
      const assetContainer = document.querySelector('#pending-trades_asset');
      if (!assetContainer) {
        console.warn('[AutoTrader] ⚠️ Asset container not found (#pending-trades_asset)');
        return false;
      }

      // Find the dropdown button and click to open
      const dropdownBtn = assetContainer.querySelector('button.dropdown-toggle');
      if (!dropdownBtn) {
        console.warn('[AutoTrader] ⚠️ Dropdown button not found');
        return false;
      }

      // Check if already selected
      const currentSelection = assetContainer.querySelector('.filter-option-inner-inner');
      if (currentSelection) {
        const currentText = (currentSelection.textContent || '').trim().toUpperCase();
        // Convert pair format: "EUR/USD_OTC" -> "EUR/USD OTC"
        const expectedText = pair.replace('_', ' ').toUpperCase();
        if (currentText === expectedText) {
          console.log(`[AutoTrader] ✅ Asset already selected: ${currentText}`);
          return true;
        }
      }

      // Open dropdown
      dropdownBtn.click();
      await sleep(300);

      // Find the select element and set value
      const selectEl = assetContainer.querySelector('select.selectpicker');
      if (selectEl) {
        // Find the option with matching value
        const option = selectEl.querySelector(`option[value="${assetValue}"]`);
        if (option) {
          // Set the value
          selectEl.value = assetValue;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));

          // Also try clicking the dropdown item directly
          await sleep(100);
          const dropdownItems = document.querySelectorAll('.dropdown-menu.open .dropdown-item');
          for (const item of dropdownItems) {
            const itemText = (item.textContent || '').trim().toUpperCase();
            const expectedText = pair.replace('_', ' ').toUpperCase();
            if (itemText === expectedText) {
              item.click();
              break;
            }
          }

          await sleep(200);
          console.log(`[AutoTrader] ✅ Asset selected: ${pair}`);
          return true;
        }
      }

      // Alternative: Click directly on the dropdown item
      const dropdownMenu = document.querySelector('.dropdown-menu.open');
      if (dropdownMenu) {
        const items = dropdownMenu.querySelectorAll('a.dropdown-item');
        for (const item of items) {
          const itemText = (item.textContent || '').trim().toUpperCase();
          const expectedText = pair.replace('_', ' ').toUpperCase();
          if (itemText === expectedText) {
            item.click();
            await sleep(200);
            console.log(`[AutoTrader] ✅ Asset selected via dropdown click: ${pair}`);
            return true;
          }
        }
      }

      // Close dropdown if still open
      document.body.click();
      console.warn(`[AutoTrader] ⚠️ Could not find asset option for: ${pair}`);
      return false;

    } catch (e) {
      console.error('[AutoTrader] ❌ Error selecting asset:', e);
      return false;
    }
  }

  /**
   * ✅ v3.0.0: Task 2 - Set the entry price with adjustment
   * For BUY signals: add small offset so upward candle triggers trade
   * For SELL signals: subtract small offset so downward candle triggers trade
   */
  async function setEntryPrice(entryPrice, action, pair) {
    console.log(`[AutoTrader] 💰 Task 2: Setting entry price ${entryPrice} for ${action} on ${pair}`);

    try {
      // Calculate price offset based on action
      const offset = getPriceOffset(pair);
      let adjustedPrice;

      if (action === 'BUY') {
        // For BUY: add small value so upward candle breaks through
        adjustedPrice = entryPrice + offset;
        console.log(`[AutoTrader] 📈 BUY: ${entryPrice} + ${offset} = ${adjustedPrice}`);
      } else {
        // For SELL: subtract small value so downward candle breaks through
        adjustedPrice = entryPrice - offset;
        console.log(`[AutoTrader] 📉 SELL: ${entryPrice} - ${offset} = ${adjustedPrice}`);
      }

      // Get precision for formatting
      const precision = PAIR_PRECISION[pair] || 5;
      const formattedPrice = adjustedPrice.toFixed(precision);

      // Find the entry price input field
      const priceContainer = document.querySelector('#pending-trades_open-price');
      if (!priceContainer) {
        console.warn('[AutoTrader] ⚠️ Price container not found (#pending-trades_open-price)');
        return false;
      }

      const priceInput = priceContainer.querySelector('input.form-control');
      if (!priceInput) {
        console.warn('[AutoTrader] ⚠️ Price input not found');
        return false;
      }

      // Set the value using native setter for proper event triggering
      setInput(priceInput, formattedPrice);
      await sleep(100);

      console.log(`[AutoTrader] ✅ Entry price set to: ${formattedPrice}`);
      return true;

    } catch (e) {
      console.error('[AutoTrader] ❌ Error setting entry price:', e);
      return false;
    }
  }

  /**
   * ✅ v3.0.0: Task 3 - Set the time frame (duration) for the pending trade
   * Uses the quick-timeframe-selector in the pending trades window
   */
  async function setTimeFrame(minutes) {
    console.log(`[AutoTrader] ⏱️ Task 3: Setting time frame to ${minutes} minutes`);

    try {
      const timeContainer = document.querySelector('#pending-trades_timeframe');
      if (!timeContainer) {
        console.warn('[AutoTrader] ⚠️ Timeframe container not found (#pending-trades_timeframe)');
        // Fallback to legacy method
        return await ensureExpirationMinutes(minutes);
      }

      // Find the three time input fields (HH:MM:SS)
      const inputs = timeContainer.querySelectorAll('.quick-timeframe-selector__in .rw input');
      if (inputs.length < 2) {
        console.warn('[AutoTrader] ⚠️ Time inputs not found, trying fallback');
        return await ensureExpirationMinutes(minutes);
      }

      // Convert minutes to HH:MM:SS format
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const secs = 0;

      // Set values: first input is hours, second is minutes, third is seconds
      if (inputs.length >= 3) {
        setInput(inputs[0], pad2(hours));
        setInput(inputs[1], pad2(mins));
        setInput(inputs[2], pad2(secs));
      } else if (inputs.length >= 2) {
        // If only 2 inputs, assume MM:SS
        setInput(inputs[0], pad2(mins));
        setInput(inputs[1], pad2(secs));
      }

      await sleep(100);
      console.log(`[AutoTrader] ✅ Time frame set to: ${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`);
      return true;

    } catch (e) {
      console.error('[AutoTrader] ❌ Error setting time frame:', e);
      return false;
    }
  }

  /**
   * ✅ v3.0.0: Click the BUY or SELL button in the pending trades window
   * Uses exact selectors for pending trades buttons to avoid clicking other buttons on page
   */
  async function clickTradeButton(action) {
    console.log(`[AutoTrader] 🎯 Clicking ${action} button`);

    try {
      // Use exact selectors for pending trades buttons
      let btnSelector;
      if (action === 'BUY') {
        btnSelector = '#pending-trades_higher-btn > span';
      } else {
        btnSelector = '#pending-trades_lower-btn > span';
      }

      const btnSpan = document.querySelector(btnSelector);
      if (btnSpan) {
        btnSpan.click();
        console.log(`[AutoTrader] ✅ ${action} button clicked (pending trades)`);
        return true;
      }

      // Fallback: try clicking the parent button directly
      const parentSelector = action === 'BUY' ? '#pending-trades_higher-btn' : '#pending-trades_lower-btn';
      const parentBtn = document.querySelector(parentSelector);
      if (parentBtn) {
        parentBtn.click();
        console.log(`[AutoTrader] ✅ ${action} button clicked (parent)`);
        return true;
      }

      console.warn(`[AutoTrader] ⚠️ ${action} button not found`);
      return false;

    } catch (e) {
      console.error('[AutoTrader] ❌ Error clicking trade button:', e);
      return false;
    }
  }

  /**
   * ✅ v3.0.0: Execute trade using the pending trades window (Multi-Pair support)
   * 3 Tasks:
   * 1. Select the correct currency pair (asset)
   * 2. Set the entry price with adjustment
   * 3. Set the time frame
   * Then click BUY/SELL button
   */
  async function executeTrade(sig){
    const pair = sig.pair;
    const action = sig.action;
    const entryPrice = sig.entryPrice;
    const duration = sig.minutes || sig.duration || 3;

    console.log(`[AutoTrader] 🚀 Executing trade: ${pair} ${action} @ ${entryPrice} for ${duration}min`);

    // Check if we have required data for pending trades mode
    if (pair && entryPrice && PAIR_TO_ASSET_MAP[pair]) {
      // v3.0.0: Use pending trades window with 3 tasks

      // Task 1: Select the correct currency pair
      const assetSelected = await selectAsset(pair);
      if (!assetSelected) {
        console.warn('[AutoTrader] ⚠️ Task 1 failed: Could not select asset, falling back to legacy mode');
        // Continue anyway - the asset might already be correct
      }
      await sleep(200);

      // Task 2: Set the entry price with adjustment
      const priceSet = await setEntryPrice(entryPrice, action, pair);
      if (!priceSet) {
        console.warn('[AutoTrader] ⚠️ Task 2 failed: Could not set entry price');
      }
      await sleep(200);

      // Task 3: Set the time frame
      const timeSet = await setTimeFrame(duration);
      if (!timeSet) {
        console.warn('[AutoTrader] ⚠️ Task 3 failed: Could not set time frame');
      }
      await sleep(200);

      // Click the trade button
      await clickTradeButton(action);

    } else {
      // Legacy mode: use old trading panel
      console.log('[AutoTrader] 📝 Using legacy trading mode (no pair/entryPrice in signal)');
      await ensureExpirationMinutes(duration);
      await sleep(200);
      if (action === 'BUY') {
        const b = findButtonByLabel('kup');
        if (b) b.click();
      } else if (action === 'SELL') {
        const s = findButtonByLabel('sprzedaj');
        if (s) s.click();
      }
    }
  }

  // === SYMBOL ===
  /**
   * ✅ v3.0.0: Enhanced symbol detection with Multi-Pair support
   * Priority:
   * 1. Read pair from PS_AT_FEED signal (v10.7.0 format)
   * 2. Read from pending-trades_asset dropdown
   * 3. Legacy DOM selectors
   */
  window.__psGetSymbol = function(){
    try {
      // v3.0.0: First, try to get pair from the current signal in feed
      const raw = localStorage.getItem('PS_AT_FEED');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.bestSignal && obj.bestSignal.pair) {
          return String(obj.bestSignal.pair).trim().toUpperCase();
        }
        if (obj && obj.symbol) return String(obj.symbol).trim().toUpperCase();
      }

      // v3.0.0: Read from pending-trades asset dropdown
      const hard = document.querySelector('#pending-trades_asset > div > button > div > div > div');
      if (hard && hard.textContent) {
        const t = hard.textContent.trim();
        if (t) return t.toUpperCase();
      }

      // Also check .filter-option-inner-inner which is the bootstrap-select display
      const filterOpt = document.querySelector('#pending-trades_asset .filter-option-inner-inner');
      if (filterOpt && filterOpt.textContent) {
        const t = filterOpt.textContent.trim();
        if (t) return t.toUpperCase();
      }

      const bad = new Set(['M1','M2','M3','M5','M10','M15','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','1M','3M','6M','Y1']);
      const looksTF  = s => bad.has(String(s).toUpperCase());
      const looksSym = s => {
        const u = String(s).trim().toUpperCase();
        if (!u || looksTF(u)) return false;
        if (u.includes('/')) return true;
        if (/\bOTC\b/.test(u)) return true;
        if (/^[A-Z0-9]{4,12}$/.test(u)) return true;
        return false;
      };
      const nodes = Array.from(document.querySelectorAll('div.filter-option-inner-inner'));
      for (const n of nodes) {
        const t = (n.textContent || '').trim();
        if (looksSym(t)) return t.toUpperCase();
      }
      const sels=['.trading__pair .pair__name','.pair__name','.header__pair .pair__name'];
      for (const sel of sels) {
        const n = document.querySelector(sel);
        if (n && n.textContent) {
          const t = n.textContent.trim();
          if (looksSym(t)) return t.toUpperCase();
        }
      }
      const symbolRaw = localStorage.getItem('PS_SYMBOL');
      if (symbolRaw) return String(symbolRaw).trim().toUpperCase();
    } catch(e) {}
    return null;
  };

  /* ===================== COOLDOWN / RE-ENTRY ===================== */
  const COOLDOWN_SEC_DEFAULT = 15;
  const cdMap = {};
  function canTrade(sym){
    const now=Date.now(); const last=cdMap[sym]||0; const cd=(lsNum(LS.COOLDOWN,COOLDOWN_SEC_DEFAULT))*1000;
    return (now - last) >= cd;
  }
  function markTrade(sym){ cdMap[sym]=Date.now(); }

  window.__AT_lastEntry = window.__AT_lastEntry || {};
  const REENTRY_LOOKBACK_MS = 5*60*1000;

  const AT_DUP_COOLDOWN_SEC = parseInt(localStorage.getItem('AT_DUP_COOLDOWN_SEC') || '60', 10);
  const DUP_COOLDOWN_MS = Math.max(0, AT_DUP_COOLDOWN_SEC) * 1000;
  const AT_LAST_EXEC_KEY = 'AT_LAST_EXEC_TS';
  let __AT_LAST_EXEC = {};
  try { __AT_LAST_EXEC = JSON.parse(localStorage.getItem(AT_LAST_EXEC_KEY) || '{}'); } catch (e) { __AT_LAST_EXEC = {}; }

  function flash(msg, isErr){
    const c = isErr?'#f33':'#0f0';
    console.log('[AT]', msg);
    const el = document.getElementById('at-info');
    if(el){
      el.textContent = msg; el.style.color = c;
      setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; }, isErr?6000:4000);
    }
  }

  const state = {
    active: lsBool(LS.ACTIVE, true),
    thr: lsNum(LS.THRESHOLD, 70),
    stopAbs: lsNum(LS.STOP_ABS, 0),
    ddPct: lsNum(LS.DD_PCT, 20),
    peak: lsNum(LS.PEAK, NaN),
    peakTs: localStorage.getItem(LS.PEAK_TS) || null,
    cooldown: lsNum(LS.COOLDOWN, COOLDOWN_SEC_DEFAULT),
    minimized: lsBool(LS.MINIMIZED, false),
    skipLowWR: lsBool(LS.SKIP_LOW_WR, true), // v3.0.0: block if overall WR < 54%
    skipLowWRConf50: lsBool(LS.SKIP_LOW_WR_CONF50, true) // v3.0.0: block if conf>=70% WR < 54%
  };

  let box, statusSpan, rows;
  let executing=false;

  function ensurePanel(){
    if(box && box.isConnected) return;
    box = document.createElement('div');
    box.id='at-panel';
    box.style.cssText='position:fixed;bottom:10px;left:10px;z-index:999999;background:#000;border:2px solid #234;color:#eee;font:12px/1.4 monospace;width:700px;user-select:none;transition:all 0.3s ease;';
    box.innerHTML=`
      <div style="background:#123;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #234;cursor:move;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="at-badge" style="padding:3px 8px;border-radius:999px;background:#555;color:#0f0;font-weight:700;font-size:11px;">AKTYWNE</span>
          <strong style="color:#fff;">AutoTrader v3.0.3</strong>
          <span style="color:#888;font-size:10px;">Proof-Required</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="at-minimize" style="background:#123;border:1px solid #345;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:700;">−</button>
          <button id="at-toggle" style="background:#555;border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;">Pauza</button>
          <button id="at-peak" style="background:#123;border:1px solid #345;color:#eee;padding:4px 10px;border-radius:6px;cursor:pointer;">Reset peak</button>
        </div>
      </div>
      <div id="at-content" style="display:block;">
        <div style="display:grid;grid-template-columns:1fr 120px;gap:8px;padding:6px 10px;border-bottom:1px solid #234;font-size:12px;">
          <label>Próg wejścia (%)</label>
          <input id="at-thr" type="number" min="1" max="100" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Cooldown (sekundy) <span style="color:#888;font-size:10px;">0-300</span></label>
          <input id="at-cooldown" type="number" min="0" max="300" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Offset ceny (pipsy) <span style="color:#888;font-size:10px;">dla zleceń</span></label>
          <input id="at-price-offset" type="number" min="1" max="50" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>STOP saldo (kwota)</label>
          <input id="at-stop" type="number" min="0" step="0.01" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Maks. spadek od szczytu (%)</label>
          <input id="at-dd" type="number" min="0" max="100" step="0.1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #234;font-size:12px;">
          <div style="color:#cfe;">Blokuj gdy ogólny WR < 54%</div>
          <button id="at-skip-low-wr" style="background:#123;border:1px solid #345;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;">—</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #234;font-size:12px;">
          <div style="color:#cfe;">Blokuj gdy WR (conf ≥70%) < 54%</div>
          <button id="at-skip-low-wr-conf50" style="background:#123;border:1px solid #345;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;">—</button>
        </div>
        <div id="at-rows" style="padding:6px 10px; border-top:1px solid #234; border-bottom:1px solid #234;"></div>
        <div style="padding:6px 10px; font-size:12px;">
          <div id="at-status">status: init</div>
          <div id="at-info"   style="color:#9cf;margin-top:4px;"></div>
        </div>
        <div id="at-foot" style="display:grid;grid-template-columns: repeat(6, 1fr); gap:6px; padding:6px 10px; border-top:1px solid #234; font-size:12px; color:#cfe;">
          <div><span style="color:#88a">PARA:</span> <span id="at-f-sym">—</span></div>
          <div><span style="color:#88a">Saldo:</span> <span id="at-f-bal">—</span></div>
          <div><span style="color:#88a">PEAK:</span> <span id="at-f-peak">—</span></div>
          <div><span style="color:#88a">Floor:</span> <span id="at-f-floor">—</span></div>
          <div><span style="color:#88a">LVL:</span> <span id="at-f-lvl">—</span></div>
          <div><span style="color:#88a">Max DD:</span> <span id="at-f-dd">—</span></div>
        </div>
      </div>
    `;
    document.body.appendChild(box);

    statusSpan = box.querySelector('#at-status');
    rows = box.querySelector('#at-rows');

    const thrInput = box.querySelector('#at-thr'); thrInput.value = String(state.thr);
    const cooldownInput = box.querySelector('#at-cooldown'); cooldownInput.value = String(state.cooldown);
    const priceOffsetInput = box.querySelector('#at-price-offset'); priceOffsetInput.value = String(lsNum(LS.PRICE_OFFSET, DEFAULT_PRICE_OFFSET_PIPS));
    const stopInput = box.querySelector('#at-stop'); stopInput.value = state.stopAbs>0 ? String(state.stopAbs.toFixed(2)) : '0';
    const ddInput = box.querySelector('#at-dd'); ddInput.value = state.ddPct>0 ? String(state.ddPct) : '0';

    function renderHeader(){
      const badge = box.querySelector('#at-badge');
      if (badge) {
        badge.textContent = state.active ? 'AKTYWNE' : 'OFF';
        badge.style.background = state.active ? '#555' : '#f33';
        badge.style.color = state.active ? '#0f0' : '#f66';
      }
      const tgl = box.querySelector('#at-toggle');
      if (tgl) tgl.textContent = state.active ? 'Pauza' : 'Włącz';
    }
    renderHeader();

    box.querySelector('#at-toggle').addEventListener('click', ()=>{
      state.active = !state.active; localStorage.setItem(LS.ACTIVE, String(state.active));
      renderHeader(); window.__AT_renderFooter && window.__AT_renderFooter();
    });
    box.querySelector('#at-peak').addEventListener('click', ()=>{
      const bal=getBalance(); if(bal==null){ flash('Brak salda do resetu PEAK', true); return; }
      state.peak = bal; state.peakTs=new Date().toISOString();
      localStorage.setItem(LS.PEAK,String(state.peak)); localStorage.setItem(LS.PEAK_TS,state.peakTs);
      flash(`Reset PEAK: ${bal.toFixed(2)}`); window.__AT_renderFooter && window.__AT_renderFooter();
    });

    thrInput.addEventListener('change', ()=>{ state.thr = clamp(parseInt(thrInput.value||'50',10)||50,1,100);
      localStorage.setItem(LS.THRESHOLD,String(state.thr)); });
    cooldownInput.addEventListener('change', ()=>{
      const v = clamp(parseInt(cooldownInput.value||'15',10)||15, 0, 300);
      state.cooldown = v;
      cooldownInput.value = String(v);
      localStorage.setItem(LS.COOLDOWN, String(v));
      console.log(`[AT] Cooldown zmieniony na ${v}s`);
    });
    priceOffsetInput.addEventListener('change', ()=>{
      const v = clamp(parseInt(priceOffsetInput.value||String(DEFAULT_PRICE_OFFSET_PIPS),10)||DEFAULT_PRICE_OFFSET_PIPS, 1, 50);
      priceOffsetInput.value = String(v);
      localStorage.setItem(LS.PRICE_OFFSET, String(v));
      console.log(`[AT] Offset ceny zmieniony na ${v} pipsów`);
    });
    stopInput.addEventListener('change', ()=>{ const v=Math.max(0, parseFloat((stopInput.value||'0').replace(',','.'))||0);
      state.stopAbs=v; stopInput.value=String(v.toFixed(2)); localStorage.setItem(LS.STOP_ABS,String(v)); window.__AT_renderFooter && window.__AT_renderFooter(); });
    ddInput.addEventListener('change', ()=>{ const v=clamp(parseFloat((ddInput.value||'0').replace(',','.'))||0,0,100);
      state.ddPct=v; ddInput.value=String(v); localStorage.setItem(LS.DD_PCT,String(v)); window.__AT_renderFooter && window.__AT_renderFooter(); });

    // v3.0.0: Skip low overall WR button
    const skipBtn = box.querySelector('#at-skip-low-wr');
    function renderSkipButton(){
      if(!skipBtn) return;
      skipBtn.textContent = state.skipLowWR ? 'Blokada: AKTYWNA' : 'Blokada: WYŁ.';
      skipBtn.style.background = state.skipLowWR ? '#8b0000' : '#123';
      skipBtn.style.borderColor = state.skipLowWR ? '#f55' : '#345';
    }
    renderSkipButton();
    skipBtn.addEventListener('click', ()=>{
      state.skipLowWR = !state.skipLowWR;
      localStorage.setItem(LS.SKIP_LOW_WR, String(state.skipLowWR));
      renderSkipButton();
      console.log(`[AT] Blokada ogólny WR<54%: ${state.skipLowWR ? 'AKTYWNA' : 'WYŁĄCZONA'}`);
    });

    // v3.0.0: Skip low WR for conf>=70% signals button
    const skipConf50Btn = box.querySelector('#at-skip-low-wr-conf50');
    function renderSkipConf50Button(){
      if(!skipConf50Btn) return;
      skipConf50Btn.textContent = state.skipLowWRConf50 ? 'Blokada: AKTYWNA' : 'Blokada: WYŁ.';
      skipConf50Btn.style.background = state.skipLowWRConf50 ? '#8b0000' : '#123';
      skipConf50Btn.style.borderColor = state.skipLowWRConf50 ? '#f55' : '#345';
    }
    renderSkipConf50Button();
    skipConf50Btn.addEventListener('click', ()=>{
      state.skipLowWRConf50 = !state.skipLowWRConf50;
      localStorage.setItem(LS.SKIP_LOW_WR_CONF50, String(state.skipLowWRConf50));
      renderSkipConf50Button();
      console.log(`[AT] Blokada WR(conf≥70%)<54%: ${state.skipLowWRConf50 ? 'AKTYWNA' : 'WYŁĄCZONA'}`);
    });

    // Minimize/expand toggle
    const minimizeBtn = box.querySelector('#at-minimize');
    const contentDiv = box.querySelector('#at-content');
    function applyMinimized(){
      if(state.minimized){
        contentDiv.style.display = 'none';
        minimizeBtn.textContent = '+';
        box.style.width = 'auto';
      } else {
        contentDiv.style.display = 'block';
        minimizeBtn.textContent = '−';
        box.style.width = '700px';
      }
    }
    applyMinimized();
    minimizeBtn.addEventListener('click', ()=>{
      state.minimized = !state.minimized;
      localStorage.setItem(LS.MINIMIZED, String(state.minimized));
      applyMinimized();
    });

    // Footer renderer
    window.__AT_renderFooter = function(){
      const bal = getBalance();
      const sym = window.__psGetSymbol() || '—';

      let floor = '—';
      const floorVal = Number.isFinite(state.peak) && state.ddPct > 0 ? state.peak * (1 - state.ddPct/100) : null;
      if (floorVal !== null){
        floor = floorVal.toFixed(2);
      }

      let lvl = '—';
      let lvlColor = '#cfe';
      if(bal!=null && floorVal !== null){
        const range = state.peak - floorVal;
        if(range > 0){
          let pct = ((bal - floorVal) / range * 100);
          if (pct <= 0) {
             lvl = 'REACHED';
             lvlColor = '#f55';
          } else {
             pct = Math.min(100, pct);
             lvl = pct.toFixed(1) + '%';
             if (pct < 25) lvlColor = '#fa5'; // Warning: near floor
          }
        }
      }

      const ddDisplay = state.ddPct > 0 ? state.ddPct.toFixed(1) + '%' : '—';

      document.getElementById('at-f-sym').textContent = sym;
      document.getElementById('at-f-bal').textContent = bal!=null ? bal.toFixed(2) : '—';
      document.getElementById('at-f-peak').textContent = Number.isFinite(state.peak) ? state.peak.toFixed(2) : '—';
      document.getElementById('at-f-floor').textContent = floor;
      const lvlEl = document.getElementById('at-f-lvl');
      if(lvlEl){
        lvlEl.textContent = lvl;
        lvlEl.style.color = lvlColor;
      }
      document.getElementById('at-f-dd').textContent = ddDisplay;
    };

    setInterval(window.__AT_renderFooter, 1000);
    window.__AT_renderFooter();
  }

  /* ===================== MAIN LOOP ===================== */
  async function tick(){
    ensurePanel();

    if(!state.active){
      statusSpan.textContent = 'status: OFF (pauza)';
      statusSpan.style.color = '#888';
      return;
    }

    const bal = getBalance();
    if(bal == null){
      statusSpan.textContent = 'status: brak salda';
      return;
    }

    // --- SAFETY STOPS (Must come before strategy logic) ---

    // 1. Absolute balance stop
    if(state.stopAbs > 0 && bal <= state.stopAbs){
      state.active = false;
      localStorage.setItem(LS.ACTIVE, 'false');
      renderHeader();
      statusSpan.textContent = `STOP: Saldo ${bal.toFixed(2)} ≤ ${state.stopAbs.toFixed(2)}`;
      statusSpan.style.color = '#f55';
      flash(`🛑 AutoTrader wyłączony: osiągnięto limit saldo (${bal.toFixed(2)})`, true);
      return;
    }

    // 2. Trailing drawdown stop
    if(state.ddPct > 0 && Number.isFinite(state.peak)){
      const floor = state.peak * (1 - state.ddPct/100);
      if(bal <= floor){
        state.active = false;
        localStorage.setItem(LS.ACTIVE, 'false');
        renderHeader();
        statusSpan.textContent = `STOP: Drawdown ${bal.toFixed(2)} ≤ floor ${floor.toFixed(2)}`;
        statusSpan.style.color = '#f55';
        flash(`🛑 AutoTrader wyłączony: przekroczono drawdown (${state.ddPct}%)`, true);
        return;
      }
    }

    // Peak tracking (High-water mark)
    if(!Number.isFinite(state.peak) || bal > state.peak){
      state.peak = bal;
      state.peakTs = new Date().toISOString();
      localStorage.setItem(LS.PEAK, String(state.peak));
      localStorage.setItem(LS.PEAK_TS, state.peakTs);
      window.__AT_renderFooter && window.__AT_renderFooter();
    }

    // --- STRATEGY FILTERS ---

    // ✅ v3.0.0: Check overall Win Rate from Pocket Scout stats and block if < 54%
    if (state.skipLowWR) {
      const psStats = getPocketScoutStats();
      if (psStats && psStats.totalSignals >= 10 && psStats.winRate !== null) {
        if (psStats.winRate < WR_THRESHOLD_OVERALL) {
          statusSpan.textContent = `status: ⛔ BLOKADA ogólny WR=${psStats.winRate.toFixed(1)}% (<${WR_THRESHOLD_OVERALL}%)`;
          statusSpan.style.color = '#f55';
          console.log(`[AutoTrader] ⛔ Blocked: Overall WR = ${psStats.winRate.toFixed(1)}% (<${WR_THRESHOLD_OVERALL}% threshold)`);
          return;
        }
      }
    }

    // ✅ v3.0.3: Check WR for high-confidence (conf>=70%) signals with proof-of-performance requirement
    if (state.skipLowWRConf50) {
      const psStats = getPocketScoutStats();
      if (psStats) {
        // PROOF-OF-PERFORMANCE: Block when insufficient data (< 2 signals)
        if (psStats.highConfTotal < 2) {
          statusSpan.textContent = `status: ⛔ BLOKADA Brak danych (${psStats.highConfTotal}/2 sygnałów conf≥70%)`;
          statusSpan.style.color = '#f55';
          console.log(`[AutoTrader] ⛔ Blocked: Insufficient high-conf signals (${psStats.highConfTotal}/2) - proof-of-performance required`);
          return;
        }
        // PROVEN BAD: Block when WR < 54% with sufficient data
        if (psStats.highConfTotal >= 2 && psStats.highConfWinRate !== null && psStats.highConfWinRate < WR_THRESHOLD_CONF50) {
          statusSpan.textContent = `status: ⛔ BLOKADA WR(conf≥70%)=${psStats.highConfWinRate.toFixed(1)}% (<${WR_THRESHOLD_CONF50}%)`;
          statusSpan.style.color = '#f55';
          console.log(`[AutoTrader] ⛔ Blocked: High-conf WR = ${psStats.highConfWinRate.toFixed(1)}% (<${WR_THRESHOLD_CONF50}% threshold)`);
          return;
        }
      }
    }

    // Symbol check - v3.0.0: Symbol now comes from signal pair field or dropdown
    const sym = window.__psGetSymbol();
    if(!sym){
      statusSpan.textContent = 'status: oczekiwanie na sygnał';
      statusSpan.style.color = '#888';
      return;
    }

    // v3.0.0: Multi-Pair support - no longer validate for single EUR/USD OTC
    // The signal contains the pair to trade, and we'll select it automatically

    // Cooldown check
    if(!canTrade(sym)){
      const remaining = Math.ceil((state.cooldown*1000 - (Date.now() - (cdMap[sym]||0)))/1000);
      statusSpan.textContent = `status: cooldown ${sym} (${remaining}s)`;
      return;
    }

    // Read feed and pick signal
    const feed = readPSFeed();

    // V3.0.0: Check priority buffer first before checking fresh feed
    if (__PRIORITY_BUFFER && (Date.now() - __PRIORITY_BUFFER_TS) < PRIORITY_BUFFER_TTL_MS) {
      const bufferConf = __PRIORITY_BUFFER.confidence ?? __PRIORITY_BUFFER.displayConf ?? 0;
      if (bufferConf >= state.thr) {
        const bufferPair = __PRIORITY_BUFFER.pair || sym;
        console.log(`[AutoTrader] 📌 Using priority buffer signal: [${bufferPair}] ${__PRIORITY_BUFFER.action}@${bufferConf}% (age: ${Math.round((Date.now() - __PRIORITY_BUFFER_TS)/1000)}s)`);
        const bufferedSig = pickSignal([__PRIORITY_BUFFER], state.thr);
        if (bufferedSig) {
          // Clear buffer after use
          __PRIORITY_BUFFER = null;
          __PRIORITY_BUFFER_TS = 0;

          // Execute buffered signal
          if(executing) return;
          executing = true;

          const conf = getConfidence(bufferedSig);
          const sigPair = bufferedSig.pair || sym;
          const signalType = 'BUFFERED';

          statusSpan.textContent = `EXEC: [${sigPair}] ${bufferedSig.action} ${bufferedSig.minutes}min @${conf}% 📌`;
          statusSpan.style.color = bufferedSig.action === 'BUY' ? '#0f0' : '#f55';

          console.log(`[AutoTrader] 🎯 Executing ${signalType}: [${sigPair}] ${bufferedSig.action} ${bufferedSig.minutes}min @${conf}%`);

          try {
            await executeTrade(bufferedSig);
            markTrade(sigPair);
            const sigKey = `${sigPair}_${bufferedSig.action}_${bufferedSig.minutes}`;
            __AT_LAST_EXEC[sigKey] = Date.now();
            localStorage.setItem(AT_LAST_EXEC_KEY, JSON.stringify(__AT_LAST_EXEC));

            window.__AT_lastEntry[sigPair] = {
              ts: Date.now(),
              action: bufferedSig.action,
              price: bufferedSig.entryPrice || readPrice()
            };

            flash(`✅ [${sigPair}] ${bufferedSig.action} ${bufferedSig.minutes}min @${conf}% 📌`, false);
          } catch(e) {
            console.error('[AutoTrader] Execution error:', e);
            flash(`❌ Błąd: ${e.message}`, true);
          }

          executing = false;
          return;
        }
      }
    }

    const sig = pickSignal(feed, state.thr);

    if(!sig){
      statusSpan.textContent = `status: brak sygnału ≥${state.thr}%`;
      statusSpan.style.color = '#ccc';
      return;
    }

    // v3.0.0: Use signal's pair for cooldown/duplicate tracking
    const sigPair = sig.pair || sym;

    // Duplicate check
    const sigKey = `${sigPair}_${sig.action}_${sig.minutes}`;
    const lastExec = __AT_LAST_EXEC[sigKey] || 0;
    if(Date.now() - lastExec < DUP_COOLDOWN_MS){
      const remaining = Math.ceil((DUP_COOLDOWN_MS - (Date.now() - lastExec))/1000);
      statusSpan.textContent = `status: dup cooldown [${sigPair}] ${remaining}s`;
      return;
    }

    // Execute trade
    if(executing) return;
    executing = true;

    const conf = getConfidence(sig);

    statusSpan.textContent = `EXEC: [${sigPair}] ${sig.action} ${sig.minutes}min @${conf}%`;
    statusSpan.style.color = sig.action === 'BUY' ? '#0f0' : '#f55';

    console.log(`[AutoTrader] 🎯 Executing: [${sigPair}] ${sig.action} ${sig.minutes}min @${conf}% (entry: ${sig.entryPrice || 'N/A'})`);

    try {
      await executeTrade(sig);
      markTrade(sigPair);
      __AT_LAST_EXEC[sigKey] = Date.now();
      localStorage.setItem(AT_LAST_EXEC_KEY, JSON.stringify(__AT_LAST_EXEC));

      window.__AT_lastEntry[sigPair] = {
        ts: Date.now(),
        action: sig.action,
        price: sig.entryPrice || readPrice()
      };

      flash(`✅ [${sigPair}] ${sig.action} ${sig.minutes}min @${conf}%`, false);
    } catch(e) {
      console.error('[AutoTrader] Execution error:', e);
      flash(`❌ Błąd: ${e.message}`, true);
    }

    executing = false;
  }

  // Start main loop - v3.0.3: proof-of-performance requirement
  setInterval(tick, TICK_INTERVAL_MS);
  console.log('[AutoTrader] v3.0.3 - PS v11.0.3 Proof-of-Performance (blocks when <3 high-conf signals)');
})();
