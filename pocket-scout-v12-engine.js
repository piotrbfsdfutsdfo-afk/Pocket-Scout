/**
 * Pocket Scout v13.0.0 - SMC Prime Engine
 * "Not a point calculator, but a sequence analyzer."
 * 
 * PHILOSOPHY:
 * - Institutional sequence tracking (SMC Prime)
 * - Breakout Quality Index (BQI) validation
 * - Market Phase filtering
 * - Persistence of setup state across ticks
 * 
 * SEQUENCE:
 * IDLE -> LIQUIDITY_SWEPT -> DISPLACEMENT -> CHOCH -> RETEST -> EXECUTION
 */

window.V13Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => { 
        console.error("[PS v13 Engine] FATAL: TechnicalIndicators dependency not found.");
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

  const BQI_THRESHOLD = 55; // Lowered from 65 to "breathe"
  const STATE_TIMEOUT_CANDLES = 40; // Increased from 20 to allow institutional moves to develop

  /**
   * Reset pair state to IDLE
   */
  function resetState(pair) {
    return {
      status: STATES.IDLE,
      direction: null,
      lastUpdateCandle: 0,
      setupData: {},
      reasons: []
    };
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

    const smcData = smcIndicators.analyzeSmartMoney(candles);
    if (!smcData) return { signal: null, updatedState: pairState };

    const lastCandle = candles[candles.length - 1];
    const currentTickIndex = candles.length;

    // Timeout check: reset setup if stuck in a state for too long
    if (pairState.status !== STATES.IDLE && (currentTickIndex - pairState.lastUpdateCandle) > STATE_TIMEOUT_CANDLES) {
      if (DEBUG_MODE) console.log(`[PS v13] Setup timeout for ${pair}, resetting to IDLE.`);
      pairState = resetState(pair);
    }

    let signal = null;

    // --- State Machine Logic ---
    switch (pairState.status) {

      case STATES.IDLE:
        // Transition: Check for Liquidity Sweeps
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
          signal = hybridSignal;
          pairState = resetState(pair);
          break;
        }

        // Transition: Check for Displacement in opposite direction
        const vDelta = smcData.velocityDelta;
        const correctDirection = (pairState.direction === 'BUY' && vDelta.velocity > 0) ||
                                 (pairState.direction === 'SELL' && vDelta.velocity < 0);
        
        // Use ATR-relative candle size for displacement check
        const atr = smcIndicators.calculateATR(candles, 14);
        const candleRange = lastCandle.h - lastCandle.l;
        const isDisplacement = candleRange > (atr * 1.2); // Lowered from 1.5x to 1.2x

        if (correctDirection && isDisplacement) {
          pairState.status = STATES.DISPLACEMENT;
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons.push('Displacement detected');
        }
        break;

      case STATES.DISPLACEMENT:
        // Transition: Check for CHoCH with high BQI
        const structure = smcData.marketStructure;
        const lastCHoCH = structure.lastCHoCH;
        
        if (lastCHoCH &&
            ((pairState.direction === 'BUY' && lastCHoCH.type === 'BULLISH_CHoCH') ||
             (pairState.direction === 'SELL' && lastCHoCH.type === 'BEARISH_CHoCH'))) {
          
          if (lastCHoCH.bqi >= BQI_THRESHOLD) {
            pairState.status = STATES.CHOCH;
            pairState.lastUpdateCandle = currentTickIndex;
            pairState.reasons.push(`Confirmed CHoCH (BQI: ${lastCHoCH.bqi})`);

            // Store POIs created during displacement/CHoCH
            pairState.setupData.poi = {
              orderBlocks: smcData.orderBlocks,
              imbalance: smcData.imbalance
            };
          }
        }
        break;

      case STATES.CHOCH:
        // Transition: Check for Retest of POI
        const pois = pairState.setupData.poi;
        let isRetesting = false;
        
        if (pairState.direction === 'BUY') {
          const freshOB = pois.orderBlocks.bullishOB.find(ob => !ob.mitigated);
          const freshIMB = pois.imbalance.bullishIMB.find(imb => !imb.mitigated);
          if ((freshOB && lastCandle.l <= freshOB.high) || (freshIMB && lastCandle.l <= freshIMB.top)) {
            isRetesting = true;
          }
        } else {
          const freshOB = pois.orderBlocks.bearishOB.find(ob => !ob.mitigated);
          const freshIMB = pois.imbalance.bearishIMB.find(imb => !imb.mitigated);
          if ((freshOB && lastCandle.h >= freshOB.low) || (freshIMB && lastCandle.h >= freshIMB.bottom)) {
            isRetesting = true;
          }
        }

        if (isRetesting) {
          // Final validation: Market Phase
          // SMC ADAPTIVE: Do NOT block if LIQUIDITY_SWEPT was confirmed (implied by being in CHOCH state)
          // Only block if it's exceptionally dead, but standard CONTRACTION is allowed for sequence retests.
          if (smcData.marketPhase === 'CONTRACTION' && smcData.velocityDelta.delta < 0.00001) {
            if (DEBUG_MODE) console.log(`[PS v13] Sequence complete for ${pair} but rejected due to extreme CONTRACTION.`);
            pairState = resetState(pair);
            break;
          }

          pairState.status = STATES.RETEST;
          pairState.lastUpdateCandle = currentTickIndex;
          pairState.reasons.push('POI Retest (Execution Phase)');

          // GENERATE SIGNAL IMMEDIATELY ON RETEST
          signal = triggerSignal(pairState, candles, smcData);
          // Reset to IDLE after execution to prevent double entries
          pairState = resetState(pair);
        }
        break;
    }

    return { signal, updatedState: pairState };
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
   * Final Signal Assembly
   */
  function triggerSignal(pairState, candles, smcData) {
    const lastPrice = candles[candles.length - 1].c;
    
    // Dynamic Duration Logic
    let tradeDuration = 3;
    if (smcData.marketPhase === 'EXPANSION') tradeDuration = 5;

    return {
      action: pairState.direction,
      confidence: 70, // SMC Prime Sequence completion is hard-coded to 70% target
      reasons: pairState.reasons,
      tradeDuration: tradeDuration,
      durationReason: `SMC Sequence complete (${smcData.marketPhase} phase)`,
      indicatorValues: {
        rawScore: 250, // Legacy support
        marketPhase: smcData.marketPhase,
        velocity: smcData.velocityDelta.velocity
      }
    };
  }

  console.log('[Pocket Scout v13.0] SMC Prime Engine loaded');
  return { generateSignal };

})(window.TechnicalIndicators);
