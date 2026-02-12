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

  const VERSION = '24.0.0 (NEXUS AI)';
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
  let lastSignalTriggeredAtMinute = -1;
  
  // --- Frozen Price Detection Variables ---
  // Map of pair -> timestamp of last price update
  const pairLastPriceUpdate = {};
  // Map of pair -> frozen status
  const pairFrozenStatus = {};
  // Flux tracking (updates per second)
  const pairFluxCounters = {};
  const pairFluxLevels = {};
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
  let consecutiveLossesCount = 0; // v20.1 Loss Streak Protection
  let signalHistory = [];

  // --- Configurable Variables ---
  let signalIntervalMinutes = 5;
  let tradeDurationMinutes = 5;
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
      signalIntervalMinutes = storedInterval ? parseInt(storedInterval, 10) : 5;
      const storedDuration = localStorage.getItem('PS_TRADE_DURATION');
      tradeDurationMinutes = storedDuration ? parseInt(storedDuration, 10) : 5;
      const storedWarmup = localStorage.getItem('PS_WARMUP_CANDLES');
      warmupCandlesCount = storedWarmup ? parseInt(storedWarmup, 10) : 50;
  }

  function saveConfig() {
      localStorage.setItem('PS_SIGNAL_INTERVAL', signalIntervalMinutes);
      localStorage.setItem('PS_TRADE_DURATION', tradeDurationMinutes);
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
      consecutiveLossesCount = stats.consecutiveLosses || 0;
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
          highConfLosses: highConfLosses,
          consecutiveLosses: consecutiveLossesCount
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
   * Calculate Global Currency Strength (v22)
   */
  function calculateGlobalCurrencyStrength() {
      const strength = {};
      const majorCurrencies = ['EUR', 'USD', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];
      majorCurrencies.forEach(c => strength[c] = 0);

      for (const pair of Object.keys(pairOhlcM1)) {
          const candles = pairOhlcM1[pair];
          if (candles.length < 5) continue;

          // Use last 5 candles for strength context
          const last = candles[candles.length - 1];
          const prev = candles[candles.length - 6] || candles[0];
          const move = last.c - prev.c;

          // e.g. "EUR/USD_OTC" -> ["EUR", "USD"]
          const parts = pair.replace('_OTC', '').split('/');
          if (parts.length !== 2) continue;

          const base = parts[0], quote = parts[1];
          if (move > 0) {
              if (strength[base] !== undefined) strength[base]++;
              if (strength[quote] !== undefined) strength[quote]--;
          } else if (move < 0) {
              if (strength[base] !== undefined) strength[base]--;
              if (strength[quote] !== undefined) strength[quote]++;
          }
      }
      return strength;
  }

  /**
   * generateForcedBestSignal (NEXUS v24)
   * Global Consensus Voting Engine
   */
  function generateForcedBestSignal() {
    const engine = window.ProjectNexus;
    if (!engine || !engine.processMarketSnapshot) {
        console.error("[NEXUS] Engine not loaded properly.");
        return;
    }

    readPayoutsFromDOM();
    const globalStrength = calculateGlobalCurrencyStrength();
    const allPairsData = {};

    for (const pair of Object.keys(pairWarmupComplete)) {
      if (pairWarmupComplete[pair] && hasSufficientPayout(pair)) {
        allPairsData[pair] = {
          candles: [...(pairOhlcM1[pair] || [])],
          pairState: pairEngineStates[pair] || {},
          flux: pairFluxLevels[pair] || 0
        };
      }
    }

    const result = engine.processMarketSnapshot(allPairsData, tradeDurationMinutes, globalStrength);

    // Synchronize Neural States (SPI is now Nexus Score)
    if (result && result.allUpdatedStates) {
        for (const pair in result.allUpdatedStates) {
            pairEngineStates[pair] = result.allUpdatedStates[pair];
        }
    }

    if (result && result.pair) {
      const winner = result;

      // Nexus Score to Confidence mapping
      const spi = winner.indicatorValues.spi || 0;
      let finalConfidence = Math.min(100, Math.max(0, spi));

      // Streak Protection (v20.1 legacy maintained)
      // v24.3: Only cap if we haven't seen a shadow win recently
      if (consecutiveLossesCount >= 3) {
          finalConfidence = Math.min(70, finalConfidence);
          console.log(`[NEXUS] 🛡️ Streak Protection active (${consecutiveLossesCount} losses). Conf capped at 70%.`);
      }

      console.log(`[NEXUS AI] 🧠 Decision: ${winner.pair} | Score: ${spi} | Confidence: ${finalConfidence}% | Cycles: ${winner.indicatorValues.cycles}`);

      const cleanSignal = {
        pair: winner.pair,
        action: winner.action,
        confidence: finalConfidence,
        duration: Math.floor(winner.tradeDuration),
        reasons: winner.reasons,
        timestamp: Date.now(),
        entryPrice: pairLastPrices[winner.pair],
        result: null,
        // Neural Metadata
        nexusFeatures: pairEngineStates[winner.pair]?.nexus?.lastFeatures
      };

      recordSignal(winner.pair, cleanSignal);
    }
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
    
    // NEXUS AI: Feedback Learning
    const engine = window.ProjectNexus;
    if (engine && engine.train && signal.nexusFeatures && pairEngineStates[pair]) {
        console.log(`[NEXUS AI] 📚 Learning from ${pair} outcome: ${signal.result}`);
        engine.train(pairEngineStates[pair], signal.result, signal.nexusFeatures);
    }

    if (isWin) {
        winningSignals++;
        consecutiveLossesCount = 0; // Reset streak on win
    } else {
        losingSignals++;
        consecutiveLossesCount++; // Increment streak on loss
    }
    
    if (signal.confidence >= MIN_CONFIDENCE_PERCENT) {
      if (isWin) highConfWins++; else highConfLosses++;
    }
    
    saveState();
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
        payoutEligible: payout >= MIN_PAYOUT_PERCENT,
        isHot: !!(pairEngineStates[pair]?.deepSight?.winRate >= 80 && pairEngineStates[pair]?.deepSight?.virtualHistory?.length >= 3),
        spi: pairEngineStates[pair]?.deepSight?.lastSPI || 0,
        cycles: pairEngineStates[pair]?.nexus?.trainingCycles || 0,
        mode: pairEngineStates[pair]?.nexus?.lastModelStatus || 'SMC_STANDARD'
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
        currentDuration: tradeDurationMinutes,
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
      signalIntervalMinutes = parseInt(request.interval, 10) || 5;
      saveConfig();
      sendResponse({ success: true, interval: signalIntervalMinutes });
    } else if (request.type === 'SET_DURATION') {
      tradeDurationMinutes = parseInt(request.duration, 10) || 5;
      saveConfig();
      sendResponse({ success: true, duration: tradeDurationMinutes });
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
      consecutiveLossesCount = 0; // Reset streak on history reset
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

          // Flux tracking (v22)
          if (!pairFluxCounters[pair]) pairFluxCounters[pair] = 0;
          if (previousPrice !== price) {
              pairFluxCounters[pair]++;
          }

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

          // NEXUS AI: Synapse Sync & Shadow Learning
          const engine = window.ProjectNexus;
          if (engine && engine.syncOracle) {
            const prevState = pairEngineStates[pair];
            pairEngineStates[pair] = engine.syncOracle(pair, prevState, price);

            // v24.3 Shadow Recovery: If a shadow trade just won, decrement consecutive losses
            if (prevState && pairEngineStates[pair]) {
                const prevHist = prevState.deepSight?.virtualHistory || [];
                const currHist = pairEngineStates[pair].deepSight?.virtualHistory || [];
                if (currHist.length > prevHist.length && currHist[currHist.length-1] === 'WIN') {
                    if (consecutiveLossesCount > 0) {
                        consecutiveLossesCount--;
                        console.log(`[NEXUS] 🌟 Shadow Recovery! Streak reduced to ${consecutiveLossesCount}.`);
                    }
                }
            }
          }
        }
      }
    }
    
    // Check for frozen prices every tick
    checkForFrozenPrices();
  }

  /**
   * Signal loop (v24.3 Omni)
   * Synchronized with the clock for forced snapshots.
   * Ensures exactly one high-probability signal per interval boundary.
   */
  function signalLoop() {
    const now = new Date();
    const min = now.getMinutes();
    const sec = now.getSeconds();

    // Trigger every X minutes at :00 second, only once per minute
    if (sec === 0 && (min % signalIntervalMinutes === 0) && (min !== lastSignalTriggeredAtMinute)) {
      lastSignalTriggeredAtMinute = min;
      console.log(`[NEXUS OMNI] ⏱️ Global ${signalIntervalMinutes}-min Snapshot triggered at ${now.toLocaleTimeString()}`);
      generateForcedBestSignal();
    }
  }

  setInterval(tickLoop, 500); // Higher resolution for v22 Flux

  // v22 Flux Calculation (Sliding window every 5s)
  setInterval(() => {
    for (const pair in pairFluxCounters) {
        pairFluxLevels[pair] = pairFluxCounters[pair] / 5; // average ticks/sec
        pairFluxCounters[pair] = 0;
    }
  }, 5000);

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
