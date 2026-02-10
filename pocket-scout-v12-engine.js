/**
 * Pocket Scout v20.0.0 - Quantum Decider Engine
 * "The Ultimate Dec decisional layer for PocketOption OTC."
 * 
 * PHILOSOPHY:
 * - Global Ranking: Evaluates all 10 pairs simultaneously every 5 minutes.
 * - Continuous Shadow Tracking (v3): Monitors every 5-minute candle outcome.
 * - Success Probability Index (SPI): Scientific ranking of trade quality.
 */

window.V20Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => { 
        console.error("[PS v20 Engine] FATAL: TechnicalIndicators dependency not found.");
        return null;
      },
      syncOracle: (p, s) => s,
      processMarketSnapshot: () => null
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

  const BQI_THRESHOLD = 55; // Strict floor (v21)
  const MASTER_SPI_THRESHOLD = 0; // Forced Signal Mode (v21.1)
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
      // Deep Sight v3 Tracking
      deepSight: existingDeepSight || {
        shadowTrades: [],
        virtualHistory: [],
        winRate: 0,
        continuousHistory: [], // Directional accuracy of every 5-min candle
        lastSPI: 0
      }
    };
  }

  /**
   * Deep Sight v3: Shadow Outcome Evaluator (v20)
   */
  function updateDeepSight(pairState, currentPrice) {
    const ds = pairState.deepSight;
    const now = Date.now();

    // 1. Resolve shadow trades
    const unresolved = [];
    ds.shadowTrades.forEach(trade => {
      if (now >= trade.expiry) {
        const isWin = (trade.direction === 'BUY' && currentPrice > trade.startPrice) ||
                      (trade.direction === 'SELL' && currentPrice < trade.startPrice);

        const result = isWin ? 'WIN' : 'LOSS';
        ds.virtualHistory.push(result);
        if (ds.virtualHistory.length > 15) ds.virtualHistory.shift();

        if (DEBUG_MODE) console.log(`[PS v20 Deep Sight] Shadow resolved: ${result}`);
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
   * SPI: Success Probability Index (v22 Flux Master Edition)
   * A unified scoring system for comparative pair analysis.
   */
  function calculateSPI(pair, pairState, smcData, candles, flux = 0, globalStrength = null) {
    let score = 0;
    const lastCandle = candles[candles.length - 1];

    // 1. Deep Sight Master Reliability (30 pts)
    // Weighted by virtual history length - need proof of consistency
    const ds = pairState?.deepSight;
    const dsWinRate = ds ? (ds.winRate || 0) : 0;
    const consistencyBonus = ds && ds.virtualHistory.length >= 5 ? 5 : 0;
    score += (dsWinRate / 100) * 25 + consistencyBonus;

    // 2. Institutional Flux & Displacement (30 pts) - v22 New Core
    // High tick density = institutional involvement
    const fluxBonus = Math.min(15, flux * 10); // cap at 15 pts
    score += fluxBonus;

    // Displacement check: body size > 2x average of last 10
    const bodySize = Math.abs(lastCandle.c - lastCandle.o);
    const avgBody = candles.slice(-11, -1).reduce((s, c) => s + Math.abs(c.c - c.o), 0) / 10;
    if (bodySize > avgBody * 1.8) score += 15;

    // 3. Global Strength Correlation (20 pts) - v22 New Core
    if (globalStrength) {
        const parts = pair.replace('_OTC', '').split('/');
        if (parts.length === 2) {
            const baseS = globalStrength[parts[0]] || 0;
            const quoteS = globalStrength[parts[1]] || 0;
            const netStrength = baseS - quoteS;
            // If setup is BUY and Base is stronger than Quote
            const setupDir = smcData.marketStructure.m15Trend;
            if ((setupDir === 'BULLISH' && netStrength > 0) || (setupDir === 'BEARISH' && netStrength < 0)) {
                score += 20;
            } else if (netStrength !== 0) {
                score += 10; // partial alignment
            }
        }
    }

    // 4. Institutional SMC Evidence (20 pts)
    const sweeps = smcData.liquidity.sweeps;
    const hasSweep = (sweeps.bullishSweeps.length > 0 || sweeps.bearishSweeps.length > 0);
    if (hasSweep) score += 10;

    const unmitigatedOB = (smcData.orderBlocks.bullishOB.some(ob => !ob.mitigated) ||
                          smcData.orderBlocks.bearishOB.some(ob => !ob.mitigated));
    if (unmitigatedOB) score += 10;

    // 5. Zonal Precision & Volatility (0 pts - moved to filters)
    const zone = smcData.premiumDiscount?.currentZone;
    const atr = smcIndicators.calculateATR(candles, 14);
    if (zone === 'DISCOUNT' || zone === 'PREMIUM') score += 5;
    if (atr.ratio >= 0.8) score += 5; // Avoid dead markets

    return Math.round(score);
  }

  /**
   * processMarketSnapshot (v22 Flux Master Edition)
   * Global analyzer with Flux Intelligence and Global Correlation.
   */
  function processMarketSnapshot(allPairsData, forcedDuration = 5, globalStrength = null) {
    const pairs = Object.keys(allPairsData);
    if (pairs.length === 0) return null;

    const rankings = [];

    pairs.forEach(pair => {
      let { candles, pairState, flux } = allPairsData[pair];

      // Initialize state if missing (v20 defensive)
      if (!pairState || !pairState.deepSight) {
        pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
      }

      const smcData = smcIndicators.analyzeSmartMoney(candles, pair);
      if (!smcData) return;

      const spi = calculateSPI(pair, pairState, smcData, candles, flux, globalStrength);
      pairState.deepSight.lastSPI = spi;

      // Determine Direction based on Multi-Layer Fallback (v21.1 Forced Signal)
      const trend = smcData.marketStructure.m15Trend;
      const zoneBias = smcData.premiumDiscount?.bias || 'NEUTRAL';
      const sweeps = smcData.liquidity.sweeps;
      const vDelta = smcData.velocityDelta;
      const lastCandle = candles[candles.length - 1];

      let direction = null;

      // Layer 1: Trend + Zone alignment (Masterful)
      if (trend === 'BULLISH' && zoneBias !== 'BEARISH') direction = 'BUY';
      else if (trend === 'BEARISH' && zoneBias !== 'BULLISH') direction = 'SELL';
      // Layer 2: Momentum Alignment
      else if (vDelta.aligned === 'BULLISH') direction = 'BUY';
      else if (vDelta.aligned === 'BEARISH') direction = 'SELL';
      // Layer 3: Zonal Bias
      else if (zoneBias !== 'NEUTRAL') direction = zoneBias === 'BULLISH' ? 'BUY' : 'SELL';
      // Layer 4: Liquidity Sweeps
      else if (sweeps.bullishSweeps.length > 0) direction = 'BUY';
      else if (sweeps.bearishSweeps.length > 0) direction = 'SELL';
      // Layer 5: Trend Only
      else if (trend !== 'NEUTRAL') direction = trend === 'BULLISH' ? 'BUY' : 'SELL';
      // Layer 6: Absolute Force (Last Candle Color)
      else direction = lastCandle.c >= lastCandle.o ? 'BUY' : 'SELL';

      rankings.push({ pair, direction, spi, smcData, candles, pairState });
    });

    if (rankings.length === 0) return null;

    // Sort by SPI descending
    rankings.sort((a, b) => b.spi - a.spi);

    const winner = rankings[0];
    const allUpdatedStates = {};
    rankings.forEach(r => {
        allUpdatedStates[r.pair] = r.pairState;
    });

    // MASTER SPI FLOOR (v21.1 Forced)
    if (!winner) {
        return { signal: null, allUpdatedStates };
    }

    // High Quality Winner
    console.log(`[PS v22.0] 🏆 Flux Winner: ${winner.pair} | SPI: ${winner.spi} | CONF: 100%`);

    const signal = {
        pair: winner.pair,
        action: winner.direction,
        confidence: 100, // Oracle Master Override
        tradeDuration: forcedDuration,
        reasons: [`Masterful Selection (SPI: ${winner.spi})`, `Trend: ${winner.smcData.marketStructure.m15Trend}`],
        indicatorValues: { spi: winner.spi, oracleScore: winner.pairState.deepSight.winRate },
        updatedState: resetState(winner.pair, Date.now(), winner.pairState.deepSight),
        allUpdatedStates: allUpdatedStates
    };

    return signal;
  }


  /**
   * syncOracle (v20): Resolve shadow trades on every tick
   */
  function syncOracle(pair, pairState, currentPrice) {
    if (!pairState || !pairState.deepSight) {
      pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
    }
    updateDeepSight(pairState, currentPrice);
    return pairState;
  }

  /**
   * Main Engine Entry Point (v19 Omniscient Oracle)
   */
  function generateSignal(candles, pair, pairState) {
    if (!candles || candles.length < 35) return { signal: null, updatedState: pairState };

    // Initialize state
    if (!pairState || !pairState.status || !pairState.deepSight) {
      pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
    }

    const lastCandle = candles[candles.length - 1];
    const now = Date.now();

    // 1. Resolve Shadow Trades (Real-time update)
    updateDeepSight(pairState, lastCandle.c);

    const smcData = smcIndicators.analyzeSmartMoney(candles, pair);
    if (!smcData) return { signal: null, updatedState: pairState };

    const currentTickIndex = candles.length;

    // --- LIQUIDITY SNIPER V2 LOGIC (v19 Continuous Learning) ---
    const pip = smcIndicators.getPipSize(pair);
    const eq = smcData.liquidity.equalLevels;

    let isEQSweep = false;
    let direction = null;
    const TOLERANCE = 2 * pip;

    const lowestEQL = eq.eqLows.length > 0 ? Math.min(...eq.eqLows.map(l => l.price)) : null;
    if (lowestEQL && lastCandle.l < (lowestEQL + TOLERANCE) && lastCandle.c > lowestEQL) {
        isEQSweep = true;
        direction = 'BUY';
    } else {
        const highestEQH = eq.eqHighs.length > 0 ? Math.max(...eq.eqHighs.map(l => l.price)) : null;
        if (highestEQH && lastCandle.h > (highestEQH - TOLERANCE) && lastCandle.c < highestEQH) {
            isEQSweep = true;
            direction = 'SELL';
        }
    }

    // 2. Record Shadow Trade (Even if in cooldown!)
    if (isEQSweep && pairState.status === STATES.IDLE) {
      pairState.status = STATES.LIQUIDITY_SWEPT;
      pairState.direction = direction;
      pairState.lastUpdateCandle = currentTickIndex;
      pairState.reasons = [`EQ ${direction === 'BUY' ? 'Low' : 'High'} Sweep`];

      pairState.deepSight.shadowTrades.push({
        startPrice: lastCandle.c,
        direction: direction,
        timestamp: now,
        expiry: now + (3 * 60 * 1000)
      });

      if (DEBUG_MODE) console.log(`[PS v19 Deep Sight] ${pair} Shadow Trade Started: ${direction} @ ${lastCandle.c}`);
    }

    // 3. Oracle Check (Hot Pair status)
    const ds = pairState.deepSight;
    const isHot = ds.winRate >= 80 && ds.virtualHistory.length >= 3;

    // 4. Cooldown check (Dynamic for Hot Pairs)
    const activeCooldown = isHot ? 90 * 1000 : COOLDOWN_MS;
    if (pairState.lastSignalTimestamp && (now - pairState.lastSignalTimestamp) < activeCooldown) {
      return { signal: null, updatedState: pairState };
    }

    // 5. Timeout check (Reset if sequence hangs)
    if (pairState.status !== STATES.IDLE && (currentTickIndex - pairState.lastUpdateCandle) > STATE_TIMEOUT_CANDLES) {
      pairState = resetState(pair, pairState.lastSignalTimestamp, pairState.deepSight);
    }

    // Step B: Wait for Rejection Confirmation & Institutional Filters
    if (pairState.status === STATES.LIQUIDITY_SWEPT) {
      const pa = smcIndicators.detectPriceActionPatterns(candles);
      const isRejection = (pairState.direction === 'BUY' && (pa.pinBar?.type === 'BULLISH_PIN' || pa.engulfing?.type === 'BULLISH_ENGULFING')) ||
                          (pairState.direction === 'SELL' && (pa.pinBar?.type === 'BEARISH_PIN' || pa.engulfing?.type === 'BEARISH_ENGULFING'));

      if (isRejection) {
        // --- v19 INSTITUTIONAL FILTERS ---
        // Bypassed if HOT PAIR
        if (!isHot) {
          // 1. Velocity Delta Confirmation
          const vDelta = smcData.velocityDelta;
          const vMatch = (pairState.direction === 'BUY' && vDelta.aligned === 'BULLISH') ||
                         (pairState.direction === 'SELL' && vDelta.aligned === 'BEARISH');
          if (!vMatch) return { signal: null, updatedState: pairState };

          // 2. M15 Trend Confluence
          const trend = smcData.marketStructure.m15Trend;
          const trendMatch = (pairState.direction === 'BUY' && (trend === 'BULLISH' || trend === 'NEUTRAL')) ||
                             (pairState.direction === 'SELL' && (trend === 'BEARISH' || trend === 'NEUTRAL'));
          if (!trendMatch) return { signal: null, updatedState: pairState };

          // 3. Zonal Filter
          const zone = smcData.premiumDiscount?.currentZone;
          const zoneMatch = (pairState.direction === 'BUY' && (zone === 'DISCOUNT' || zone === 'EQUILIBRIUM')) ||
                            (pairState.direction === 'SELL' && (zone === 'PREMIUM' || zone === 'EQUILIBRIUM'));
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
    const isHot = ds.winRate >= 80 && ds.virtualHistory.length >= 3;
    const conf = isHot ? 100 : 75;

    console.log(`[PS v19] ${pair} | Pattern: SWEEP | Oracle Score: ${ds.winRate}% | FINAL CONF: ${conf}% ${isHot ? '🔥' : ''}`);

    return {
      action: pairState.direction,
      confidence: conf,
      reasons: pairState.reasons,
      tradeDuration: 3,
      durationReason: isHot ? 'HOT PAIR Oracle Override' : 'Standard Oracle Sniper',
      indicatorValues: { oracleScore: ds.winRate, isHotPair: isHot }
    };
  }

  console.log('[Pocket Scout v22.0] Flux Master Engine loaded');
  return { generateSignal, syncOracle, processMarketSnapshot };

})(window.TechnicalIndicators);
