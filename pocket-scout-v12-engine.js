/**
 * Pocket Scout v15.0.0 - Sniper Precision Engine
 * "Multi-path execution for maximum signal frequency."
 * 
 * PHILOSOPHY:
 * - Triple Threat Decision Engine (Velocity Strike, Gap & Go, Sniper Rejection)
 * - Lower BQI threshold (45) for higher signal volume
 * - FastTrack bypass for momentum sequences
 * - 10-minute cooldown per pair
 */

window.V14Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => { 
        console.error("[PS v14 Engine] FATAL: TechnicalIndicators dependency not found.");
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
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes throttle

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
  function resetState(pair, existingTimestamp = 0) {
    return {
      status: STATES.IDLE,
      direction: null,
      lastUpdateCandle: 0,
      lastSignalTimestamp: existingTimestamp, // Preserve cooldown
      setupData: {},
      reasons: []
    };
  }

  /**
   * V15 Sniper Confidence Calculator
   * Prioritizes Confluence (Context + Zone + State)
   */
  function calculateConfidence(pairState, smcData, extraFactors = {}, candles = []) {
    let score = 0;

    // 1. State Progress (Cumulative)
    if (pairState.status === STATES.LIQUIDITY_SWEPT) score += WEIGHTS.STATE_SWEPT;
    if (pairState.status === STATES.DISPLACEMENT) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT);
    if (pairState.status === STATES.CHOCH) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT + WEIGHTS.STATE_CHOCH);
    if (pairState.status === STATES.RETEST) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT + WEIGHTS.STATE_CHOCH + WEIGHTS.STATE_RETEST);

    // 2. Breakout Quality (Tiers)
    const bqi = pairState.setupData.lastBQI || 0;
    if (bqi >= 65) score += WEIGHTS.BQI_65;
    else if (bqi >= 45) score += WEIGHTS.BQI_45;

    // 3. Context & Multi-Timeframe Alignment
    if (smcData.marketStructure.m15Trend === pairState.direction) score += WEIGHTS.TREND_ALIGN_M15;

    // Estimate H1 Trend (using 60-candle EMA)
    if (candles.length >= 60) {
      const closes = candles.map(c => c.c);
      const ema60 = closes.slice(-60).reduce((a, b) => a + b, 0) / 60;
      const h1Trend = closes[closes.length - 1] > ema60 ? 'BUY' : 'SELL';
      if (h1Trend === pairState.direction) score += WEIGHTS.TREND_ALIGN_H1;
    }

    // 4. Zonal Alignment (Premium/Discount/OTE)
    if (smcData.premiumDiscount) {
      if ((pairState.direction === 'BUY' && smcData.premiumDiscount.currentZone === 'DISCOUNT') ||
          (pairState.direction === 'SELL' && smcData.premiumDiscount.currentZone === 'PREMIUM')) {
        score += WEIGHTS.ZONE_ALIGN;
      }
    }

    if (smcData.ote && candles.length > 0) {
      const currentPrice = candles[candles.length - 1].c;
      if (smcIndicators.isInOTEZone(currentPrice, smcData.ote, pairState.direction)) {
        score += WEIGHTS.OTE_BOOST;
      }
    }

    // 5. Momentum Confluence
    if (candles.length >= 14) {
      const rsi = indicators.calculateRSI(candles.map(c => c.c), 14);
      if (rsi && rsi.length >= 10) {
        const div = indicators.detectRSIDivergence(candles.map(c => c.c), rsi, 10);
        if ((pairState.direction === 'BUY' && div.bullish) || (pairState.direction === 'SELL' && div.bearish)) {
          score += WEIGHTS.RSI_DIVERGENCE;
        }
      }
    }

    // 6. Market Narrative
    if (smcData.marketPhase === 'EXPANSION') score += WEIGHTS.PHASE_EXPANSION;

    // 7. Trap Penalty (Inducement)
    if (smcData.inducement) {
      const currentPrice = candles[candles.length - 1].c;
      const traps = pairState.direction === 'BUY' ? smcData.inducement.bullishInducement : smcData.inducement.bearishInducement;
      // If price is reacting to inducement BEFORE hitting the real POI (un-swept inducement in path)
      const isTrap = traps.some(t => {
        if (pairState.direction === 'BUY') return t.price < currentPrice && t.price > (smcData.premiumDiscount?.discountLevel || 0);
        else return t.price > currentPrice && t.price < (smcData.premiumDiscount?.premiumLevel || 999);
      });
      if (isTrap) score -= 25; // Significant penalty for potential trap
    }

    // 8. Boosts
    if (extraFactors.momentum) score += WEIGHTS.MOMENTUM_BOOST;
    if (extraFactors.pa) score += WEIGHTS.PA_CONFIRM;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Main Engine Entry Point
   */
  function generateSignal(candles, pair, pairState) {
    if (!candles || candles.length < 35) return { signal: null, updatedState: pairState };

    // Initialize state
    if (!pairState || !pairState.status) pairState = resetState(pair);

    const now = Date.now();
    // 10-minute throttle
    if (pairState.lastSignalTimestamp && (now - pairState.lastSignalTimestamp) < COOLDOWN_MS) {
      return { signal: null, updatedState: pairState };
    }

    const smcData = smcIndicators.analyzeSmartMoney(candles);
    if (!smcData) return { signal: null, updatedState: pairState };

    const lastCandle = candles[candles.length - 1];
    const currentTickIndex = candles.length;

    // Timeout check
    if (pairState.status !== STATES.IDLE && (currentTickIndex - pairState.lastUpdateCandle) > STATE_TIMEOUT_CANDLES) {
      pairState = resetState(pair, pairState.lastSignalTimestamp);
    }

    let signal = null;

    // Path 1: Velocity Strike (Pure Momentum)
    const vStrike = checkVelocityStrike(candles, smcData);
    if (vStrike) return { signal: vStrike, updatedState: resetState(pair, now) };

    // Path 2: Gap & Go (FVG Aggression)
    const gGo = checkGapAndGo(candles, smcData);
    if (gGo) return { signal: gGo, updatedState: resetState(pair, now) };

    // Path 3: Sniper Rejection (Local SNR)
    const sniper = checkSniperRejection(candles, smcData);
    if (sniper) return { signal: sniper, updatedState: resetState(pair, now) };

    // State Machine
    switch (pairState.status) {
      case STATES.IDLE:
        const sweeps = smcData.liquidity.sweeps;
        if (sweeps.bullishSweeps.length > 0) {
          pairState.status = STATES.LIQUIDITY_SWEPT;
          pairState.direction = 'BUY';
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons = ['Liquidity Sweep'];
        } else if (sweeps.bearishSweeps.length > 0) {
          pairState.status = STATES.LIQUIDITY_SWEPT;
          pairState.direction = 'SELL';
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons = ['Liquidity Sweep'];
        }
        break;

      case STATES.LIQUIDITY_SWEPT:
        const hybrid = checkHybridSetup(candles, pairState, smcData);
        if (hybrid) return { signal: hybrid, updatedState: resetState(pair, now) };

        const atr = smcIndicators.calculateATR(candles, 14);
        if ((lastCandle.h - lastCandle.l) > (atr.current * 1.2)) {
          const v = smcData.velocityDelta.velocity;
          if ((pairState.direction === 'BUY' && v > 0) || (pairState.direction === 'SELL' && v < 0)) {
            pairState.status = STATES.DISPLACEMENT;
            pairState.lastUpdateCandle = currentTickIndex;
            pairState.reasons.push('Displacement');
          }
        }
        break;

      case STATES.DISPLACEMENT:
        const lastCHoCH = smcData.marketStructure.lastCHoCH;
        if (lastCHoCH && lastCHoCH.bqi >= BQI_THRESHOLD && ((pairState.direction === 'BUY' && lastCHoCH.type === 'BULLISH_CHoCH') || (pairState.direction === 'SELL' && lastCHoCH.type === 'BEARISH_CHoCH'))) {
          pairState.status = STATES.CHOCH;
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.setupData.lastBQI = lastCHoCH.bqi;
          pairState.reasons.push('CHoCH Sequence');
          
          // FastTrack Bypass
          if ((pairState.direction === 'BUY' && smcData.velocityDelta.aligned === 'BULLISH') || (pairState.direction === 'SELL' && smcData.velocityDelta.aligned === 'BEARISH')) {
             return { signal: triggerSignal(pairState, candles, smcData, 'FastTrack Entry', { momentum: true }), updatedState: resetState(pair, now) };
          }
          pairState.setupData.poi = { orderBlocks: smcData.orderBlocks, imbalance: smcData.imbalance };
        }
        break;

      case STATES.CHOCH:
        const pois = pairState.setupData.poi;
        let retest = false;
        if (pairState.direction === 'BUY') {
          const ob = pois.orderBlocks.bullishOB.find(z => !z.mitigated);
          const imb = pois.imbalance.bullishIMB.find(z => !z.mitigated);
          if ((ob && lastCandle.l <= ob.high) || (imb && lastCandle.l <= imb.top)) retest = true;
        } else {
          const ob = pois.orderBlocks.bearishOB.find(z => !z.mitigated);
          const imb = pois.imbalance.bearishIMB.find(z => !z.mitigated);
          if ((ob && lastCandle.h >= ob.low) || (imb && lastCandle.h >= imb.bottom)) retest = true;
        }
        if (retest) {
          pairState.status = STATES.RETEST;
          return { signal: triggerSignal(pairState, candles, smcData, 'Sequence Complete'), updatedState: resetState(pair, now) };
        }
        break;
    }

    return { signal: null, updatedState: pairState };
  }

  function checkVelocityStrike(candles, smcData) {
    const vNow = smcData.velocityDelta.velocity;
    let totalV = 0;
    for (let i = 1; i <= 10; i++) totalV += Math.abs((candles[candles.length - i].c - candles[candles.length - i - 3].c) / 3);
    const avgV = totalV / 10;
    const lastCandle = candles[candles.length - 1];
    const body = Math.abs(lastCandle.c - lastCandle.o) / (lastCandle.h - lastCandle.l || 0.00001);

    if (Math.abs(vNow) > avgV * 1.8 && body > 0.7) {
      const isPivot = (vNow > 0 && lastCandle.c > Math.max(...candles.slice(-6, -1).map(c => c.h))) || (vNow < 0 && lastCandle.c < Math.min(...candles.slice(-6, -1).map(c => c.l)));
      if (isPivot) {
        const dir = vNow > 0 ? 'BUY' : 'SELL';
        // V15 Sniper: Momentum MUST be trend-aligned for high confidence
        if (smcData.marketStructure.m15Trend !== dir && smcData.marketPhase !== 'EXPANSION') return null;

        const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: dir, setupData: { lastBQI: 55 } }, smcData, { momentum: true, pa: true }, candles);
        return { action: dir, confidence: conf, reasons: ['Velocity Strike'], tradeDuration: 2, durationReason: 'Momentum', indicatorValues: { marketPhase: smcData.marketPhase } };
      }
    }
    return null;
  }

  function checkGapAndGo(candles, smcData) {
    const trend = smcData.marketStructure.m15Trend;
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    const fvgB = smcData.imbalance.bullishIMB.find(i => !i.mitigated && i.gap > 0.00003 && i.time === prev.t);
    const fvgS = smcData.imbalance.bearishIMB.find(i => !i.mitigated && i.gap > 0.00003 && i.time === prev.t);
    const zone = smcData.premiumDiscount?.currentZone;

    if (fvgB && trend === 'BULLISH' && zone === 'DISCOUNT' && (prev.h - last.c) / (prev.h - prev.l || 0.00001) < 0.2) {
      const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: 'BUY', setupData: { lastBQI: 50 } }, smcData, { momentum: true }, candles);
      return { action: 'BUY', confidence: conf, reasons: ['Gap & Go'], tradeDuration: 3, durationReason: 'FVG Impulse', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    if (fvgS && trend === 'BEARISH' && zone === 'PREMIUM' && (last.c - prev.l) / (prev.h - prev.l || 0.00001) < 0.2) {
      const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: 'SELL', setupData: { lastBQI: 50 } }, smcData, { momentum: true }, candles);
      return { action: 'SELL', confidence: conf, reasons: ['Gap & Go'], tradeDuration: 3, durationReason: 'FVG Impulse', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    return null;
  }

  function checkSniperRejection(candles, smcData) {
    const last = candles[candles.length - 1], range = last.h - last.l;
    const snr = smcIndicators.getSNRLevels(candles);
    const mitigated = [...smcData.orderBlocks.bullishOB, ...smcData.orderBlocks.bearishOB].filter(o => o.mitigated);
    if ((last.o - last.l) / (range || 0.00001) > 0.6) {
      if (snr.some(l => Math.abs(last.l - l.price) < 0.00002) || mitigated.some(o => Math.abs(last.l - o.low) < 0.00002)) {
        const conf = calculateConfidence({ status: STATES.LIQUIDITY_SWEPT, direction: 'BUY', setupData: { lastBQI: 45 } }, smcData, { pa: true }, candles);
        return { action: 'BUY', confidence: conf, reasons: ['Sniper Support'], tradeDuration: 3, durationReason: 'Rejection', indicatorValues: { marketPhase: smcData.marketPhase } };
      }
    }
    if ((last.h - last.o) / (range || 0.00001) > 0.6) {
      if (snr.some(l => Math.abs(last.h - l.price) < 0.00002) || mitigated.some(o => Math.abs(last.h - o.high) < 0.00002)) {
        const conf = calculateConfidence({ status: STATES.LIQUIDITY_SWEPT, direction: 'SELL', setupData: { lastBQI: 45 } }, smcData, { pa: true }, candles);
        return { action: 'SELL', confidence: conf, reasons: ['Sniper Resistance'], tradeDuration: 3, durationReason: 'Rejection', indicatorValues: { marketPhase: smcData.marketPhase } };
      }
    }
    return null;
  }

  function checkHybridSetup(candles, pairState, smcData) {
    const last = candles[candles.length - 1], pa = smcIndicators.detectPriceActionPatterns(candles);
    const fvgB = smcData.imbalance.bullishIMB.find(i => !i.mitigated && last.l <= i.top);
    const fvgS = smcData.imbalance.bearishIMB.find(i => !i.mitigated && last.h >= i.bottom);
    if (pairState.direction === 'BUY' && fvgB && (pa.pinBar?.type === 'BULLISH_PIN' || pa.engulfing?.type === 'BULLISH_ENGULFING')) {
      const conf = calculateConfidence(pairState, smcData, { pa: true }, candles);
      return { action: 'BUY', confidence: conf, reasons: ['Hybrid Setup'], tradeDuration: 3, durationReason: 'Safety Valve', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    if (pairState.direction === 'SELL' && fvgS && (pa.pinBar?.type === 'BEARISH_PIN' || pa.engulfing?.type === 'BEARISH_ENGULFING')) {
      const conf = calculateConfidence(pairState, smcData, { pa: true }, candles);
      return { action: 'SELL', confidence: conf, reasons: ['Hybrid Setup'], tradeDuration: 3, durationReason: 'Safety Valve', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    return null;
  }

  function triggerSignal(pairState, candles, smcData, desc, extra = {}) {
    const conf = calculateConfidence(pairState, smcData, extra, candles);
    // V15 Logic: Calibrated expiry based on confidence and market phase
    let duration = smcData.marketPhase === 'EXPANSION' ? 5 : 3;
    if (conf >= 70) duration = 3; // Sniper entries prefer 3m precision

    return {
      action: pairState.direction,
      confidence: conf,
      reasons: pairState.reasons,
      tradeDuration: duration,
      durationReason: desc,
      indicatorValues: { rawScore: Math.floor(conf * 3.5), marketPhase: smcData.marketPhase }
    };
  }

  console.log('[Pocket Scout v15.0] Sniper Precision Engine loaded');
  return { generateSignal };

})(window.TechnicalIndicators);
