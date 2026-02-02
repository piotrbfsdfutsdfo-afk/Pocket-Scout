/**
 * Pocket Scout Smart Money & Price Action v11.0.0 - Main Content Script
 * Enhanced with SMART MONEY CONCEPTS & PRICE ACTION
 * Analyzes 10 currency pairs simultaneously with BOS/CHoCH, Order Blocks, Liquidity detection
 * 
 * PERFORMANCE OPTIMIZATIONS v11.0.0:
 * - Reduced console logging to prevent Chrome freezing
 * - Essential logs only for debugging and Auto Trader integration
 * - Maintains all functionality while reducing verbosity
 */

(function() {
  'use strict';

  const VERSION = '15.0.0';
  const FEED_KEY = 'PS_AT_FEED';
  const DATASTREAM_FEED_KEY = 'POCKET_DATASTREAM_FEED';
  const HISTORY_LIMIT = 50;
  const DEBUG_MODE = false; // Set to true for verbose logging

  // --- Multi-Pair State Variables ---
  
  // Map of pair -> CircularBuffer (one per pair)
  const pairBuffers = {};
  // Map of pair -> Engine state (v13)
  const pairEngineStates = {};
  // Map of pair -> OHLC array
  const pairOhlcM1 = {};
  // Map of pair -> last price
  const pairLastPrices = {};
  // Map of pair -> warmup complete status
  const pairWarmupComplete = {};
  // Map of pair -> last signal (for per-pair tracking)
  const pairLastSignals = {};
  // Track most recent signal globally for popup display
  let mostRecentSignal = null;
  // Global next signal time (one signal per interval across ALL pairs)
  let globalNextSignalAt = 0;
  
  // --- Frozen Price Detection Variables ---
  // Map of pair -> timestamp of last price update
  const pairLastPriceUpdate = {};
  // Map of pair -> frozen status
  const pairFrozenStatus = {};
  // Threshold in milliseconds to consider a price frozen (10 seconds)
  const FREEZE_THRESHOLD_MS = 10000;
  // Cooldown period after switching chart (60 seconds to prevent spam)
  const CHART_SWITCH_COOLDOWN_MS = 60000;
  // Map of pair -> timestamp of last chart switch attempt
  const pairLastChartSwitch = {};
  
  // --- Automatic Chart Rotation Variables ---
  // Rotation interval: 10 seconds between pair switches
  const CHART_ROTATION_INTERVAL_MS = 10000;
  // List of currency pairs for rotation (will be populated from POCKET_DATASTREAM_FEED)
  let rotationPairsList = [];
  // Current index in rotation
  let currentRotationIndex = 0;
  
  // Global stats
  let totalSignals = 0, winningSignals = 0, losingSignals = 0;
  let highConfSignals = 0, highConfWins = 0, highConfLosses = 0;
  let signalHistory = [];

  // --- Configurable Variables ---
  let signalIntervalMinutes = 1;
  let warmupCandlesCount = 50;
  
  // --- Payout Configuration ---
  const MIN_PAYOUT_PERCENT = 80; // Only show signals for pairs with >= 80% payout
  const MIN_CONFIDENCE_PERCENT = 70; // Minimum confidence for signal eligibility (V15 Sniper Tier)
  
  // Map of pair -> current payout percentage
  const pairPayouts = {};

  // Local circular buffer factory for multi-pair support
  function createLocalBuffer(capacity = 2000) {
    const buffer = new Array(capacity);
    let size = 0;
    let head = 0;

    // Cached result array to reduce GC pressure
    let cachedResult = null;
    let cacheValid = false;

    function add(candle) {
      buffer[head] = candle;
      head = (head + 1) % capacity;
      if (size < capacity) {
        size++;
      }
      cacheValid = false; // Invalidate cache on new data
    }

    function updateLast(data) {
      if (size === 0) return;
      const lastIndex = (head - 1 + capacity) % capacity;
      buffer[lastIndex] = { ...buffer[lastIndex], ...data };
      cacheValid = false; // Invalidate cache on update
    }

    function getLatest() {
      if (size === 0) return null;
      const lastIndex = (head - 1 + capacity) % capacity;
      return buffer[lastIndex];
    }

    function getAll() {
      if (size === 0) return [];
      
      // Return cached result if still valid (no add/update since last call)
      if (cacheValid && cachedResult) {
        return cachedResult;
      }
      
      // Build new result array
      const result = new Array(size);
      const start = (head - size + capacity) % capacity;
      for (let i = 0; i < size; i++) {
        const index = (start + i) % capacity;
        result[i] = buffer[index];
      }
      
      // Cache the result
      cachedResult = result;
      cacheValid = true;
      
      return result;
    }

    return { add, updateLast, getLatest, getAll, size: () => size };
  }

  // --- Create CircularBuffer for a pair ---
  function getOrCreateBuffer(pair) {
    if (!pairBuffers[pair]) {
      pairBuffers[pair] = createLocalBuffer(2000);
      pairOhlcM1[pair] = [];
      pairLastPrices[pair] = null;
      pairWarmupComplete[pair] = false;
      pairLastSignals[pair] = null;
      pairLastPriceUpdate[pair] = Date.now();
      pairFrozenStatus[pair] = false;
      pairLastChartSwitch[pair] = 0;
      if (DEBUG_MODE) console.log(`[PS v${VERSION}] Created buffer for pair: ${pair}`);
    }
    return pairBuffers[pair];
  }

  // --- Initialization ---
  loadConfig();
  loadState();

  // --- Core Functions ---

  function loadConfig() {
      const storedInterval = localStorage.getItem('PS_SIGNAL_INTERVAL');
      signalIntervalMinutes = storedInterval ? parseInt(storedInterval, 10) : 1;
      const storedWarmup = localStorage.getItem('PS_WARMUP_CANDLES');
      warmupCandlesCount = storedWarmup ? parseInt(storedWarmup, 10) : 50;
  }

  function saveConfig() {
      localStorage.setItem('PS_SIGNAL_INTERVAL', signalIntervalMinutes);
      localStorage.setItem('PS_WARMUP_CANDLES', warmupCandlesCount);
  }

  function loadState() {
    try {
      const stats = JSON.parse(localStorage.getItem('PS_V10_STATS') || '{}');
      totalSignals = stats.total || 0;
      winningSignals = stats.wins || 0;
      losingSignals = stats.losses || 0;
      highConfSignals = stats.highConfTotal || 0;
      highConfWins = stats.highConfWins || 0;
      highConfLosses = stats.highConfLosses || 0;
      signalHistory = JSON.parse(localStorage.getItem('PS_V10_HISTORY') || '[]');
      
      // Log loaded stats for debugging
      console.log(`[PS v${VERSION}] 📂 Stats loaded from PS_V10_STATS:`);
      console.log(`  Overall: ${winningSignals}W/${losingSignals}L (${totalSignals} total)`);
      console.log(`  ≥${MIN_CONFIDENCE_PERCENT}% Conf: ${highConfWins}W/${highConfLosses}L (${highConfSignals} total)`);
    } catch (e) {
      console.error(`[PS v${VERSION}] Failed to load state from localStorage.`, e);
    }
  }

  function saveState() {
    try {
        const stats = { 
          total: totalSignals, 
          wins: winningSignals, 
          losses: losingSignals,
          highConfTotal: highConfSignals,
          highConfWins: highConfWins,
          highConfLosses: highConfLosses
        };
        localStorage.setItem('PS_V10_STATS', JSON.stringify(stats));
        localStorage.setItem('PS_V10_HISTORY', JSON.stringify(signalHistory.slice(0, HISTORY_LIMIT)));
        
        // Debug logging for Auto Trader integration
        if (DEBUG_MODE || totalSignals % 5 === 0) {
          const overallWR = totalSignals > 0 ? (winningSignals / totalSignals * 100).toFixed(1) : 0;
          const highConfWR = highConfSignals > 0 ? (highConfWins / highConfSignals * 100).toFixed(1) : 0;
          console.log(`[PS v${VERSION}] 📊 Stats saved to PS_V10_STATS:`);
          console.log(`  Overall: ${winningSignals}W/${losingSignals}L (${totalSignals} total) = ${overallWR}% WR`);
          console.log(`  ≥${MIN_CONFIDENCE_PERCENT}% Conf: ${highConfWins}W/${highConfLosses}L (${highConfSignals} total) = ${highConfWR}% WR`);
          console.log(`  Auto Trader blocks: Overall ${totalSignals >= 10 && overallWR < 54 ? '🔴 ACTIVE' : '🟢 OFF'} | ≥${MIN_CONFIDENCE_PERCENT}% ${highConfSignals >= 5 && highConfWR < 54 ? '🔴 ACTIVE' : '🟢 OFF'}`);
        }
    } catch (e) {
        console.error(`[PS v${VERSION}] Failed to save state. Error:`, e);
        if (e.name === 'QuotaExceededError') {
            console.warn(`[PS v${VERSION}] Quota exceeded. Pruning signal history to recover.`);
            signalHistory = signalHistory.slice(0, Math.floor(HISTORY_LIMIT / 2));
            localStorage.setItem('PS_V10_HISTORY', JSON.stringify(signalHistory));
        }
    }
  }

  /**
   * Read all currency pair prices from POCKET_DATASTREAM_FEED localStorage key.
   * The data structure is: { timestamp: number, prices: { "EUR/USD_OTC": 1.16226, ... } }
   * Returns an object like: { "EUR/USD_OTC": 1.16226, "GBP/USD_OTC": 1.33201, ... }
   */
  function readPricesFromDataStream() {
    try {
      const dataStreamRaw = localStorage.getItem(DATASTREAM_FEED_KEY);
      if (!dataStreamRaw) {
        return null;
      }
      const dataStream = JSON.parse(dataStreamRaw);
      // The data structure has { timestamp, prices } - we need to extract prices
      if (typeof dataStream === 'object' && dataStream !== null && dataStream.prices) {
        return dataStream.prices;
      }
      return null;
    } catch (e) {
      console.error(`[PS v${VERSION}] Failed to parse POCKET_DATASTREAM_FEED:`, e);
      return null;
    }
  }

  /**
   * Convert pair name from internal format to data-id format
   * e.g., "EUR/USD_OTC" -> "EURUSD_otc"
   */
  function pairToDataId(pair) {
    // Remove slashes and convert to lowercase for the suffix
    // EUR/USD_OTC -> EURUSD_otc
    const cleanPair = pair.replace(/\//g, '');
    // Split by underscore to handle OTC suffix
    const parts = cleanPair.split('_');
    if (parts.length === 2) {
      return parts[0] + '_' + parts[1].toLowerCase();
    }
    return cleanPair;
  }

  /**
   * Convert data-id format to internal pair format
   * e.g., "EURUSD_otc" -> "EUR/USD_OTC"
   * NOTE: Assumes standard forex pair format (3-char currency codes like EUR, USD, GBP)
   * This works for: EUR/USD, GBP/USD, AUD/CAD, EUR/JPY, USD/JPY, etc.
   */
  function dataIdToPair(dataId) {
    // EURUSD_otc -> EUR/USD_OTC
    const parts = dataId.split('_');
    if (parts.length === 2) {
      const base = parts[0];
      const suffix = parts[1].toUpperCase();
      // Insert slash after first 3 characters (standard forex: 3-char currency codes)
      const currency1 = base.substring(0, 3);
      const currency2 = base.substring(3);
      return `${currency1}/${currency2}_${suffix}`;
    }
    return dataId;
  }

  /**
   * Read payout percentages from the HTML favorites list element
   * Updates pairPayouts map with current payouts
   */
  function readPayoutsFromDOM() {
    try {
      const items = document.querySelectorAll('.assets-favorites-item');
      
      for (const item of items) {
        const dataId = item.getAttribute('data-id');
        if (!dataId) continue;
        
        // Find payout number within this item
        const payoutEl = item.querySelector('.payout__number');
        if (payoutEl) {
          const payoutText = payoutEl.textContent.trim();
          // Extract number from text like "+92", "+68" or "+85.5" (handles decimals)
          const payoutMatch = payoutText.match(/\+?(\d+(?:\.\d+)?)/);
          if (payoutMatch) {
            const payout = parseFloat(payoutMatch[1]);
            const pair = dataIdToPair(dataId);
            pairPayouts[pair] = payout;
          }
        }
      }
      
      if (DEBUG_MODE && Object.keys(pairPayouts).length > 0) {
        console.log(`[PS v${VERSION}] 💰 Payouts updated:`, pairPayouts);
      }
    } catch (e) {
      console.error(`[PS v${VERSION}] Error reading payouts from DOM:`, e);
    }
  }

  /**
   * Get payout for a specific pair
   * Returns payout percentage or 0 if not found
   */
  function getPairPayout(pair) {
    return pairPayouts[pair] || 0;
  }

  /**
   * Check if pair has sufficient payout (>= MIN_PAYOUT_PERCENT)
   */
  function hasSufficientPayout(pair) {
    const payout = getPairPayout(pair);
    return payout >= MIN_PAYOUT_PERCENT;
  }

  /**
   * Switch chart view to a specific currency pair
   */
  function switchChartToPair(pair) {
    try {
      const dataId = pairToDataId(pair);
      const selector = `.assets-favorites-item[data-id="${dataId}"]`;
      const element = document.querySelector(selector);
      
      if (element) {
        if (DEBUG_MODE) console.log(`[PS v${VERSION}] 🔄 Switching chart to ${pair} (data-id: ${dataId})`);
        element.click();
        return true;
      } else {
        if (DEBUG_MODE) console.warn(`[PS v${VERSION}] ⚠️ Could not find chart button for ${pair} (data-id: ${dataId})`);
        return false;
      }
    } catch (e) {
      console.error(`[PS v${VERSION}] Error switching chart for ${pair}:`, e);
      return false;
    }
  }

  /**
   * Check for frozen prices and trigger chart switch if needed
   */
  function checkForFrozenPrices() {
    const now = Date.now();
    
    // Use for...in for better performance (no array creation)
    for (const pair in pairLastPriceUpdate) {
      const timeSinceUpdate = now - pairLastPriceUpdate[pair];
      const isFrozen = timeSinceUpdate > FREEZE_THRESHOLD_MS;
      const wasFrozen = pairFrozenStatus[pair];
      
      // Update frozen status
      pairFrozenStatus[pair] = isFrozen;
      
      // If newly frozen and we haven't switched recently
      if (isFrozen && !wasFrozen) {
        if (DEBUG_MODE) console.log(`[PS v${VERSION}] ❄️ Price FROZEN detected for ${pair} (no update for ${(timeSinceUpdate / 1000).toFixed(1)}s)`);
        
        const timeSinceLastSwitch = now - (pairLastChartSwitch[pair] || 0);
        
        if (timeSinceLastSwitch > CHART_SWITCH_COOLDOWN_MS) {
          if (DEBUG_MODE) console.log(`[PS v${VERSION}] 🎯 Attempting to unfreeze ${pair} by switching chart...`);
          
          if (switchChartToPair(pair)) {
            pairLastChartSwitch[pair] = now;
          }
        } else {
          const cooldownRemaining = ((CHART_SWITCH_COOLDOWN_MS - timeSinceLastSwitch) / 1000).toFixed(0);
          if (DEBUG_MODE) console.log(`[PS v${VERSION}] ⏱️ Chart switch cooldown active for ${pair} (${cooldownRemaining}s remaining)`);
        }
      } else if (!isFrozen && wasFrozen) {
        if (DEBUG_MODE) console.log(`[PS v${VERSION}] ✅ Price UNFROZEN for ${pair}`);
      }
    }
  }

  /**
   * Automatic Chart Rotation - Switches between pairs every 10 seconds
   * This helps prevent price freezing by keeping the data feed active
   */
  function rotateChartToPairs() {
    // Update rotation pairs list from available pairs
    if (rotationPairsList.length === 0) {
      const prices = readPricesFromDataStream();
      if (prices) {
        rotationPairsList = Object.keys(prices);
      }
    }
    
    // If we have pairs to rotate through
    if (rotationPairsList.length > 0) {
      const pairToSwitch = rotationPairsList[currentRotationIndex];
      const dataId = pairToDataId(pairToSwitch);
      const selector = `.assets-favorites-item[data-id="${dataId}"]`;
      const element = document.querySelector(selector);
      
      // Only switch if not already active to minimize DOM operations
      if (element && !element.classList.contains('active')) {
        if (switchChartToPair(pairToSwitch)) {
          if (DEBUG_MODE) console.log(`[PS v${VERSION}] 🔄 Auto-rotation: Switched to ${pairToSwitch} (${currentRotationIndex + 1}/${rotationPairsList.length})`);
        }
      } else if (DEBUG_MODE && element) {
        console.log(`[PS v${VERSION}] 🔄 Auto-rotation: ${pairToSwitch} already active, skipping switch.`);
      }
      
      // Move to next pair, wrap around to start if at end
      currentRotationIndex = (currentRotationIndex + 1) % rotationPairsList.length;
    }
  }

  /**
   * Update candles for a specific pair
   */
  function updateCandlesForPair(pair, price, timestamp) {
    const buffer = getOrCreateBuffer(pair);
    const minute = Math.floor(timestamp / 60000) * 60000;
    let lastCandle = buffer.getLatest();
    
    if (!lastCandle || lastCandle.t !== minute) {
      buffer.add({ t: minute, o: price, h: price, l: price, c: price });
      pairOhlcM1[pair] = buffer.getAll();
      if (!pairWarmupComplete[pair] && pairOhlcM1[pair].length >= warmupCandlesCount) {
        pairWarmupComplete[pair] = true;
        if (DEBUG_MODE) console.log(`[PS v${VERSION}] ✅ ${pair}: Warmup complete with ${warmupCandlesCount} candles. Signal generation activated.`);
      }
    } else {
      buffer.updateLast({ h: Math.max(lastCandle.h, price), l: Math.min(lastCandle.l, price), c: price });
    }
    pairOhlcM1[pair] = buffer.getAll();
  }

  /**
   * Generate signal candidate for a specific pair (does NOT record - just returns the signal)
   */
  function generateSignalCandidateForPair(pair) {
    if (!pairWarmupComplete[pair]) return null;
    const engine = window.V14Engine || window.V13Engine || window.V12Engine;
    if (!engine) {
        console.error(`[PS v${VERSION}] FATAL: Signal Engine not available.`);
        return null;
    }
    
    const ohlcM1 = pairOhlcM1[pair] || [];
    const lastPrice = pairLastPrices[pair];
    
    if (ohlcM1.length < warmupCandlesCount) {
        return null;
    }

    const engineCandles = [...ohlcM1];
    const engineOutput = engine.generateSignal(engineCandles, pair, pairEngineStates[pair]);

    // Handle both formats: { signal, updatedState } (v13+) and signalObject (v12)
    let signal = engineOutput;
    let updatedState = null;

    if (engineOutput && engineOutput.hasOwnProperty('signal')) {
      signal = engineOutput.signal;
      updatedState = engineOutput.updatedState;
    }

    // Persist state
    if (updatedState) {
      pairEngineStates[pair] = updatedState;
    }

    if (!signal) {
      return null;
    }

    // Include pair name in the signal for Auto Trader
    return { 
      pair: pair,
      action: signal.action,
      confidence: signal.confidence,
      duration: signal.tradeDuration || signal.duration,
      durationReason: signal.durationReason,
      reasons: signal.reasons,
      timestamp: Date.now(), 
      entryPrice: lastPrice, 
      result: null,
      indicatorValues: signal.indicatorValues
    };
  }

  /**
   * Generate signals for ALL pairs and select the ONE with highest confidence
   * OPTIMIZED: Filters by payout >= 80% and avoids low WR trends (STRONGLY_BEARISH, NEUTRAL)
   */
  function generateBestSignalAcrossAllPairs() {
    // First, update payouts from DOM
    readPayoutsFromDOM();
    
    const candidates = [];
    
    // Generate signal candidates from all pairs that are ready
    for (const pair of Object.keys(pairWarmupComplete)) {
      if (pairWarmupComplete[pair]) {
        // PAYOUT FILTER: Only consider pairs with payout >= 80%
        if (!hasSufficientPayout(pair)) {
          const payout = getPairPayout(pair);
          if (DEBUG_MODE) console.log(`[PS v${VERSION}] ⛔ Skipping ${pair} - payout ${payout}% < ${MIN_PAYOUT_PERCENT}%`);
          continue;
        }
        
        const candidate = generateSignalCandidateForPair(pair);
        if (candidate) {
          // CONFIDENCE FILTER: Only consider signals with confidence >= MIN_CONFIDENCE_PERCENT
          if (candidate.confidence < MIN_CONFIDENCE_PERCENT) {
            if (DEBUG_MODE) console.log(`[PS v${VERSION}] ⛔ Skipping ${pair} - confidence ${candidate.confidence}% < ${MIN_CONFIDENCE_PERCENT}%`);
            continue;
          }
          
          // NOTE: Trend filtering was removed after comprehensive analysis of 1019 signals
          // Original filter (STRONGLY_BEARISH, NEUTRAL) was based on small sample (52 signals)
          // Full dataset shows: NEUTRAL 52.8% WR, STRONGLY_BEARISH 50.4% WR - both acceptable
          // All trends have WR ≥48% for high-confidence signals, no filtering needed
          
          // Wrap candidate with payout info (avoids mutating original candidate object)
          const payout = getPairPayout(pair);
          candidates.push({ candidate, payout });
        }
      }
    }
    
    if (candidates.length === 0) {
      if (DEBUG_MODE) console.log(`[PS v${VERSION}] No signal candidates available (after payout/confidence filters).`);
      return;
    }
    
    // Sort by confidence descending, then by payout descending, then by duration ascending
    candidates.sort((a, b) => {
      if (b.candidate.confidence !== a.candidate.confidence) {
        return b.candidate.confidence - a.candidate.confidence; // Higher confidence first
      }
      if (b.payout !== a.payout) {
        return b.payout - a.payout; // Higher payout as second priority
      }
      return a.candidate.duration - b.candidate.duration; // Shorter duration as tiebreaker
    });
    
    // Select the best signal and create a clean copy for recording
    const { candidate: bestCandidate, payout: bestPayout } = candidates[0];
    
    // Log payout information
    console.log(`[PS v${VERSION}] 💰 Selected signal: ${bestCandidate.pair} | Conf: ${bestCandidate.confidence}% | Payout: ${bestPayout}%`);
    
    // Create a clean signal object without indicatorValues and payout (for recording)
    const cleanSignal = {
      pair: bestCandidate.pair,
      action: bestCandidate.action,
      confidence: bestCandidate.confidence,
      duration: bestCandidate.duration,
      durationReason: bestCandidate.durationReason,
      reasons: bestCandidate.reasons,
      timestamp: bestCandidate.timestamp,
      entryPrice: bestCandidate.entryPrice,
      result: bestCandidate.result
    };
    
    if (DEBUG_MODE) console.log(`[PS v${VERSION}] 🎯 Selected best signal from ${candidates.length} filtered candidates:`);
    recordSignal(cleanSignal.pair, cleanSignal);
  }

  function recordSignal(pair, signal) {
    pairLastSignals[pair] = signal;
    mostRecentSignal = signal; // Track most recent signal globally
    totalSignals++;
    
    if (signal.confidence >= MIN_CONFIDENCE_PERCENT) {
      highConfSignals++;
    }
    
    signalHistory.unshift(signal);
    
    saveState();
    logSignal(pair, signal);
    publishToAutoTrader(signal);
    scheduleResultCheck(pair, signal);
    
    // Trigger per-pair learning with the pair parameter
    if (window.AdaptiveLogic) {
      window.AdaptiveLogic.checkLearningTrigger(totalSignals, [], pair);
    }
  }

  function logSignal(pair, signal) {
    // Only log if confidence >= MIN_CONFIDENCE_PERCENT (Auto Trader threshold) or DEBUG_MODE
    if (signal.confidence >= MIN_CONFIDENCE_PERCENT || DEBUG_MODE) {
      console.log(`%c====== POCKET SCOUT SMART MONEY & PRICE ACTION v${VERSION} ======`, 'color: #60a5fa; font-weight: bold;');
      console.log(`PAIR: ${pair}`);
      console.log(`ACTION: ${signal.action} | CONF: ${signal.confidence}% | DURATION: ${signal.duration}m`);
      if (DEBUG_MODE) console.log(`REASONS: ${signal.reasons.join(', ')}`);
      if (DEBUG_MODE) console.log(`DUR LOGIC: ${signal.durationReason}`);
      console.log('====================================================================');
    }
  }

  function publishToAutoTrader(signal) { 
    localStorage.setItem(FEED_KEY, JSON.stringify({ bestSignal: signal })); 
  }

  function scheduleResultCheck(pair, signal) { 
    setTimeout(() => finalizeSignal(pair, signal), signal.duration * 60 * 1000); 
  }

  function finalizeSignal(pair, signal) {
    const lastPrice = pairLastPrices[pair];
    if (signal.result != null || lastPrice == null || signal.entryPrice == null) return;
    
    let isWin = (signal.action === 'BUY' && lastPrice > signal.entryPrice) || 
                (signal.action === 'SELL' && lastPrice < signal.entryPrice);
    signal.result = isWin ? 'WIN' : 'LOSS';
    signal.exitPrice = lastPrice;
    
    if (isWin) winningSignals++; else losingSignals++;
    
    if (signal.confidence >= MIN_CONFIDENCE_PERCENT) {
      if (isWin) highConfWins++; else highConfLosses++;
    }
    
    saveState();
  }
  
  /**
   * Check if at least one pair is ready for signal generation
   */
  function isAnyPairReady() {
    return Object.values(pairWarmupComplete).some(ready => ready);
  }

  /**
   * Maybe generate best signal (uses global timer, not per-pair)
   */
  function maybeGenerateBestSignal() {
    if (!isAnyPairReady()) return;
    const now = Date.now();
    if (now >= globalNextSignalAt) {
      globalNextSignalAt = now + signalIntervalMinutes * 60 * 1000;
      generateBestSignalAcrossAllPairs();
    }
  }

  // --- Get multi-pair status for popup ---
  function getMultiPairStatus() {
    // Update payouts before returning status
    readPayoutsFromDOM();
    
    const pairStatus = {};
    const pairs = Object.keys(pairBuffers);
    const now = Date.now();
    
    for (const pair of pairs) {
      const lastUpdate = pairLastPriceUpdate[pair] || 0;
      const timeSinceUpdate = now - lastUpdate;
      const isFrozen = pairFrozenStatus[pair] || false;
      const payout = getPairPayout(pair);
      
      pairStatus[pair] = {
        price: pairLastPrices[pair],
        candles: pairOhlcM1[pair] ? pairOhlcM1[pair].length : 0,
        warmupComplete: pairWarmupComplete[pair] || false,
        lastSignal: pairLastSignals[pair],
        frozen: isFrozen,
        timeSinceUpdate: timeSinceUpdate,
        payout: payout,
        payoutEligible: payout >= MIN_PAYOUT_PERCENT
      };
    }
    
    return pairStatus;
  }

  // --- Event Listeners & Loops ---

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_METRICS') {
      const metrics = { 
        winRate: totalSignals > 0 ? (winningSignals / totalSignals) * 100 : 0, 
        totalSignals, 
        wins: winningSignals, 
        losses: losingSignals, 
        highConfWinRate: highConfSignals > 0 ? (highConfWins / highConfSignals) * 100 : 0,
        highConfTotal: highConfSignals,
        highConfWins: highConfWins,
        highConfLosses: highConfLosses,
        currentInterval: signalIntervalMinutes, 
        currentWarmup: warmupCandlesCount 
      };
      
      // Include multi-pair status
      const pairStatus = getMultiPairStatus();
      const activePairs = Object.keys(pairStatus).length;
      const warmupCompletePairs = Object.values(pairStatus).filter(s => s.warmupComplete).length;
      
      sendResponse({ 
        metrics, 
        lastSignal: mostRecentSignal, // Use cached most recent signal (O(1) instead of O(n))
        pairStatus,
        activePairs,
        warmupCompletePairs,
        warmupComplete: warmupCompletePairs > 0
      });
    } else if (request.type === 'SET_INTERVAL') {
      signalIntervalMinutes = parseInt(request.interval, 10) || 1;
      // Reset next signal time for all pairs
      globalNextSignalAt = Date.now(); // Reset global signal timer
      saveConfig();
      sendResponse({ success: true, interval: signalIntervalMinutes });
    } else if (request.type === 'SET_WARMUP') {
      warmupCandlesCount = parseInt(request.warmup, 10) || 50;
      saveConfig();
      sendResponse({ success: true, warmup: warmupCandlesCount });
    } else if (request.type === 'RESET_HISTORY') {
      totalSignals = 0; 
      winningSignals = 0; 
      losingSignals = 0; 
      highConfSignals = 0;
      highConfWins = 0;
      highConfLosses = 0;
      signalHistory = []; 
      mostRecentSignal = null; // Reset most recent signal
      // Reset per-pair last signals and engine states
      for (const pair of Object.keys(pairLastSignals)) {
        pairLastSignals[pair] = null;
        pairEngineStates[pair] = null;
      }
      saveState();
      sendResponse({ success: true });
    } else if (request.type === 'EXPORT_LOGS') {
      sendResponse({ logs: [] });
    } else if (request.type === 'GET_ADAPTIVE_STATS') {
      if (window.AdaptiveLogic) {
        sendResponse({ stats: window.AdaptiveLogic.getAdaptiveStats() });
      } else {
        sendResponse({ stats: null, error: 'Adaptive Logic not available' });
      }
    } else if (request.type === 'RESET_ADAPTIVE_WEIGHTS') {
      if (window.AdaptiveLogic) {
        window.AdaptiveLogic.resetAdaptiveWeights();
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Adaptive Logic not available' });
      }
    }
    return true;
  });

  /**
   * Main tick loop - reads prices from POCKET_DATASTREAM_FEED and updates all pairs
   */
  function tickLoop() {
    const prices = readPricesFromDataStream();
    if (prices) {
      const now = Date.now();
      const currentMinute = Math.floor(now / 60000) * 60000;

      for (const [pair, price] of Object.entries(prices)) {
        if (typeof price === 'number' && price > 0) {
          const previousPrice = pairLastPrices[pair];
          const buffer = getOrCreateBuffer(pair);
          const lastCandle = buffer.getLatest();
          const isNewMinute = !lastCandle || lastCandle.t !== currentMinute;

          // Only update candles if price changed OR a new minute started
          const shouldUpdate = previousPrice !== price || isNewMinute;

          pairLastPrices[pair] = price;
          
          // Track price update timestamp only if price actually changed
          if (previousPrice !== price) {
            pairLastPriceUpdate[pair] = now;
            // Immediately mark as unfrozen when price changes (proactive unfreezing)
            if (pairFrozenStatus[pair]) {
              pairFrozenStatus[pair] = false;
            }
          }
          
          if (shouldUpdate) {
            updateCandlesForPair(pair, price, now);
          }
        }
      }
    }
    
    // Check for frozen prices every tick
    checkForFrozenPrices();
  }

  /**
   * Signal loop - generates ONE best signal across all pairs per interval
   * Now runs every 1 second for real-time response with clock synchronization
   */
  function signalLoop() {
    const now = new Date();
    const currentSecond = now.getSeconds();
    
    // Clock sync: Only generate signals at :00 second (start of new minute)
    // This ensures signals are ready exactly when the new M1 candle forms
    if (currentSecond === 0) {
      maybeGenerateBestSignal();
    }
  }

  setInterval(tickLoop, 1500);
  // Changed from 10000ms to 1000ms for real-time response with clock sync
  setInterval(signalLoop, 1000);
  // NEW: Automatic chart rotation every 10 seconds to prevent price freezing
  setInterval(rotateChartToPairs, CHART_ROTATION_INTERVAL_MS);

  console.log(`[Pocket Scout Smart Money & Price Action v${VERSION}] 🚀 Loaded`);
  console.log(`[PS v${VERSION}] 💰 Smart Money Concepts: BOS/CHoCH, Order Blocks, Liquidity, FVG`);
  console.log(`[PS v${VERSION}] 📊 10 pairs | Signal interval: ${signalIntervalMinutes}m | Warmup: ${warmupCandlesCount} candles`);
  console.log(`[PS v${VERSION}] 🎯 Auto Trader: ≥${MIN_CONFIDENCE_PERCENT}% confidence + ≥${MIN_PAYOUT_PERCENT}% payout`);
  console.log(`[PS v${VERSION}] 🔄 Auto chart rotation: Every ${CHART_ROTATION_INTERVAL_MS / 1000}s to prevent freezing`);


})();
