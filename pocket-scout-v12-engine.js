/**
 * Pocket Scout v18.0.0 - Master of Traps Engine
 * "Liquidity Sniper v2 with Deep Sight Learning & Institutional Filters."
 * 
 * PHILOSOPHY:
 * - Focus on EQH/EQL Liquidity Sweeps
 * - Institutional Filters: Velocity Delta, M15 Trend, Zonal (P/D)
 * - Deep Sight v2 Shadow Tracking (History: 10)
 */

window.V18Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => { 
        console.error("[PS v17 Engine] FATAL: TechnicalIndicators dependency not found.");
        return null;
      } 
    };
  }

  const smcIndicators = window.SmartMoneyIndicators;
  const DEBUG_MODE = false;
  
  const STATES = {
    IDLE: 'IDLE',
    LIQUIDITY_SWEPT: 'LIQUIDITY_SWEPT',
    DISPLACEMENT: 'DISPLACEMENT',
    CHOCH: 'CHOCH',
    RETEST: 'RETEST'
  };

  const BQI_THRESHOLD = 45; // Aggressive floor
  const STATE_TIMEOUT_CANDLES = 40;
  const COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes throttle (v17)

  // --- Scoring Weights for V15 Sniper Precision ---
  const WEIGHTS = {
    STATE_SWEPT: 15,
    STATE_DISPLACEMENT: 10,
    STATE_CHOCH: 10,
    STATE_RETEST: 5,
    BQI_45: 10,
    BQI_65: 20,
    TREND_ALIGN_M15: 15,
    TREND_ALIGN_H1: 10,
    ZONE_ALIGN: 15,      // Buy in Discount, Sell in Premium
    OTE_BOOST: 10,       // Price in 61.8-78.6% retracement
    RSI_DIVERGENCE: 10,  // Momentum exhaustion
    PHASE_EXPANSION: 5,
    MOMENTUM_BOOST: 10,
    PA_CONFIRM: 10
  };

  /**
   * Reset pair state to IDLE
   */
  function resetState(pair, existingTimestamp = 0, existingDeepSight = null) {
    return {
      status: STATES.IDLE,
      direction: null,
      lastUpdateCandle: 0,
      lastSignalTimestamp: existingTimestamp, // Preserve cooldown
      setupData: {},
      reasons: [],
      // Deep Sight Tracking (v18 - History 10)
      deepSight: existingDeepSight || {
        shadowTrades: [], // { startPrice, direction, timestamp, expiry }
        virtualHistory: [], // ['WIN', 'LOSS', ...]
        winRate: 0
      }
    };
  }

  /**
   * Deep Sight: Shadow Outcome Evaluator (v17)
   */
  function updateDeepSight(pairState, currentPrice) {
    const ds = pairState.deepSight;
    const now = Date.now();

    // 1. Resolve expired shadow trades
    const unresolved = [];
    ds.shadowTrades.forEach(trade => {
      if (now >= trade.expiry) {
        const isWin = (trade.direction === 'BUY' && currentPrice > trade.startPrice) ||
                      (trade.direction === 'SELL' && currentPrice < trade.startPrice);

        ds.virtualHistory.push(isWin ? 'WIN' : 'LOSS');
        if (ds.virtualHistory.length > 10) ds.virtualHistory.shift();
      } else {
        unresolved.push(trade);
      }
    });
    ds.shadowTrades = unresolved;

    // 2. Calculate Oracle Score
    if (ds.virtualHistory.length === 0) {
      ds.winRate = 0;
    } else {
      const wins = ds.virtualHistory.filter(r => r === 'WIN').length;
      ds.winRate = Math.round((wins / ds.virtualHistory.length) * 100);
    }
  }


  /**
   * Main Engine Entry Point (v17 Market Oracle)
   */
  function generateSignal(candles, pair, pairState) {
    if (!candles || candles.length < 35) return { signal: null, updatedState: pairState };

    // Initialize state
    if (!pairState || !pairState.status || !pairState.deepSight) {
      pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
    }

    const lastCandle = candles[candles.length - 1];
    const now = Date.now();

    // 1. Deep Sight Shadow Tracking Update
    updateDeepSight(pairState, lastCandle.c);

    // 2. Cooldown check
    if (pairState.lastSignalTimestamp && (now - pairState.lastSignalTimestamp) < COOLDOWN_MS) {
      return { signal: null, updatedState: pairState };
    }

    const smcData = smcIndicators.analyzeSmartMoney(candles);
    if (!smcData) return { signal: null, updatedState: pairState };

    const currentTickIndex = candles.length;

    // Timeout check (Reset if IDLE sequence hangs)
    if (pairState.status !== STATES.IDLE && (currentTickIndex - pairState.lastUpdateCandle) > STATE_TIMEOUT_CANDLES) {
      pairState = resetState(pair, pairState.lastSignalTimestamp, pairState.deepSight);
    }

    // --- LIQUIDITY SNIPER V2 LOGIC (v17 ROBUST) ---

    // Step A: Detect Sweeps of EQH/EQL
    const eq = smcData.liquidity.equalLevels;

    // Explicitly check if current candle pierces any EQ level
    let isEQSweep = false;
    let direction = null;

    const TOLERANCE = 0.0002; // Match indicator tolerance for robustness

    // Bullish Sweep check: Candle Low pierces an EQL and Close is above EQL
    const lowestEQL = eq.eqLows.length > 0 ? Math.min(...eq.eqLows.map(l => l.price)) : null;
    if (lowestEQL && lastCandle.l < (lowestEQL + TOLERANCE) && lastCandle.c > lowestEQL) {
        isEQSweep = true;
        direction = 'BUY';
    } else {
        // Bearish Sweep check: Candle High pierces an EQH and Close is below EQH
        const highestEQH = eq.eqHighs.length > 0 ? Math.max(...eq.eqHighs.map(l => l.price)) : null;
        if (highestEQH && lastCandle.h > (highestEQH - TOLERANCE) && lastCandle.c < highestEQH) {
            isEQSweep = true;
            direction = 'SELL';
        }
    }

    if (isEQSweep && pairState.status === STATES.IDLE) {
      pairState.status = STATES.LIQUIDITY_SWEPT;
      pairState.direction = direction;
      pairState.lastUpdateCandle = currentTickIndex;
      pairState.reasons = [`EQ ${direction === 'BUY' ? 'Low' : 'High'} Sweep`];

      // Deep Sight: Log Shadow Trade
      pairState.deepSight.shadowTrades.push({
        startPrice: lastCandle.c,
        direction: direction,
        timestamp: now,
        expiry: now + (3 * 60 * 1000) // 3m shadow duration
      });
    }

    // Step B: Wait for Rejection Confirmation & Institutional Filters
    if (pairState.status === STATES.LIQUIDITY_SWEPT) {
      const pa = smcIndicators.detectPriceActionPatterns(candles);
      const isRejection = (pairState.direction === 'BUY' && (pa.pinBar?.type === 'BULLISH_PIN' || pa.engulfing?.type === 'BULLISH_ENGULFING')) ||
                          (pairState.direction === 'SELL' && (pa.pinBar?.type === 'BEARISH_PIN' || pa.engulfing?.type === 'BEARISH_ENGULFING'));

      if (isRejection) {
        // --- v18 INSTITUTIONAL FILTERS ---
        const ds = pairState.deepSight;
        const isHot = ds.winRate >= 80 && ds.virtualHistory.length >= 5;

        // Bypassed if HOT PAIR
        if (!isHot) {
          // 1. Velocity Delta Confirmation (Acceleration in direction of reversal)
          const vDelta = smcData.velocityDelta;
          const vMatch = (pairState.direction === 'BUY' && vDelta.aligned === 'BULLISH') ||
                         (pairState.direction === 'SELL' && vDelta.aligned === 'BEARISH');
          if (!vMatch) return { signal: null, updatedState: pairState };

          // 2. M15 Trend Confluence
          const trend = smcData.marketStructure.m15Trend;
          const trendMatch = (pairState.direction === 'BUY' && trend === 'BULLISH') ||
                             (pairState.direction === 'SELL' && trend === 'BEARISH');
          if (!trendMatch) return { signal: null, updatedState: pairState };

          // 3. Zonal Filter (Premium/Discount)
          const zone = smcData.premiumDiscount?.currentZone;
          const zoneMatch = (pairState.direction === 'BUY' && zone === 'DISCOUNT') ||
                            (pairState.direction === 'SELL' && zone === 'PREMIUM');
          if (!zoneMatch) return { signal: null, updatedState: pairState };
        }

        pairState.reasons.push('PA Rejection');
        const signal = triggerSignal(pairState, candles, smcData, pair);
        return { signal, updatedState: resetState(pair, now, pairState.deepSight) };
      }
    }

    return { signal: null, updatedState: pairState };
  }


  function triggerSignal(pairState, candles, smcData, pair) {
    const ds = pairState.deepSight;
    const isHot = ds.winRate >= 80 && ds.virtualHistory.length >= 5;
    const conf = isHot ? 100 : 75;

    // Log in v18 format
    console.log(`[PS v18] ${pair} | Pattern: SWEEP | Oracle Score: ${ds.winRate}% | FINAL CONF: ${conf}% ${isHot ? '🔥' : ''}`);

    return {
      action: pairState.direction,
      confidence: conf,
      reasons: pairState.reasons,
      tradeDuration: 3, // Standard M1 precision for v17
      durationReason: isHot ? 'HOT PAIR Oracle Override' : 'Standard Oracle Sniper',
      indicatorValues: { oracleScore: ds.winRate, isHotPair: isHot }
    };
  }

  console.log('[Pocket Scout v18.0] Master of Traps Engine loaded');
  return { generateSignal };

})(window.TechnicalIndicators);
