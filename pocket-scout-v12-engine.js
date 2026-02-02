/**
 * Pocket Scout v14.0.0 - Aggressive Hunter Engine
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

  // --- Scoring Weights for Confidence Calculation ---
  const WEIGHTS = {
    STATE_SWEPT: 20,
    STATE_DISPLACEMENT: 10,
    STATE_CHOCH: 10,
    STATE_RETEST: 10,
    BQI_FLOOR: 10,       // BQI >= 45
    TREND_ALIGN: 10,     // M15 alignment
    PHASE_EXPANSION: 7,  // Phase != CONTRACTION
    MOMENTUM_BOOST: 13,  // High Velocity strike
    PA_CONFIRM: 10       // Sniper Rejection or PA pattern
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
   * Granular Confidence Calculator
   * Minimum Viable Signal = 47% (SWEPT 20 + BQI 10 + TREND 10 + PHASE 7)
   */
  function calculateConfidence(pairState, smcData, extraFactors = {}) {
    let score = 0;

    // 1. State Progress
    if (pairState.status === STATES.LIQUIDITY_SWEPT) score += WEIGHTS.STATE_SWEPT;
    if (pairState.status === STATES.DISPLACEMENT) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT);
    if (pairState.status === STATES.CHOCH) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT + WEIGHTS.STATE_CHOCH);
    if (pairState.status === STATES.RETEST) score += (WEIGHTS.STATE_SWEPT + WEIGHTS.STATE_DISPLACEMENT + WEIGHTS.STATE_CHOCH + WEIGHTS.STATE_RETEST);

    // 2. Breakout Quality
    const bqi = pairState.setupData.lastBQI || 0;
    if (bqi >= BQI_THRESHOLD) score += WEIGHTS.BQI_FLOOR;

    // 3. Context
    if (smcData.marketStructure.m15Trend === pairState.direction) score += WEIGHTS.TREND_ALIGN;
    if (smcData.marketPhase !== 'CONTRACTION') score += WEIGHTS.PHASE_EXPANSION;

    // 4. Boosts
    if (extraFactors.momentum) score += WEIGHTS.MOMENTUM_BOOST;
    if (extraFactors.pa) score += WEIGHTS.PA_CONFIRM;

    return Math.min(100, score);
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
        const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: vNow > 0 ? 'BUY' : 'SELL', setupData: { lastBQI: 50 } }, smcData, { momentum: true, pa: true });
        return { action: vNow > 0 ? 'BUY' : 'SELL', confidence: conf, reasons: ['Velocity Strike'], tradeDuration: 2, durationReason: 'Momentum', indicatorValues: { marketPhase: smcData.marketPhase } };
      }
    }
    return null;
  }

  function checkGapAndGo(candles, smcData) {
    const trend = smcData.marketStructure.m15Trend;
    const last = candles[candles.length - 1], prev = candles[candles.length - 2];
    const fvgB = smcData.imbalance.bullishIMB.find(i => !i.mitigated && i.gap > 0.00003 && i.time === prev.t);
    const fvgS = smcData.imbalance.bearishIMB.find(i => !i.mitigated && i.gap > 0.00003 && i.time === prev.t);

    if (fvgB && trend === 'BULLISH' && (prev.h - last.c) / (prev.h - prev.l || 0.00001) < 0.2) {
      const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: 'BUY', setupData: { lastBQI: 45 } }, smcData, { momentum: true });
      return { action: 'BUY', confidence: conf, reasons: ['Gap & Go'], tradeDuration: 3, durationReason: 'FVG Impulse', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    if (fvgS && trend === 'BEARISH' && (last.c - prev.l) / (prev.h - prev.l || 0.00001) < 0.2) {
      const conf = calculateConfidence({ status: STATES.DISPLACEMENT, direction: 'SELL', setupData: { lastBQI: 45 } }, smcData, { momentum: true });
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
        const conf = calculateConfidence({ status: STATES.LIQUIDITY_SWEPT, direction: 'BUY', setupData: { lastBQI: 45 } }, smcData, { pa: true });
        return { action: 'BUY', confidence: conf, reasons: ['Sniper Support'], tradeDuration: 3, durationReason: 'Rejection', indicatorValues: { marketPhase: smcData.marketPhase } };
      }
    }
    if ((last.h - last.o) / (range || 0.00001) > 0.6) {
      if (snr.some(l => Math.abs(last.h - l.price) < 0.00002) || mitigated.some(o => Math.abs(last.h - o.high) < 0.00002)) {
        const conf = calculateConfidence({ status: STATES.LIQUIDITY_SWEPT, direction: 'SELL', setupData: { lastBQI: 45 } }, smcData, { pa: true });
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
      const conf = calculateConfidence(pairState, smcData, { pa: true });
      return { action: 'BUY', confidence: conf, reasons: ['Hybrid Setup'], tradeDuration: 3, durationReason: 'Safety Valve', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    if (pairState.direction === 'SELL' && fvgS && (pa.pinBar?.type === 'BEARISH_PIN' || pa.engulfing?.type === 'BEARISH_ENGULFING')) {
      const conf = calculateConfidence(pairState, smcData, { pa: true });
      return { action: 'SELL', confidence: conf, reasons: ['Hybrid Setup'], tradeDuration: 3, durationReason: 'Safety Valve', indicatorValues: { marketPhase: smcData.marketPhase } };
    }
    return null;
  }

  function triggerSignal(pairState, candles, smcData, desc, extra = {}) {
    const conf = calculateConfidence(pairState, smcData, extra);
    // V14 Logic: Enforce 3m expiry for "Minimum Viable Signals" (approx 47%) based on SMC Liquidity Sweeps
    let duration = smcData.marketPhase === 'EXPANSION' ? 5 : 3;
    if (conf <= 48) duration = 3;

    return {
      action: pairState.direction,
      confidence: conf,
      reasons: pairState.reasons,
      tradeDuration: duration,
      durationReason: desc,
      indicatorValues: { rawScore: Math.floor(conf * 3.5), marketPhase: smcData.marketPhase }
    };
  }

  console.log('[Pocket Scout v14.0] Aggressive Hunter Engine loaded');
  return { generateSignal };

})(window.TechnicalIndicators);
