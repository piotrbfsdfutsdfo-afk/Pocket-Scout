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

  const BQI_THRESHOLD = 45; // Lowered from 55 to "Aggressive Hunter"
  const STATE_TIMEOUT_CANDLES = 40;
  const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Reset pair state to IDLE
   */
  function resetState(pair, existingTimestamp = 0) {
    return {
      status: STATES.IDLE,
      direction: null,
      lastUpdateCandle: 0,
      lastSignalTimestamp: existingTimestamp, // Preserve cooldown tracking
      setupData: {},
      reasons: []
    };
  }

  /**
   * FastTrack Bypass: Skip waiting for retest if momentum is strong
   */
  function fastTrack(smcData, pairState) {
    const vDelta = smcData.velocityDelta;
    return (pairState.direction === 'BUY' && vDelta.aligned === 'BULLISH') ||
           (pairState.direction === 'SELL' && vDelta.aligned === 'BEARISH');
  }

  /**
   * Main Engine Entry Point
   */
  function generateSignal(candles, pair, pairState) {
    if (!candles || candles.length < 35) return { signal: null, updatedState: pairState };

    // Initialize state if new pair
    if (!pairState || !pairState.status) {
      pairState = resetState(pair);
    }

    const now = Date.now();
    // Throttle: 10 minutes cooldown per pair
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

    // --- TRIPLE THREAT ENGINE ---

    // Path 1: Velocity Strike (Pure Momentum)
    const vStrike = checkVelocityStrike(candles, smcData);
    if (vStrike) {
      return { signal: vStrike, updatedState: resetState(pair, now) };
    }

    // Path 2: Gap & Go (FVG Aggression)
    const gGo = checkGapAndGo(candles, smcData);
    if (gGo) {
      return { signal: gGo, updatedState: resetState(pair, now) };
    }

    // Path 3: Sniper Rejection (Local SNR)
    const sniper = checkSniperRejection(candles, smcData);
    if (sniper) {
      return { signal: sniper, updatedState: resetState(pair, now) };
    }

    // --- SMC Prime State Machine ---
    switch (pairState.status) {
      case STATES.IDLE:
        const sweeps = smcData.liquidity.sweeps;
        if (sweeps.bullishSweeps.length > 0) {
          pairState.status = STATES.LIQUIDITY_SWEPT;
          pairState.direction = 'BUY';
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons = ['Liquidity Sweep (Bullish)'];
        } else if (sweeps.bearishSweeps.length > 0) {
          pairState.status = STATES.LIQUIDITY_SWEPT;
          pairState.direction = 'SELL';
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons = ['Liquidity Sweep (Bearish)'];
        }
        break;

      case STATES.LIQUIDITY_SWEPT:
        // HYBRID LOGIC SAFETY VALVE:
        // If Sweep + FVG Retest + PA occur, trigger 60% signal immediately
        const hybridSignal = checkHybridSetup(candles, pairState, smcData);
        if (hybridSignal) {
          return { signal: hybridSignal, updatedState: resetState(pair, now) };
        }

        const vDelta = smcData.velocityDelta;
        const atr = smcIndicators.calculateATR(candles, 14);
        const candleRange = lastCandle.h - lastCandle.l;
        const isDisplacement = candleRange > (atr.current * 1.2);

        const correctDirection = (pairState.direction === 'BUY' && vDelta.velocity > 0) ||
                                 (pairState.direction === 'SELL' && vDelta.velocity < 0);

        if (correctDirection && isDisplacement) {
          pairState.status = STATES.DISPLACEMENT;
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons.push('Displacement detected');
        }
        break;

      case STATES.DISPLACEMENT:
        const structure = smcData.marketStructure;
        const lastCHoCH = structure.lastCHoCH;
        if (lastCHoCH && lastCHoCH.bqi >= BQI_THRESHOLD &&
            ((pairState.direction === 'BUY' && lastCHoCH.type === 'BULLISH_CHoCH') ||
             (pairState.direction === 'SELL' && lastCHoCH.type === 'BEARISH_CHoCH'))) {

          pairState.status = STATES.CHOCH;
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons.push(`CHoCH (BQI: ${lastCHoCH.bqi})`);
          
          // FastTrack Bypass: Enter immediately if momentum is aligned
          if (fastTrack(smcData, pairState)) {
             signal = triggerSignal(pairState, candles, smcData, 'FastTrack Entry');
             return { signal, updatedState: resetState(pair, now) };
          }

          pairState.setupData.poi = {
            orderBlocks: smcData.orderBlocks,
            imbalance: smcData.imbalance
          };
        }
        break;

      case STATES.CHOCH:
        const pois = pairState.setupData.poi;
        let isRetesting = false;
        if (pairState.direction === 'BUY') {
          const freshOB = pois.orderBlocks.bullishOB.find(ob => !ob.mitigated);
          const freshIMB = pois.imbalance.bullishIMB.find(imb => !imb.mitigated);
          if ((freshOB && lastCandle.l <= freshOB.high) || (freshIMB && lastCandle.l <= freshIMB.top)) isRetesting = true;
        } else {
          const freshOB = pois.orderBlocks.bearishOB.find(ob => !ob.mitigated);
          const freshIMB = pois.imbalance.bearishIMB.find(imb => !imb.mitigated);
          if ((freshOB && lastCandle.h >= freshOB.low) || (freshIMB && lastCandle.h >= freshIMB.bottom)) isRetesting = true;
        }

        if (isRetesting) {
          pairState.status = STATES.RETEST;
          pairState.reasons.push('POI Retest');
          signal = triggerSignal(pairState, candles, smcData, 'SMC Sequence complete');
          return { signal, updatedState: resetState(pair, now) };
        }
        break;
    }

    return { signal, updatedState: pairState };
  }

  /**
   * Path 1: Velocity Strike (Momentum)
   */
  function checkVelocityStrike(candles, smcData) {
    const vNow = smcData.velocityDelta.velocity;
    const absV = Math.abs(vNow);

    // Average velocity (last 10)
    let totalV = 0;
    for (let i = 1; i <= 10; i++) {
        const v = (candles[candles.length - i].c - candles[candles.length - i - 3].c) / 3;
        totalV += Math.abs(v);
    }
    const avgV = totalV / 10;

    const lastCandle = candles[candles.length - 1];
    const bodyRatio = Math.abs(lastCandle.c - lastCandle.o) / (lastCandle.h - lastCandle.l || 0.00001);

    if (absV > avgV * 1.8 && bodyRatio > 0.7) {
      // Local Pivot break? (Just a higher high or lower low than last 5)
      const isPivotBreak = (vNow > 0 && lastCandle.c > Math.max(...candles.slice(-6, -1).map(c => c.h))) ||
                           (vNow < 0 && lastCandle.c < Math.min(...candles.slice(-6, -1).map(c => c.l)));

      if (isPivotBreak) {
        return {
          action: vNow > 0 ? 'BUY' : 'SELL',
          confidence: 70,
          reasons: ['Velocity Strike (Momentum)'],
          tradeDuration: 2,
          durationReason: 'Momentum Blast',
          indicatorValues: { rawScore: 250, marketPhase: smcData.marketPhase }
        };
      }
    }
    return null;
  }

  /**
   * Path 2: Gap & Go (FVG Aggression)
   */
  function checkGapAndGo(candles, smcData) {
    const m15Trend = smcData.marketStructure.m15Trend;
    const fvgBull = smcData.imbalance.bullishIMB.filter(imb => !imb.mitigated && imb.gap > 0.00003); // ~3 pips
    const fvgBear = smcData.imbalance.bearishIMB.filter(imb => !imb.mitigated && imb.gap > 0.00003);

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Bullish Gap & Go
    if (fvgBull.length > 0 && m15Trend === 'BULLISH') {
       const latestFVG = fvgBull[fvgBull.length - 1];
       // Did it just form?
       if (latestFVG.time === prevCandle.t) {
          // Enter if retrace < 20%
          const retrace = (prevCandle.h - lastCandle.c) / (prevCandle.h - prevCandle.l || 0.00001);
          if (retrace < 0.2) {
            return {
              action: 'BUY',
              confidence: 70,
              reasons: ['Gap & Go (FVG Aggression)'],
              tradeDuration: 3,
              durationReason: 'FVG Impulse',
              indicatorValues: { rawScore: 250, marketPhase: smcData.marketPhase }
            };
          }
       }
    }

    // Bearish Gap & Go
    if (fvgBear.length > 0 && m15Trend === 'BEARISH') {
       const latestFVG = fvgBear[fvgBear.length - 1];
       if (latestFVG.time === prevCandle.t) {
          const retrace = (lastCandle.c - prevCandle.l) / (prevCandle.h - prevCandle.l || 0.00001);
          if (retrace < 0.2) {
            return {
              action: 'SELL',
              confidence: 70,
              reasons: ['Gap & Go (FVG Aggression)'],
              tradeDuration: 3,
              durationReason: 'FVG Impulse',
              indicatorValues: { rawScore: 250, marketPhase: smcData.marketPhase }
            };
          }
       }
    }
    return null;
  }

  /**
   * Hybrid Logic: Sweep + FVG + PA
   */
  function checkHybridSetup(candles, pairState, smcData) {
    const lastCandle = candles[candles.length - 1];
    const pa = smcIndicators.detectPriceActionPatterns(candles);

    // Check for FVG proximity (any fresh FVG)
    const freshBullishFVG = smcData.imbalance.bullishIMB.find(imb => !imb.mitigated);
    const freshBearishFVG = smcData.imbalance.bearishIMB.find(imb => !imb.mitigated);

    if (pairState.direction === 'BUY' && freshBullishFVG && (pa.pinBar?.type === 'BULLISH_PIN' || pa.engulfing?.type === 'BULLISH_ENGULFING')) {
      if (lastCandle.l <= freshBullishFVG.top) {
        return {
          action: 'BUY',
          confidence: 60,
          reasons: ['Hybrid: Sweep + FVG Retest + PA'],
          tradeDuration: 3,
          durationReason: 'Hybrid Quick Entry',
          indicatorValues: { rawScore: 180, marketPhase: smcData.marketPhase, velocity: smcData.velocityDelta.velocity }
        };
      }
    }

    if (pairState.direction === 'SELL' && freshBearishFVG && (pa.pinBar?.type === 'BEARISH_PIN' || pa.engulfing?.type === 'BEARISH_ENGULFING')) {
      if (lastCandle.h >= freshBearishFVG.bottom) {
        return {
          action: 'SELL',
          confidence: 60,
          reasons: ['Hybrid: Sweep + FVG Retest + PA'],
          tradeDuration: 3,
          durationReason: 'Hybrid Quick Entry',
          indicatorValues: { rawScore: 180, marketPhase: smcData.marketPhase, velocity: smcData.velocityDelta.velocity }
        };
      }
    }

    return null;
  }

  /**
   * Path 3: Sniper Rejection (Local SNR)
   */
  function checkSniperRejection(candles, smcData) {
    const lastCandle = candles[candles.length - 1];
    const totalRange = lastCandle.h - lastCandle.l;
    const bodyTop = Math.max(lastCandle.o, lastCandle.c);
    const bodyBottom = Math.min(lastCandle.o, lastCandle.c);
    const upperWick = lastCandle.h - bodyTop;
    const lowerWick = bodyBottom - lastCandle.l;

    const snrLevels = smcIndicators.getSNRLevels(candles);
    const mitigatedOBs = [...smcData.orderBlocks.bullishOB, ...smcData.orderBlocks.bearishOB].filter(ob => ob.mitigated);

    // Bullish Rejection
    if (lowerWick / (totalRange || 0.00001) > 0.6) {
       const atSupport = snrLevels.some(l => Math.abs(lastCandle.l - l.price) < 0.00002) ||
                         mitigatedOBs.some(ob => Math.abs(lastCandle.l - ob.low) < 0.00002);
       if (atSupport) {
         return {
           action: 'BUY',
           confidence: 60,
           reasons: ['Sniper Rejection (Support)'],
           tradeDuration: 3,
           durationReason: 'Rejection at SNR',
           indicatorValues: { rawScore: 180, marketPhase: smcData.marketPhase }
         };
       }
    }

    // Bearish Rejection
    if (upperWick / (totalRange || 0.00001) > 0.6) {
       const atResistance = snrLevels.some(l => Math.abs(lastCandle.h - l.price) < 0.00002) ||
                            mitigatedOBs.some(ob => Math.abs(lastCandle.h - ob.high) < 0.00002);
       if (atResistance) {
         return {
           action: 'SELL',
           confidence: 60,
           reasons: ['Sniper Rejection (Resistance)'],
           tradeDuration: 3,
           durationReason: 'Rejection at SNR',
           indicatorValues: { rawScore: 180, marketPhase: smcData.marketPhase }
         };
       }
    }
    return null;
  }

  function triggerSignal(pairState, candles, smcData, desc) {
    let tradeDuration = 3;
    if (smcData.marketPhase === 'EXPANSION') tradeDuration = 5;
    return {
      action: pairState.direction,
      confidence: 70,
      reasons: pairState.reasons,
      tradeDuration: tradeDuration,
      durationReason: desc,
      indicatorValues: { rawScore: 250, marketPhase: smcData.marketPhase, velocity: smcData.velocityDelta.velocity }
    };
  }

  console.log('[Pocket Scout v14.0] Aggressive Hunter Engine loaded');
  return { generateSignal };

})(window.TechnicalIndicators);
