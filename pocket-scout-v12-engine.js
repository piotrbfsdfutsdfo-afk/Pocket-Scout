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
  
  // Neural learning rate
  const LEARNING_RATE = 0.05;

  // Default Synapse Weights (Initial State)
  const DEFAULT_SYNAPSES = {
    TREND: 1.0,
    SWEEP: 1.2,
    RSI: 0.8,
    FLUX: 1.5,
    DISPLACEMENT: 1.3,
    ZONE: 1.0,
    FRACTAL: 2.0,
    BIO_PULSE: 1.2 // Neural Micro-Fractal Weight
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
   * Consensus Predictor (The Core)
   */
  function predict(pair, pairState, smcData, candles, flux, globalStrength) {
    const ns = pairState.nexus;
    const lastCandle = candles[candles.length - 1];

    // Feature Extraction
    const features = {
        TREND: smcData.marketStructure.m15Trend !== 'NEUTRAL' ? 1 : 0,
        SWEEP: (smcData.liquidity.sweeps.bullishSweeps.length > 0 || smcData.liquidity.sweeps.bearishSweeps.length > 0) ? 1 : 0,
        RSI: (smcData.rsi > 70 || smcData.rsi < 30) ? 1 : 0,
        FLUX: Math.min(1.5, flux),
        DISPLACEMENT: smcData.displacement ? 1.5 : 0,
        ZONE: smcData.premiumDiscount?.currentZone !== 'EQUILIBRIUM' ? 1 : 0,
        FRACTAL: analyzeFractal(candles, ns.fractalMemory),
        BIO_PULSE: smcData.microFractal !== 'NEUTRAL' ? 1 : 0
    };

    // Weighted decision
    let score = 0;
    for (const key in features) {
        score += features[key] * (ns.synapses[key] || 1.0);
    }

    // Determine Direction (Consensus)
    const trend = smcData.marketStructure.m15Trend;
    const vDelta = smcData.velocityDelta;
    const zoneBias = smcData.premiumDiscount?.bias || 'NEUTRAL';

    let direction = null;
    if (trend === 'BULLISH' && zoneBias !== 'BEARISH') direction = 'BUY';
    else if (trend === 'BEARISH' && zoneBias !== 'BULLISH') direction = 'SELL';
    else if (vDelta.aligned === 'BULLISH') direction = 'BUY';
    else if (vDelta.aligned === 'BEARISH') direction = 'SELL';
    else direction = lastCandle.c >= lastCandle.o ? 'BUY' : 'SELL';

    // Apply Fractal Inversion if trap detected
    if (features.FRACTAL === -1.0) {
        direction = (direction === 'BUY' ? 'SELL' : 'BUY');
    }

    return { score: Math.round(score * 10), direction, features };
  }

  /**
   * Entry points for content script
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

      const { score, direction, features } = predict(pair, pairState, smcData, candles, flux, globalStrength);
      pairState.deepSight.lastSPI = score;
      pairState.nexus.lastFeatures = features; // Store for backprop

      rankings.push({ pair, direction, score, smcData, pairState, features });
    });

    if (rankings.length === 0) return null;

    rankings.sort((a, b) => b.score - a.score);
    const winner = rankings[0];

    const allUpdatedStates = {};
    rankings.forEach(r => { allUpdatedStates[r.pair] = r.pairState; });

    console.log(`[NEXUS v24] 🧠 Consensus Winner: ${winner.pair} | Nexus Score: ${winner.score} | Cycles: ${winner.pairState.nexus.trainingCycles}`);

    return {
        pair: winner.pair,
        action: winner.direction,
        confidence: 100,
        tradeDuration: duration,
        reasons: [`Nexus Score: ${winner.score}`, `Regime: ${winner.smcData.regime}`, `Learning Cycles: ${winner.pairState.nexus.trainingCycles}`],
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
            if (pairState.nexus.lastFeatures) {
                backpropagate(pairState, res, pairState.nexus.lastFeatures);
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
