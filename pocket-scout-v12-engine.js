/**
 * Project NEXUS v24.0.0 - Neural Execution & X-Ray Utility System
 * "The final frontier of binary options intelligence."
 * 
 * CORE PRINCIPLES:
 * - Neural Feedback: Real-time weight adjustment based on pair-specific performance.
 * - Fractal X-Ray: Detection of repeating OTC manipulation patterns (Traps).
 * - Consensus Protocol: Triple-model voting (Alpha, Ghost, Pivot).
 */

window.ProjectNexus = (function(indicators) {
  'use strict';

  if (!indicators) {
    console.error("[NEXUS] TechnicalIndicators dependency not found.");
    return null;
  }

  const smcIndicators = window.SmartMoneyIndicators;
  const DEBUG_MODE = false;
  
  // Neural learning rate - increased for v24.3 Omni
  const LEARNING_RATE = 0.12;
  const SHADOW_INVERSION_THRESHOLD = 0.45; // Below this WR, invert signals

  // Default Synapse Weights (Initial State) - Refined for OMNI
  const DEFAULT_SYNAPSES = {
    TREND: 1.5,
    SWEEP: 2.0,
    RSI: 0.5,
    FLUX: 3.5,        // Institutional participation priority
    DISPLACEMENT: 2.5, // Momentum priority
    ZONE: 1.2,
    FRACTAL: 1.5,
    BIO_PULSE: 1.0
  };

  /**
   * Initialize or upgrade pair state to NEXUS architecture
   */
  function initNexusState(pair, existing = null) {
    return {
      nexus: {
        synapses: existing?.nexus?.synapses || { ...DEFAULT_SYNAPSES },
        fractalMemory: existing?.nexus?.fractalMemory || [], // Stores hash of candles + result
        trainingCycles: existing?.nexus?.trainingCycles || 0,
        lastOutcome: null
      },
      deepSight: existing?.deepSight || { shadowTrades: [], virtualHistory: [], winRate: 0, lastSPI: 0 },
      lastSignalTimestamp: existing?.lastSignalTimestamp || 0
    };
  }

  /**
   * Neural Backpropagation (Learning)
   * Adjusts synapse weights based on signal outcome.
   */
  function backpropagate(pairState, outcome, features) {
    if (!pairState.nexus) return;

    const ns = pairState.nexus;
    const isWin = outcome === 'WIN';
    const multiplier = isWin ? 1 : -1;

    // Adjust each synapse based on its contribution to the decision
    for (const key in ns.synapses) {
        if (features[key] > 0) {
            // Reinforce if won, penalize if lost
            ns.synapses[key] += LEARNING_RATE * multiplier * features[key];
            // Clamp to avoid extreme values
            ns.synapses[key] = Math.max(0.1, Math.min(5.0, ns.synapses[key]));
        }
    }

    ns.trainingCycles++;
    ns.lastOutcome = outcome;
  }

  /**
   * Fractal X-Ray: Detect repeating OTC patterns
   */
  function analyzeFractal(candles, fractalMemory) {
    if (candles.length < 3) return 0;

    // Create a simple hash of the last 3 candles (HL patterns)
    const last3 = candles.slice(-3);
    const hash = last3.map(c => (c.c > c.o ? 'B' : 'S')).join('');

    // Find in memory
    const history = fractalMemory.filter(m => m.hash === hash);
    if (history.length === 0) return 0;

    const wins = history.filter(h => h.outcome === 'WIN').length;
    const wr = wins / history.length;

    // Returns a score: 1.0 if high prob, -1.0 if trap detected
    if (wr > 0.7) return 1.0;
    if (wr < 0.3) return -1.0;
    return 0;
  }

  /**
   * Consensus Predictor (The Core) - Refined for NEXUS OMNI
   */
  function predict(pair, pairState, smcData, candles, flux, globalStrength) {
    const ns = pairState.nexus;
    const ds = pairState.deepSight;
    const lastCandle = candles[candles.length - 1];
    const structure = smcData.marketStructure;
    const liquidity = smcData.liquidity;
    const zone = smcData.premiumDiscount;

    // Calculate Inversion Status (Ghost Mode)
    const shadowWR = ds.virtualHistory.length >= 5 ?
                     (ds.virtualHistory.filter(h => h === 'WIN').length / ds.virtualHistory.length) : 0.5;
    const isInverted = shadowWR < SHADOW_INVERSION_THRESHOLD && ds.virtualHistory.length >= 5;

    // Confluence Factors
    const hasSweep = liquidity.sweeps.bullishSweeps.length > 0 || liquidity.sweeps.bearishSweeps.length > 0 || !!liquidity.sfp;
    const isExhausted = smcData.rsi > 70 || smcData.rsi < 30 || smcData.stoch.k > 80 || smcData.stoch.k < 20;

    // Feature Extraction for Neural Layer
    const features = {
        TREND: structure.m15Trend !== 'NEUTRAL' ? 1.5 : 0,
        SWEEP: hasSweep ? 2.0 : 0,
        RSI: isExhausted ? 0.5 : 0,
        FLUX: Math.min(2.0, flux * 1.5),
        DISPLACEMENT: smcData.displacement ? 2.0 : 0,
        ZONE: zone?.currentZone !== 'EQUILIBRIUM' ? 1.0 : 0,
        FRACTAL: analyzeFractal(candles, ns.fractalMemory),
        BIO_PULSE: smcData.microFractal !== 'NEUTRAL' ? 1.0 : 0
    };

    // Neural Confidence Component
    let neuralSum = 0;
    for (const key in features) {
        neuralSum += features[key] * (ns.synapses[key] || 1.0);
    }

    // Core Logic (Setup Ranking)
    let bullishScore = 0;
    let bearishScore = 0;

    // 1. Institutional Flux & Displacement (HEAVY WEIGHT for OMNI)
    if (flux > 1.2) {
        if (lastCandle.c > lastCandle.o) bullishScore += 6;
        else bearishScore += 6;
    }
    if (smcData.displacement) {
        if (smcData.displacement.type === 'BULLISH') bullishScore += 5;
        else bearishScore += 5;
    }

    // 2. Liquidity Grab (SFP/Sweep)
    if (liquidity.sfp?.type === 'BULLISH_SFP') bullishScore += 5;
    if (liquidity.sfp?.type === 'BEARISH_SFP') bearishScore += 5;

    // 3. Structure & Zone
    if (structure.trend === 'BULLISH' && zone?.bias !== 'BEARISH') bullishScore += 4;
    if (structure.trend === 'BEARISH' && zone?.bias !== 'BULLISH') bearishScore += 4;

    // Final Setup Probability (0-100)
    let direction = bullishScore >= bearishScore ? 'BUY' : 'SELL';
    let rawScore = Math.max(bullishScore, bearishScore);

    // Model Decision
    if (isInverted) {
        direction = direction === 'BUY' ? 'SELL' : 'BUY';
    }

    // Fractal Check (Final Filter/Inversion)
    if (features.FRACTAL === -1.0) {
        direction = direction === 'BUY' ? 'SELL' : 'BUY';
    }

    // Normalize Confidence: Base Confluence + Neural Multiplier
    // Target 50-100% range for signals
    const confidence = Math.min(100, 50 + Math.round(rawScore * 2) + Math.round(neuralSum));

    return { score: confidence, direction, features, modelStatus: isInverted ? 'GHOST_INVERSION' : 'SMC_STANDARD' };
  }

  /**
   * Entry points for content script - Global Snapshot Omni Version
   */
  function processSnapshot(allPairsData, duration, globalStrength) {
    const pairs = Object.keys(allPairsData);
    const rankings = [];

    pairs.forEach(pair => {
      let { candles, pairState, flux } = allPairsData[pair];

      if (!pairState || !pairState.nexus) {
          pairState = initNexusState(pair, pairState);
      }

      const smcData = smcIndicators.analyzeSmartMoney(candles, pair);
      if (!smcData) return;

      const { score, direction, features, modelStatus } = predict(pair, pairState, smcData, candles, flux, globalStrength);
      pairState.deepSight.lastSPI = score;
      pairState.nexus.lastFeatures = features;
      pairState.nexus.lastModelStatus = modelStatus;

      // Fractal pattern for memory
      const last3 = candles.slice(-3).map(c => (c.c > c.o ? 'B' : 'S')).join('');

      // Create Shadow Trade for learning (all pairs get one every snapshot)
      pairState.deepSight.shadowTrades.push({
          direction: direction,
          startPrice: candles[candles.length - 1].c,
          expiry: Date.now() + (duration * 60 * 1000),
          pattern: last3,
          features: { ...features }
      });

      rankings.push({ pair, direction, score, smcData, pairState, features, modelStatus });
    });

    if (rankings.length === 0) return null;

    // Relative Global Ranking: Always pick the absolute best pair
    rankings.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;

        // Tie-breaker: Global Currency Strength
        const aPairParts = a.pair.replace('_OTC', '').split('/');
        const bPairParts = b.pair.replace('_OTC', '').split('/');
        if (aPairParts.length === 2 && bPairParts.length === 2) {
            const aStrength = (globalStrength[aPairParts[0]] || 0) - (globalStrength[aPairParts[1]] || 0);
            const bStrength = (globalStrength[bPairParts[0]] || 0) - (globalStrength[bPairParts[1]] || 0);
            return Math.abs(bStrength) - Math.abs(aStrength); // Prefer pair with stronger directional bias
        }
        return 0;
    });
    const winner = rankings[0];

    const allUpdatedStates = {};
    rankings.forEach(r => {
        // Limit shadow trades to 10 per pair to prevent memory bloat
        if (r.pairState.deepSight.shadowTrades.length > 10) {
            r.pairState.deepSight.shadowTrades.shift();
        }
        allUpdatedStates[r.pair] = r.pairState;
    });

    console.log(`[NEXUS OMNI] 🧠 Global Snapshot Winner: ${winner.pair} | Conf: ${winner.score}% | Mode: ${winner.modelStatus}`);

    const smc = winner.smcData;
    const reasons = [
        `Conf: ${winner.score}% | Mode: ${winner.modelStatus}`,
        `Flux: ${smc.velocityDelta.aligned} | Regime: ${smc.regime}`,
        `ADX: ${Math.round(smc.adx)} | Stoch: ${Math.round(smc.stoch.k)}`,
        `Liq: ${smc.liquidity.sfp ? 'SFP detected' : (smc.liquidity.sweeps.bullishSweeps.length > 0 ? 'Sweep' : 'Clean')}`
    ];

    return {
        pair: winner.pair,
        action: winner.direction,
        confidence: winner.score,
        tradeDuration: duration,
        reasons: reasons,
        indicatorValues: { spi: winner.score, cycles: winner.pairState.nexus.trainingCycles },
        allUpdatedStates: allUpdatedStates
    };
  }

  function sync(pair, pairState, price) {
    if (!pairState || !pairState.nexus) {
      pairState = initNexusState(pair, pairState);
    }
    // Deep Sight v4 integration for shadow testing
    // (Logic moved here for simplicity)
    const ds = pairState.deepSight;
    const unresolved = [];
    ds.shadowTrades.forEach(trade => {
        if (Date.now() >= trade.expiry) {
            const isWin = (trade.direction === 'BUY' && price > trade.startPrice) ||
                          (trade.direction === 'SELL' && price < trade.startPrice);
            const res = isWin ? 'WIN' : 'LOSS';
            ds.virtualHistory.push(res);
            if (ds.virtualHistory.length > 20) ds.virtualHistory.shift();

            // NEXUS Learning: Backpropagate from shadow outcome
            if (trade.features) {
                backpropagate(pairState, res, trade.features);
            }

            // Store fractal result
            const last3 = trade.pattern;
            if (last3) {
                pairState.nexus.fractalMemory.push({ hash: last3, outcome: res });
                if (pairState.nexus.fractalMemory.length > 50) pairState.nexus.fractalMemory.shift();
            }
        } else {
            unresolved.push(trade);
        }
    });
    ds.shadowTrades = unresolved;
    return pairState;
  }

  console.log('[Project NEXUS v24.0] Neural Engine Online');
  return {
      processMarketSnapshot: processSnapshot,
      syncOracle: sync,
      train: backpropagate,
      init: initNexusState
  };

})(window.TechnicalIndicators);
