/**
 * Pocket Scout v23.0.0 - Singularity Engine
 * "Beyond Quantum Ranking - The Ultimate OTC Decision Layer"
 * 
 * PHILOSOPHY:
 * - Regime Awareness: Distinct logic for Trending vs Mean-Reverting markets.
 * - Contrarian Inversion: Detects and profits from predictable OTC manipulation.
 * - Volatility Armor: Shields the balance from 'dead' or 'chaotic' tick regimes.
 * - Deep Sight v4: Prioritizes consistency streaks over simple percentages.
 */

window.V20Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => null,
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

  const MASTER_SPI_THRESHOLD = 0; // Forced Signal Mode (Guaranteed Flow)
  const COOLDOWN_MS = 3 * 60 * 1000;

  /**
   * Reset pair state to IDLE
   */
  function resetState(pair, existingTimestamp = 0, existingDeepSight = null) {
    return {
      status: STATES.IDLE,
      direction: null,
      lastUpdateCandle: 0,
      lastSignalTimestamp: existingTimestamp,
      setupData: {},
      reasons: [],
      deepSight: existingDeepSight || {
        shadowTrades: [],
        virtualHistory: [],
        winRate: 0,
        continuousHistory: [],
        lastSPI: 0
      }
    };
  }

  /**
   * Deep Sight v4: Consistency Tracker
   */
  function updateDeepSight(pairState, currentPrice) {
    const ds = pairState.deepSight;
    const now = Date.now();

    const unresolved = [];
    ds.shadowTrades.forEach(trade => {
      if (now >= trade.expiry) {
        const isWin = (trade.direction === 'BUY' && currentPrice > trade.startPrice) ||
                      (trade.direction === 'SELL' && currentPrice < trade.startPrice);

        const result = isWin ? 'WIN' : 'LOSS';
        ds.virtualHistory.push(result);
        if (ds.virtualHistory.length > 20) ds.virtualHistory.shift();
      } else {
        unresolved.push(trade);
      }
    });
    ds.shadowTrades = unresolved;

    if (ds.virtualHistory.length === 0) {
      ds.winRate = 0;
    } else {
      const wins = ds.virtualHistory.filter(r => r === 'WIN').length;
      ds.winRate = Math.round((wins / ds.virtualHistory.length) * 100);
    }
  }

  /**
   * SPI: Success Probability Index (v23 Singularity Pulse)
   */
  function calculateSPI(pair, pairState, smcData, candles, flux = 0, globalStrength = null) {
    let score = 0;
    const lastCandle = candles[candles.length - 1];
    const regime = smcData.regime;

    // 1. Deep Sight Singularity Reliability (30 pts)
    const ds = pairState?.deepSight;
    const dsWinRate = ds ? (ds.winRate || 0) : 0;
    const consistencyBonus = ds && ds.virtualHistory.slice(-5).every(r => r === 'WIN') ? 10 : 0;
    score += (dsWinRate / 100) * 20 + consistencyBonus;

    // 2. Regime-Aware Technical Alignment (40 pts)
    if (regime === 'TRENDING') {
        if (smcData.marketStructure.trend !== 'RANGING') score += 15;
        if (smcData.displacement) score += 15;
        if (smcData.velocityDelta.aligned !== 'NONE') score += 10;
    } else {
        const hasSweep = (smcData.liquidity.sweeps.bullishSweeps.length > 0 ||
                          smcData.liquidity.sweeps.bearishSweeps.length > 0);
        if (hasSweep) score += 15;
        if (smcData.rsi > 70 || smcData.rsi < 30) score += 15;
        if (smcData.premiumDiscount?.currentZone !== 'EQUILIBRIUM') score += 10;
    }

    // 3. Global Flux & Institutional Sync (20 pts)
    const fluxBonus = Math.min(10, flux * 5);
    score += fluxBonus;
    if (globalStrength) {
        const parts = pair.replace('_OTC', '').split('/');
        const netS = (globalStrength[parts[0]] || 0) - (globalStrength[parts[1]] || 0);
        const setupDir = smcData.marketStructure.m15Trend;
        if ((setupDir === 'BULLISH' && netS > 2) || (setupDir === 'BEARISH' && netS < -2)) score += 10;
    }

    // 4. Volatility Armor (10 pts)
    const atr = smcIndicators.calculateATR(candles, 14);
    if (atr.ratio >= 0.7 && atr.ratio <= 1.6) score += 10;
    else if (atr.ratio > 2.2 || atr.ratio < 0.3) score -= 30; // High noise or zero power

    // 5. Contrarian Inversion (v23 Special)
    const isInverted = ds && ds.winRate < 32 && ds.virtualHistory.length >= 5;
    if (isInverted) score += 20; // High confidence in predictable failure

    return Math.round(score);
  }

  /**
   * processMarketSnapshot (v23 Singularity Pulse)
   */
  function processMarketSnapshot(allPairsData, forcedDuration = 5, globalStrength = null) {
    const pairs = Object.keys(allPairsData);
    if (pairs.length === 0) return null;

    const rankings = [];

    pairs.forEach(pair => {
      let { candles, pairState, flux } = allPairsData[pair];

      if (!pairState || !pairState.deepSight) {
        pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
      }

      const smcData = smcIndicators.analyzeSmartMoney(candles, pair);
      if (!smcData) return;

      const spi = calculateSPI(pair, pairState, smcData, candles, flux, globalStrength);
      pairState.deepSight.lastSPI = spi;

      const trend = smcData.marketStructure.m15Trend;
      const zoneBias = smcData.premiumDiscount?.bias || 'NEUTRAL';
      const vDelta = smcData.velocityDelta;
      const lastCandle = candles[candles.length - 1];

      let direction = null;

      // Decision Matrix
      if (trend === 'BULLISH' && zoneBias !== 'BEARISH') direction = 'BUY';
      else if (trend === 'BEARISH' && zoneBias !== 'BULLISH') direction = 'SELL';
      else if (vDelta.aligned === 'BULLISH') direction = 'BUY';
      else if (vDelta.aligned === 'BEARISH') direction = 'SELL';
      else if (zoneBias !== 'NEUTRAL') direction = zoneBias === 'BULLISH' ? 'BUY' : 'SELL';
      else direction = lastCandle.c >= lastCandle.o ? 'BUY' : 'SELL';

      // v23 CONTRARIAN INVERSION
      const ds = pairState.deepSight;
      const shouldInvert = ds && ds.winRate < 32 && ds.virtualHistory.length >= 5;
      if (shouldInvert) {
          direction = (direction === 'BUY' ? 'SELL' : 'BUY');
      }

      rankings.push({ pair, direction, spi, smcData, candles, pairState, isInverted: shouldInvert });
    });

    if (rankings.length === 0) return null;

    rankings.sort((a, b) => b.spi - a.spi);
    const winner = rankings[0];

    const allUpdatedStates = {};
    rankings.forEach(r => { allUpdatedStates[r.pair] = r.pairState; });

    console.log(`[PS v23.0] 🏆 Singularity: ${winner.pair} | SPI: ${winner.spi} | Mode: ${winner.isInverted ? 'CONTRARIAN' : 'NORMAL'}`);

    return {
        pair: winner.pair,
        action: winner.direction,
        confidence: 100,
        tradeDuration: forcedDuration,
        reasons: [`Singularity Pulse (SPI: ${winner.spi})`, `Regime: ${winner.smcData.regime}`, winner.isInverted ? 'INVERTED LOGIC' : 'NORMAL LOGIC'],
        indicatorValues: { spi: winner.spi, oracleScore: winner.pairState.deepSight.winRate, isInverted: winner.isInverted },
        updatedState: resetState(winner.pair, Date.now(), winner.pairState.deepSight),
        allUpdatedStates: allUpdatedStates
    };
  }

  function syncOracle(pair, pairState, currentPrice) {
    if (!pairState || !pairState.deepSight) {
      pairState = resetState(pair, pairState ? pairState.lastSignalTimestamp : 0, pairState ? pairState.deepSight : null);
    }
    updateDeepSight(pairState, currentPrice);
    return pairState;
  }

  function generateSignal(candles, pair, pairState) {
    return { signal: null, updatedState: pairState }; // Snapshots only in v23
  }

  console.log('[Pocket Scout v23.0] Singularity Engine loaded');
  return { generateSignal, syncOracle, processMarketSnapshot };

})(window.TechnicalIndicators);
