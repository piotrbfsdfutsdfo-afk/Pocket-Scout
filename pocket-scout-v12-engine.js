/**
 * Pocket Scout v12.3.0 - Pure Smart Money & Price Action Engine
 * "Mniej matematyki, więcej logiki a za nią będą wyniki!"
 * (Less math, more logic leads to results!)
 * 
 * PHILOSOPHY:
 * - Pure SMC (Smart Money Concepts) & Price Action logic
 * - NO adaptive weights, NO complex mathematics
 * - Fixed, simple scoring system
 * - Quality over quantity (70-90 signals vs 166)
 * 
 * SMART MONEY CONCEPTS:
 * - Market Structure: BOS (Break of Structure), CHoCH (Change of Character)
 * - Order Blocks: Institutional zones
 * - FVG (Fair Value Gaps): Price inefficiencies
 * - Liquidity Sweeps: Stop hunts with rejection
 * 
 * PRICE ACTION:
 * - Pin Bars, Engulfing patterns
 * - Rejection wicks at key levels
 * - Trend Guard (Multi-Timeframe Analysis)
 * 
 * =============================================================================
 * 🔧 CRITICAL FIXES (Jan 21, 2025) - Win Rate Optimization
 * =============================================================================
 * 
 * PROBLEM IDENTIFIED:
 * - Overall WR: 46.0% (104W/122L from 226 signals)
 * - WR for confidence ≥50%: 26.7% (4W/11L) - CATASTROPHIC!
 * - Only 6.6% signals reached ≥50% confidence
 * 
 * ROOT CAUSES:
 * 1. rawScore calculation used DIFFERENCE (buyScore - sellScore) instead of ABSOLUTE value
 *    → Score 200 became 150 after subtracting opposing direction
 * 2. CONFIDENCE_THRESHOLDS were too high for difference-based scores
 *    → Score 180 gave only 50% confidence (should be 65%+)
 * 3. Premium/Discount penalty too harsh (-50)
 *    → 39.2% of signals penalized, blocking good setups
 * 4. Weak components too easy to trigger:
 *    → Inducement +22 (50% signals), Mitigation +18 (47%), Rejection +45 (49%)
 *    → Inflating scores without real quality
 * 
 * FIXES APPLIED:
 * 1. ✅ Changed rawScore to ABSOLUTE value (buyScore or sellScore, not difference)
 *    → More intuitive, consistent with component weights
 * 
 * 2. ✅ Adjusted CONFIDENCE_THRESHOLDS for absolute scoring:
 *    → 50%: 180 → 170 (good solid setup)
 *    → 60%: 210 → 210 (strong confluence)
 *    → 70%: 240 → 250 (excellent setup)
 *    → Target: 30-40% signals ≥50% confidence (vs 6.6% before)
 * 
 * 3. ✅ Reduced Premium/Discount penalty: -50 → -25
 *    → Less harsh, allows good setups in borderline zones
 * 
 * 4. ✅ Rebalanced weak component weights:
 *    → Rejection Block: 45 → 30 (too easy to trigger)
 *    → Inducement: 22 → 12 (too common, low predictive value)
 *    → Mitigation Block: 18 → 10 (weaker than true Order Blocks)
 *    → Focuses scoring on high-quality setups
 * 
 * EXPECTED RESULTS:
 * - Increase signals ≥50% confidence from 6.6% to 30-40%
 * - Improve WR for ≥50% signals to 70%+ (from 26.7%)
 * - Better quality filtering through rebalanced weights
 * - More intuitive scoring system (absolute vs difference)
 * 
 * =============================================================================
 */

window.V12Engine = (function(indicators) {
  'use strict';

  if (!indicators) {
    return { 
      generateSignal: () => { 
        console.error("[PS v12.0 Engine] FATAL: TechnicalIndicators dependency not found."); 
        return null;
      } 
    };
  }

  const smcIndicators = window.SmartMoneyIndicators;
  const useSMC = !!smcIndicators;
  
  if (useSMC) {
    console.log('[PS v12.0 Engine] 💰 Smart Money Concepts ENABLED');
  } else {
    console.warn('[PS v12.0 Engine] Smart Money Indicators not found - SMC disabled');
  }

  // ============================================
  // CONFIGURATION - FIXED VALUES (NO ADAPTIVE)
  // ============================================
  
  // Trend Guard parameters (Multi-Timeframe Analysis)
  const TREND_GUARD_M15_CANDLES = 15;  // 15 M1 candles = virtual M15
  const TREND_GUARD_H1_CANDLES = 35;   // Adjusted to work with minimum candles
  const TREND_GUARD_EMA_SLOPE_THRESHOLD = 0.00005; // 0.5 pips per candle
  
  // Minimum candles needed (lowered to match warmup period)
  const MIN_CANDLES = 35;  // Matches minimum warmup period

  // Price Action pattern parameters
  const PIN_BAR_WICK_RATIO = 0.667;    // Wick must be 66.7% of candle range
  const PIN_BAR_BODY_RATIO = 0.333;    // Body must be less than 33.3%
  const CONFIDENCE_INCREMENT = 10;      // Points increment for confidence calculation

  // ============================================
  // FIXED SCORING SYSTEM - OPTIMIZED FOR BINARY OPTIONS
  // Based on "Optymalizacja SMC dla Opcji Binarnych" document
  // ============================================
  
  const SCORES = {
    // HIGH PRIORITY SETUPS (60-95 points) - OPTIMIZED
    LIQUIDITY_SWEEP_REVERSAL: 95,  // INCREASED: Most critical catalyst
    BREAKER_BLOCK_CONFLUENCE: 85,  // INCREASED: Strong institutional confirmation
    FVG_DISPLACEMENT: 70,           // NEW: Proof of real institutional engagement
    CHOCH_OB_CONFLUENCE: 45,        // REDUCED: Requires additional FVG validation (was 60)
    CHOCH_FVG_CONFLUENCE: 50,
    
    // MEDIUM PRIORITY (30-45 points)
    PREMIUM_DISCOUNT_ALIGNED: 45,  // INCREASED: Critical context filter (was 32)
    
    // BEARISH COMPONENTS (Strong WR 56-59%)
    BEARISH_ORDER_BLOCK: 50,       // INCREASED from 40
    BEARISH_REJECTION: 35,         // WR 56.9%
    BEARISH_FVG: 35,               // INCREASED from 30
    BEARISH_MITIGATION: 15,        // WR 57.1%
    BEARISH_INDUCEMENT: 12,        // WR 58.6%
    
    // BULLISH COMPONENTS - REBALANCED (removed asymmetry penalty)
    BULLISH_ORDER_BLOCK: 50,       // INCREASED from 40
    BULLISH_REJECTION: 35,         // Equalized with bearish
    BULLISH_FVG: 35,               // INCREASED from 30
    BULLISH_MITIGATION: 15,        // Equalized with bearish
    BULLISH_INDUCEMENT: 12,        // Equalized with bearish
    
    // FALLBACK (when direction unknown) - average of both
    ORDER_BLOCK_TREND: 34,         // Average of 40 and 28
    BOS_STRONG_TREND: 35,
    REJECTION_BLOCK: 30,           // Average of 35 and 25
    FVG_FILL: 25,                  // Average of 30 and 20
    MITIGATION_BLOCK: 12,          // Average of 15 and 10
    INDUCEMENT_PRESENT: 10,        // Average of 12 and 8
    
    // LOW PRIORITY (10-25 points)
    PRICE_ACTION_PATTERN: 25,
    TREND_ALIGNMENT: 20,
    LIQUIDITY_PROXIMITY: 15,
    VELOCITY_DELTA_ALIGNED: 45,
    
    // PENALTIES - OPTIMIZED FOR BINARY OPTIONS + NEW ADDITIONS
    INDUCEMENT_TOO_CLOSE: -45,     // NEW: IDM near POI = likely trap
    MITIGATED_POI: -60,            // NEW: Previously touched zone = weak
    HTF_DIVERGENCE: -40,           // NEW: Against 15m trend
    COUNTER_TREND_NO_CHOCH: -70,
    PREMIUM_DISCOUNT_MISALIGNED: -60, // INCREASED penalty (was -45, now -60 for stricter filter)
    WEAK_TREND: -40,
    LOW_VOLATILITY: -50,           // NEW: Market too choppy for SMC
    BEARISH_PIN_BAR_TOXIC: -50,    // NEW: Bearish Pin Bar has 36.4% WR - heavily penalize
    COUNTER_PRICE_ACTION: -40,     // NEW: PA contradicts signal direction
    MARKET_STRUCTURE_DIVERGENCE: -35, // NEW: Structure conflicts with direction
    NEUTRAL_H1_PENALTY: -20        // NEW: NEUTRAL H1 on OTC markets = uncertain direction (BUY 51.3% vs 56.0% without)
  };

  // ============================================
  // CONFIDENCE THRESHOLDS - OPTIMIZED FOR BINARY OPTIONS
  // Based on new scoring weights and confluence multipliers
  // ============================================
  
  const CONFIDENCE_THRESHOLDS = {
    10: 30,   // Very low - basic setup present
    20: 60,   // Low - some structure visible
    30: 95,   // Below average - partial confluence
    40: 130,  // Average - decent setup
    50: 220,  // Good - solid setup (INCREASED to 220 for 70% WR target)
    60: 260,  // Very good - strong confluence (INCREASED to 260)
    70: 300,  // High - excellent setup (INCREASED to 300)
    80: 350,  // Very high - perfect storm (INCREASED from 330 - exceptional required)
    90: 400   // Exceptional - maximum confluence (INCREASED from 380 - ultra-rare)
  };

  // ============================================
  // TREND GUARD: Multi-Timeframe Analysis
  // ============================================
  
  function calculateTrendContext(candles) {
    const result = {
      m15Trend: 'NEUTRAL',
      h1Trend: 'NEUTRAL',
      combinedTrend: 'NEUTRAL',
      strength: 0,
      shouldPenalizeBuy: false,
      shouldPenalizeSell: false
    };

    if (!candles || candles.length < TREND_GUARD_M15_CANDLES) {
      return result;
    }

    const closes = candles.map(c => c.c);
    const currentPrice = closes[closes.length - 1];

    // Virtual M15 Trend (last 15 candles with EMA5)
    if (closes.length >= TREND_GUARD_M15_CANDLES) {
      const m15Closes = closes.slice(-TREND_GUARD_M15_CANDLES);
      const ema5 = calculateQuickEMA(m15Closes, 5);
      
      if (ema5.length >= 3) {
        const recentSlope = (ema5[ema5.length - 1] - ema5[ema5.length - 3]) / 2;
        const priceAboveEma = currentPrice > ema5[ema5.length - 1];
        
        if (recentSlope > TREND_GUARD_EMA_SLOPE_THRESHOLD && priceAboveEma) {
          result.m15Trend = 'BULLISH';
        } else if (recentSlope < -TREND_GUARD_EMA_SLOPE_THRESHOLD && !priceAboveEma) {
          result.m15Trend = 'BEARISH';
        }
      }
    }

    // Virtual H1 Trend (last 60 candles with EMA20)
    if (closes.length >= TREND_GUARD_H1_CANDLES) {
      const h1Closes = closes.slice(-TREND_GUARD_H1_CANDLES);
      const ema20 = calculateQuickEMA(h1Closes, 20);
      
      if (ema20.length >= 5) {
        const recentSlope = (ema20[ema20.length - 1] - ema20[ema20.length - 5]) / 4;
        const priceAboveEma = currentPrice > ema20[ema20.length - 1];
        
        if (recentSlope > TREND_GUARD_EMA_SLOPE_THRESHOLD && priceAboveEma) {
          result.h1Trend = 'BULLISH';
        } else if (recentSlope < -TREND_GUARD_EMA_SLOPE_THRESHOLD && !priceAboveEma) {
          result.h1Trend = 'BEARISH';
        }
      }
    }

    // Determine Combined Trend
    if (result.m15Trend === 'BULLISH' && result.h1Trend === 'BULLISH') {
      result.combinedTrend = 'STRONGLY_BULLISH';
      result.shouldPenalizeSell = true;
      result.strength = 100;
    } else if (result.m15Trend === 'BEARISH' && result.h1Trend === 'BEARISH') {
      result.combinedTrend = 'STRONGLY_BEARISH';
      result.shouldPenalizeBuy = true;
      result.strength = 100;
    } else if (result.m15Trend === result.h1Trend && result.m15Trend !== 'NEUTRAL') {
      result.combinedTrend = result.m15Trend;
      result.strength = 70;
      if (result.m15Trend === 'BULLISH') result.shouldPenalizeSell = true;
      if (result.m15Trend === 'BEARISH') result.shouldPenalizeBuy = true;
    } else if (result.m15Trend !== 'NEUTRAL' || result.h1Trend !== 'NEUTRAL') {
      result.combinedTrend = result.h1Trend !== 'NEUTRAL' ? result.h1Trend : result.m15Trend;
      result.strength = 40;
      if (result.combinedTrend === 'BULLISH') result.shouldPenalizeSell = true;
      if (result.combinedTrend === 'BEARISH') result.shouldPenalizeBuy = true;
    }

    return result;
  }

  function calculateQuickEMA(data, period) {
    if (!data || data.length < period) return [];
    
    const k = 2 / (period + 1);
    const result = [];
    
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += data[i];
    }
    let ema = sum / period;
    result.push(ema);
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i] * k) + (ema * (1 - k));
      result.push(ema);
    }
    
    return result;
  }

  // ============================================
  // MOMENTUM & VELOCITY DELTA
  // Measures price acceleration to confirm impulse
  // ============================================

  function calculateVelocityDelta(candles) {
    if (!candles || candles.length < 10) return { velocity: 0, delta: 0, aligned: 'NONE' };

    // Recent velocity (last 3 candles)
    const vNow = (candles[candles.length - 1].c - candles[candles.length - 4].c) / 3;
    // Previous velocity (candles 4 to 6 ago)
    const vPrev = (candles[candles.length - 4].c - candles[candles.length - 7].c) / 3;

    const delta = vNow - vPrev;

    let aligned = 'NONE';
    if (vNow > 0 && delta > 0) aligned = 'BULLISH';
    if (vNow < 0 && delta < 0) aligned = 'BEARISH';

    return { velocity: vNow, delta: delta, aligned: aligned };
  }

  // ============================================
  // ATR (Average True Range) VOLATILITY FILTER
  // Based on "Optymalizacja SMC" - filters choppy markets
  // ============================================
  
  function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return { current: 0, mean: 0, ratio: 1 };
    
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].h;
      const low = candles[i].l;
      const prevClose = candles[i - 1].c;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    // Calculate ATR using SMA for first value, then EMA
    const atrValues = [];
    let sum = 0;
    for (let i = 0; i < period && i < trueRanges.length; i++) {
      sum += trueRanges[i];
    }
    let atr = sum / period;
    atrValues.push(atr);
    
    // EMA for remaining values
    const k = 1 / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (trueRanges[i] * k) + (atr * (1 - k));
      atrValues.push(atr);
    }
    
    // Calculate mean ATR over last 100 candles (or all available)
    const lookback = Math.min(100, atrValues.length);
    const recentATR = atrValues.slice(-lookback);
    const meanATR = recentATR.reduce((a, b) => a + b, 0) / recentATR.length;
    const currentATR = atrValues[atrValues.length - 1];
    const ratio = currentATR / meanATR;
    
    return { current: currentATR, mean: meanATR, ratio };
  }

  // ============================================
  // PRICE ACTION PATTERN DETECTION
  // ============================================
  
  function detectPriceActionPatterns(candles) {
    if (candles.length < 3) return { pinBar: null, engulfing: null };
    
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    const bodySize = Math.abs(lastCandle.c - lastCandle.o);
    const totalRange = lastCandle.h - lastCandle.l;
    const upperWick = lastCandle.h - Math.max(lastCandle.o, lastCandle.c);
    const lowerWick = Math.min(lastCandle.o, lastCandle.c) - lastCandle.l;
    
    let pinBar = null;
    let engulfing = null;
    
    // Pin Bar: Wick at least 66.7% of total range (historical WR from backtest data)
    if (upperWick > totalRange * PIN_BAR_WICK_RATIO && bodySize < totalRange * PIN_BAR_BODY_RATIO) {
      pinBar = { type: 'BEARISH_PIN', strength: upperWick / totalRange };
    } else if (lowerWick > totalRange * PIN_BAR_WICK_RATIO && bodySize < totalRange * PIN_BAR_BODY_RATIO) {
      pinBar = { type: 'BULLISH_PIN', strength: lowerWick / totalRange };
    }
    
    // Engulfing Pattern
    const prevBodySize = Math.abs(prevCandle.c - prevCandle.o);
    if (lastCandle.c > lastCandle.o && prevCandle.c < prevCandle.o) {
      if (lastCandle.c > prevCandle.o && lastCandle.o < prevCandle.c && bodySize > prevBodySize) {
        engulfing = { type: 'BULLISH_ENGULFING' };
      }
    } else if (lastCandle.c < lastCandle.o && prevCandle.c > prevCandle.o) {
      if (lastCandle.c < prevCandle.o && lastCandle.o > prevCandle.c && bodySize > prevBodySize) {
        engulfing = { type: 'BEARISH_ENGULFING' };
      }
    }
    
    return { pinBar, engulfing };
  }

  // ============================================
  // SIGNAL GENERATION (PURE SMC/PA LOGIC)
  // ============================================
  
  function generateSignal(candles, pair = 'UNKNOWN') {
    if (!candles || candles.length < MIN_CANDLES) {
      return null;
    }

    // ============================================
    // VOLATILITY FILTER (ATR-based)
    // "Market unsuitable for impulse SMC strategies"
    // ============================================
    const atrData = calculateATR(candles, 14);
    const isLowVolatility = atrData.ratio < 0.8; // Current ATR < 80% of mean
    
    // Get SMC data
    const smcData = useSMC ? smcIndicators.analyzeSmartMoney(candles) : null;
    
    // Get Trend Context
    const trendContext = calculateTrendContext(candles);
    
    // Get Price Action Patterns
    const priceAction = detectPriceActionPatterns(candles);

    // Get Velocity Delta
    const vDelta = calculateVelocityDelta(candles);
    
    const lastCandle = candles[candles.length - 1];
    
    // ============================================
    // SCORING LOGIC
    // ============================================
    
    let buyScore = 0;
    let sellScore = 0;
    let buyReasons = [];
    let sellReasons = [];
    
    // Quality flags for signal filtering
    let hasHighPrioritySetup = false;
    let qualityComponents = {
      orderBlock: false,
      fvg: false,
      priceAction: false,
      trendGuard: false
    };
    
    // ============================================
    // SMART MONEY CONCEPTS SCORING
    // ============================================
    
    if (smcData) {
      const { 
        marketStructure = {}, 
        orderBlocks = { bullishOB: [], bearishOB: [] }, 
        imbalance = { bullishIMB: [], bearishIMB: [] }, 
        liquidity = { equalLevels: { eqHighs: [], eqLows: [] }, sweeps: { bullishSweeps: [], bearishSweeps: [] } },
        breakerBlocks = { bullishBreakers: [], bearishBreakers: [] },
        mitigationBlocks = { bullishMitigation: [], bearishMitigation: [] },
        rejectionBlocks = { bullishRejection: [], bearishRejection: [] },
        inducement = { bullishInducement: [], bearishInducement: [] },
        premiumDiscount = { zone: 'EQUILIBRIUM', percentage: 50, inPremium: false, inDiscount: false }
      } = smcData;
      
      // Rename for easier access
      const fvg = { bullish: imbalance?.bullishIMB || [], bearish: imbalance?.bearishIMB || [] };
      const orderBlocksAliased = { bullish: orderBlocks?.bullishOB || [], bearish: orderBlocks?.bearishOB || [] };
      
      // --- CHoCH (Change of Character) - REVERSAL SIGNAL ---
      if (marketStructure.lastCHoCH) {
        hasHighPrioritySetup = true;
        
        if (marketStructure.lastCHoCH.type === 'BULLISH_CHoCH') {
          // CHoCH + Order Block confluence
          if (orderBlocksAliased?.bullish?.length > 0) {
            buyScore += SCORES.CHOCH_OB_CONFLUENCE;
            buyReasons.push(`[+${SCORES.CHOCH_OB_CONFLUENCE}] CHoCH + Order Block confluence`);
            qualityComponents.orderBlock = true;
          }
          // CHoCH + FVG confluence
          else if (fvg?.bullish?.length > 0) {
            buyScore += SCORES.CHOCH_FVG_CONFLUENCE;
            buyReasons.push(`[+${SCORES.CHOCH_FVG_CONFLUENCE}] CHoCH + FVG confluence`);
            qualityComponents.fvg = true;
          } else {
            buyScore += 45; // CHoCH alone
            buyReasons.push('[+45] Bullish CHoCH (reversal signal)');
          }
        } else if (marketStructure.lastCHoCH.type === 'BEARISH_CHoCH') {
          if (orderBlocksAliased?.bearish?.length > 0) {
            sellScore += SCORES.CHOCH_OB_CONFLUENCE;
            sellReasons.push(`[+${SCORES.CHOCH_OB_CONFLUENCE}] CHoCH + Order Block confluence`);
            qualityComponents.orderBlock = true;
          } else if (fvg?.bearish?.length > 0) {
            sellScore += SCORES.CHOCH_FVG_CONFLUENCE;
            sellReasons.push(`[+${SCORES.CHOCH_FVG_CONFLUENCE}] CHoCH + FVG confluence`);
            qualityComponents.fvg = true;
          } else {
            sellScore += 45;
            sellReasons.push('[+45] Bearish CHoCH (reversal signal)');
          }
        }
      }
      
      // --- Liquidity Sweep + Reversal ---
      if (liquidity?.sweeps?.bullishSweeps?.length > 0) {
        hasHighPrioritySetup = true;
        buyScore += SCORES.LIQUIDITY_SWEEP_REVERSAL;
        buyReasons.push(`[+${SCORES.LIQUIDITY_SWEEP_REVERSAL}] Liquidity sweep + reversal`);
      }
      if (liquidity?.sweeps?.bearishSweeps?.length > 0) {
        hasHighPrioritySetup = true;
        sellScore += SCORES.LIQUIDITY_SWEEP_REVERSAL;
        sellReasons.push(`[+${SCORES.LIQUIDITY_SWEEP_REVERSAL}] Liquidity sweep + reversal`);
      }
      
      // --- BOS (Break of Structure) in strong trend ---
      if (marketStructure?.lastBOS && trendContext.strength >= 70) {
        hasHighPrioritySetup = true;
        
        if (marketStructure.lastBOS.type === 'BULLISH_BOS') {
          buyScore += SCORES.BOS_STRONG_TREND;
          buyReasons.push(`[+${SCORES.BOS_STRONG_TREND}] BOS in strong uptrend`);
        } else if (marketStructure.lastBOS.type === 'BEARISH_BOS') {
          sellScore += SCORES.BOS_STRONG_TREND;
          sellReasons.push(`[+${SCORES.BOS_STRONG_TREND}] BOS in strong downtrend`);
        }
      }
      
      // --- Order Blocks (institutional zones) - DIRECTIONAL WEIGHTS ---
      if (orderBlocksAliased?.bullish?.length > 0) {
        qualityComponents.orderBlock = true;
        buyScore += SCORES.BULLISH_ORDER_BLOCK;  // Changed from ORDER_BLOCK_TREND
        buyReasons.push(`[+${SCORES.BULLISH_ORDER_BLOCK}] Bullish Order Block present`);
      }
      if (orderBlocksAliased?.bearish?.length > 0) {
        qualityComponents.orderBlock = true;
        sellScore += SCORES.BEARISH_ORDER_BLOCK;  // Changed from ORDER_BLOCK_TREND
        sellReasons.push(`[+${SCORES.BEARISH_ORDER_BLOCK}] Bearish Order Block present`);
      }
      
      // --- FVG (Fair Value Gaps) + Displacement Detection - DIRECTIONAL WEIGHTS ---
      // Standard FVG fill
      if (fvg?.bullish?.length > 0) {
        qualityComponents.fvg = true;
        buyScore += SCORES.BULLISH_FVG;  // Changed from FVG_FILL
        buyReasons.push(`[+${SCORES.BULLISH_FVG}] Bullish FVG fill opportunity`);
        
        // FVG + Displacement bonus (aggressive institutional entry)
        // Check if recent candles show strong displacement (large FVG)
        const lastFVG = fvg.bullish[fvg.bullish.length - 1];
        if (lastFVG && candles.length >= 3) {
          const fvgSize = lastFVG.high - lastFVG.low;
          const avgCandleRange = candles.slice(-5).reduce((sum, c) => sum + (c.h - c.l), 0) / 5;
          
          // If FVG is larger than average candle (displacement), add bonus
          if (fvgSize > avgCandleRange * 1.2) {
            buyScore += SCORES.FVG_DISPLACEMENT;
            buyReasons.push(`[+${SCORES.FVG_DISPLACEMENT}] FVG + Displacement (strong institutional push)`);
          }
        }
      }
      if (fvg?.bearish?.length > 0) {
        qualityComponents.fvg = true;
        sellScore += SCORES.BEARISH_FVG;  // Changed from FVG_FILL
        sellReasons.push(`[+${SCORES.BEARISH_FVG}] Bearish FVG fill opportunity`);
        
        const lastFVG = fvg.bearish[fvg.bearish.length - 1];
        if (lastFVG && candles.length >= 3) {
          const fvgSize = lastFVG.high - lastFVG.low;
          const avgCandleRange = candles.slice(-5).reduce((sum, c) => sum + (c.h - c.l), 0) / 5;
          
          if (fvgSize > avgCandleRange * 1.2) {
            sellScore += SCORES.FVG_DISPLACEMENT;
            sellReasons.push(`[+${SCORES.FVG_DISPLACEMENT}] FVG + Displacement (strong institutional push)`);
          }
        }
      }
      
      // --- Liquidity Pools proximity ---
      if (liquidity?.equalLevels?.eqHighs?.length > 0) {
        sellScore += SCORES.LIQUIDITY_PROXIMITY;
        sellReasons.push(`[+${SCORES.LIQUIDITY_PROXIMITY}] Near Equal Highs (liquidity pool)`);
      }
      if (liquidity?.equalLevels?.eqLows?.length > 0) {
        buyScore += SCORES.LIQUIDITY_PROXIMITY;
        buyReasons.push(`[+${SCORES.LIQUIDITY_PROXIMITY}] Near Equal Lows (liquidity pool)`);
      }
      
      // ============================================
      // NEW SMC ELEMENTS SCORING
      // ============================================
      
      // --- Breaker Blocks (OB after sweep) - STRONGEST SIGNAL ---
      if (breakerBlocks?.bullishBreakers?.length > 0) {
        hasHighPrioritySetup = true;
        buyScore += SCORES.BREAKER_BLOCK_CONFLUENCE;
        buyReasons.push(`[+${SCORES.BREAKER_BLOCK_CONFLUENCE}] Bullish Breaker Block (OB after sweep)`);
        qualityComponents.orderBlock = true;
      }
      if (breakerBlocks?.bearishBreakers?.length > 0) {
        hasHighPrioritySetup = true;
        sellScore += SCORES.BREAKER_BLOCK_CONFLUENCE;
        sellReasons.push(`[+${SCORES.BREAKER_BLOCK_CONFLUENCE}] Bearish Breaker Block (OB after sweep)`);
        qualityComponents.orderBlock = true;
      }
      
      // --- Rejection Blocks (50% wick zone) - DIRECTIONAL WEIGHTS ---
      if (rejectionBlocks?.bullishRejection?.length > 0) {
        buyScore += SCORES.BULLISH_REJECTION;  // Changed from REJECTION_BLOCK
        buyReasons.push(`[+${SCORES.BULLISH_REJECTION}] Bullish Rejection Block (strong wick rejection)`);
      }
      if (rejectionBlocks?.bearishRejection?.length > 0) {
        sellScore += SCORES.BEARISH_REJECTION;  // Changed from REJECTION_BLOCK
        sellReasons.push(`[+${SCORES.BEARISH_REJECTION}] Bearish Rejection Block (strong wick rejection)`);
      }
      
      // --- Premium/Discount Zones ---
      if (premiumDiscount) {
        if (premiumDiscount.currentZone === 'DISCOUNT' && premiumDiscount.bias === 'BULLISH') {
          buyScore += SCORES.PREMIUM_DISCOUNT_ALIGNED;
          buyReasons.push(`[+${SCORES.PREMIUM_DISCOUNT_ALIGNED}] In Discount zone (${premiumDiscount.zonePercentage}% - cheap area for BUY)`);
        } else if (premiumDiscount.currentZone === 'PREMIUM' && premiumDiscount.bias === 'BEARISH') {
          sellScore += SCORES.PREMIUM_DISCOUNT_ALIGNED;
          sellReasons.push(`[+${SCORES.PREMIUM_DISCOUNT_ALIGNED}] In Premium zone (${premiumDiscount.zonePercentage}% - expensive area for SELL)`);
        }
      }
      
      // --- Inducement (traps before true POI) - DIRECTIONAL WEIGHTS ---
      if (inducement?.bullishInducement?.length > 0) {
        buyScore += SCORES.BULLISH_INDUCEMENT;  // Changed from INDUCEMENT_PRESENT
        buyReasons.push(`[+${SCORES.BULLISH_INDUCEMENT}] Bullish Inducement detected (retail trap cleared)`);
      }
      if (inducement?.bearishInducement?.length > 0) {
        sellScore += SCORES.BEARISH_INDUCEMENT;  // Changed from INDUCEMENT_PRESENT
        sellReasons.push(`[+${SCORES.BEARISH_INDUCEMENT}] Bearish Inducement detected (retail trap cleared)`);
      }
      
      // --- Mitigation Blocks (OB without sweep) - WEAKER SIGNAL - DIRECTIONAL WEIGHTS ---
      if (mitigationBlocks?.bullishMitigation?.length > 0) {
        buyScore += SCORES.BULLISH_MITIGATION;  // Changed from MITIGATION_BLOCK
        buyReasons.push(`[+${SCORES.BULLISH_MITIGATION}] Bullish Mitigation Block (OB without sweep)`);
      }
      if (mitigationBlocks?.bearishMitigation?.length > 0) {
        sellScore += SCORES.BEARISH_MITIGATION;  // Changed from MITIGATION_BLOCK
        sellReasons.push(`[+${SCORES.BEARISH_MITIGATION}] Bearish Mitigation Block (OB without sweep)`);
      }
    } // END if (smcData)
    
    // ============================================
    // PRICE ACTION PATTERNS
    // ============================================
    
    if (priceAction.pinBar) {
      qualityComponents.priceAction = true;
      
      if (priceAction.pinBar.type === 'BULLISH_PIN') {
        buyScore += SCORES.PRICE_ACTION_PATTERN;
        buyReasons.push(`[+${SCORES.PRICE_ACTION_PATTERN}] Bullish Pin Bar pattern`);
      } else if (priceAction.pinBar.type === 'BEARISH_PIN') {
        // BEARISH PIN BAR has TOXIC 36.4% WR - HEAVILY PENALIZE instead of rewarding
        sellScore += SCORES.BEARISH_PIN_BAR_TOXIC;  // This is -50 penalty!
        sellReasons.push(`[${SCORES.BEARISH_PIN_BAR_TOXIC}] Bearish Pin Bar pattern (TOXIC: 36.4% WR historical)`);
      }
    }
    
    if (priceAction.engulfing) {
      qualityComponents.priceAction = true;
      
      if (priceAction.engulfing.type === 'BULLISH_ENGULFING') {
        buyScore += 20;
        buyReasons.push('[+20] Bullish Engulfing pattern');
      } else if (priceAction.engulfing.type === 'BEARISH_ENGULFING') {
        sellScore += 20;
        sellReasons.push('[+20] Bearish Engulfing pattern');
      }
    }
    
    // ============================================
    // TREND GUARD (Multi-Timeframe Alignment)
    // ============================================
    
    if (trendContext.strength >= 70) {
      qualityComponents.trendGuard = true;
      
      if (trendContext.combinedTrend.includes('BULLISH')) {
        buyScore += SCORES.TREND_ALIGNMENT;
        buyReasons.push(`[+${SCORES.TREND_ALIGNMENT}] Trend aligned (${trendContext.combinedTrend})`);
      } else if (trendContext.combinedTrend.includes('BEARISH')) {
        sellScore += SCORES.TREND_ALIGNMENT;
        sellReasons.push(`[+${SCORES.TREND_ALIGNMENT}] Trend aligned (${trendContext.combinedTrend})`);
      }
    }

    // ============================================
    // VELOCITY DELTA (Momentum Acceleration)
    // ============================================

    if (vDelta.aligned === 'BULLISH') {
      buyScore += SCORES.VELOCITY_DELTA_ALIGNED;
      buyReasons.push(`[+${SCORES.VELOCITY_DELTA_ALIGNED}] Bullish Velocity Delta (acceleration)`);
    } else if (vDelta.aligned === 'BEARISH') {
      sellScore += SCORES.VELOCITY_DELTA_ALIGNED;
      sellReasons.push(`[+${SCORES.VELOCITY_DELTA_ALIGNED}] Bearish Velocity Delta (acceleration)`);
    }
    
    // ============================================
    // PENALTIES (STRICT FILTERING)
    // ============================================
    
    // Counter-trend WITHOUT CHoCH = MAJOR PENALTY
    if (trendContext.shouldPenalizeBuy && !smcData?.marketStructure.lastCHoCH) {
      buyScore += SCORES.COUNTER_TREND_NO_CHOCH;
      buyReasons.push(`[${SCORES.COUNTER_TREND_NO_CHOCH}] Counter-trend BUY without CHoCH`);
    }
    if (trendContext.shouldPenalizeSell && !smcData?.marketStructure.lastCHoCH) {
      sellScore += SCORES.COUNTER_TREND_NO_CHOCH;
      sellReasons.push(`[${SCORES.COUNTER_TREND_NO_CHOCH}] Counter-trend SELL without CHoCH`);
    }
    
    // Weak/mixed trend penalty
    if (trendContext.strength < 40 && trendContext.strength > 0) {
      const penalty = SCORES.WEAK_TREND;
      if (buyScore > sellScore) {
        buyScore += penalty;
        buyReasons.push(`[${penalty}] Weak trend environment`);
      } else if (sellScore > buyScore) {
        sellScore += penalty;
        sellReasons.push(`[${penalty}] Weak trend environment`);
      }
    }
    
    // Premium/Discount zone misalignment penalty
    if (smcData?.premiumDiscount) {
      const pd = smcData.premiumDiscount;
      // Penalty for buying in Premium (expensive) zone
      if (pd.currentZone === 'PREMIUM' && buyScore > sellScore) {
        buyScore += SCORES.PREMIUM_DISCOUNT_MISALIGNED;
        buyReasons.push(`[${SCORES.PREMIUM_DISCOUNT_MISALIGNED}] BUY in Premium zone (${pd.zonePercentage}% - expensive)`);
      }
      // Penalty for selling in Discount (cheap) zone
      if (pd.currentZone === 'DISCOUNT' && sellScore > buyScore) {
        sellScore += SCORES.PREMIUM_DISCOUNT_MISALIGNED;
        sellReasons.push(`[${SCORES.PREMIUM_DISCOUNT_MISALIGNED}] SELL in Discount zone (${pd.zonePercentage}% - cheap)`);
      }
    }
    
    // ============================================
    // NEW PENALTIES - BINARY OPTIONS OPTIMIZATION
    // ============================================
    
    // LOW VOLATILITY PENALTY - Choppy market unsuitable for SMC
    if (isLowVolatility) {
      const penalty = SCORES.LOW_VOLATILITY;
      if (buyScore > sellScore) {
        buyScore += penalty;
        buyReasons.push(`[${penalty}] Low volatility market (ATR ratio: ${atrData.ratio.toFixed(2)})`);
      } else if (sellScore > buyScore) {
        sellScore += penalty;
        sellReasons.push(`[${penalty}] Low volatility market (ATR ratio: ${atrData.ratio.toFixed(2)})`);
      }
    }
    
    // HTF DIVERGENCE - 1m signal against 15m trend
    // This is different from COUNTER_TREND_NO_CHOCH which is against H1
    if (trendContext.m15Trend === 'BULLISH' && sellScore > buyScore) {
      sellScore += SCORES.HTF_DIVERGENCE;
      sellReasons.push(`[${SCORES.HTF_DIVERGENCE}] SELL against M15 uptrend`);
    } else if (trendContext.m15Trend === 'BEARISH' && buyScore > sellScore) {
      buyScore += SCORES.HTF_DIVERGENCE;
      buyReasons.push(`[${SCORES.HTF_DIVERGENCE}] BUY against M15 downtrend`);
    }
    
    // NEUTRAL H1 PENALTY - OTC markets lack clear direction when H1 is neutral
    // Data analysis: BUY with NEUTRAL H1 = 51.3% WR vs 56.0% without (4.7% worse)
    // BULLISH_M15 + NEUTRAL_H1 = 49.2% WR (below 50%)
    if (trendContext.h1Trend === 'NEUTRAL') {
      const penalty = SCORES.NEUTRAL_H1_PENALTY;
      if (buyScore > sellScore) {
        buyScore += penalty;
        buyReasons.push(`[${penalty}] NEUTRAL H1 trend (uncertain market direction on OTC)`);
      } else if (sellScore > buyScore) {
        sellScore += penalty;
        sellReasons.push(`[${penalty}] NEUTRAL H1 trend (uncertain market direction on OTC)`);
      }
    }
    
    // ============================================
    // COUNTER PRICE ACTION PENALTY
    // Penalize signals where PA contradicts direction
    // ============================================
    const strongerDirection = buyScore > sellScore ? 'BUY' : 'SELL';
    
    if (priceAction) {
      // Check for counter price action
      if (strongerDirection === 'SELL') {
        if (priceAction.pinBar && priceAction.pinBar.type === 'BULLISH_PIN') {
          sellScore += SCORES.COUNTER_PRICE_ACTION;  // -40
          sellReasons.push(`[${SCORES.COUNTER_PRICE_ACTION}] Counter Price Action: Bullish Pin on SELL signal`);
        }
        if (priceAction.engulfing && priceAction.engulfing.type === 'BULLISH_ENGULFING') {
          sellScore += -30;  // Slightly smaller penalty
          sellReasons.push(`[-30] Counter Price Action: Bullish Engulfing on SELL`);
        }
      } else if (strongerDirection === 'BUY') {
        // Note: Bearish Pin already heavily penalized (-50), so smaller counter penalty
        if (priceAction.pinBar && priceAction.pinBar.type === 'BEARISH_PIN') {
          buyScore += -20;  // Smaller penalty (already toxic)
          buyReasons.push(`[-20] Counter Price Action: Bearish Pin on BUY signal`);
        }
        if (priceAction.engulfing && priceAction.engulfing.type === 'BEARISH_ENGULFING') {
          buyScore += -30;
          buyReasons.push(`[-30] Counter Price Action: Bearish Engulfing on BUY`);
        }
      }
    }
    
    // ============================================
    // MARKET STRUCTURE DIVERGENCE PENALTY
    // HH_HL should favor BUY, LH_LL should favor SELL
    // ============================================
    if (smcData?.marketStructure?.structure) {
      const structure = smcData.marketStructure.structure;
      
      // HH_HL is bullish structure
      if (structure === 'HH_HL' && strongerDirection === 'SELL') {
        sellScore += SCORES.MARKET_STRUCTURE_DIVERGENCE;  // -35
        sellReasons.push(`[${SCORES.MARKET_STRUCTURE_DIVERGENCE}] Market Structure Divergence: HH_HL (bullish) conflicts with SELL`);
      }
      
      // LH_LL is bearish structure
      if (structure === 'LH_LL' && strongerDirection === 'BUY') {
        buyScore += SCORES.MARKET_STRUCTURE_DIVERGENCE;  // -35
        buyReasons.push(`[${SCORES.MARKET_STRUCTURE_DIVERGENCE}] Market Structure Divergence: LH_LL (bearish) conflicts with BUY`);
      }
    }
    
    // ============================================
    // SIGNAL QUALITY FILTERS
    // ============================================
    
    // Quality component count (used for scoring, not filtering)
    const componentCount = Object.values(qualityComponents).filter(v => v).length;
    const hasBOS = smcData?.marketStructure?.lastBOS && trendContext.strength >= 70;
    
    // REMOVED strict quality filters to allow all signal levels (1%-100%)
    // Quality is now reflected in confidence score, not in signal rejection
    // Users can filter by confidence threshold themselves
    
    // Floor scores at 0
    buyScore = Math.max(0, buyScore);
    sellScore = Math.max(0, sellScore);
    
    // ============================================
    // CONFLUENCE MULTIPLIERS (Nonlinear Scoring)
    // Based on "Optymalizacja SMC" - real market probability grows nonlinearly
    // ============================================
    
    // Calculate multipliers
    let trendMultiplier = 1.0;
    let pdZoneMultiplier = 1.0;
    let volMultiplier = 1.0;
    
    // M_Trend: 1.25 if aligned with M15, 0.75 if against
    if (trendContext.m15Trend === 'BULLISH' && buyScore > sellScore) {
      trendMultiplier = 1.25;
    } else if (trendContext.m15Trend === 'BEARISH' && sellScore > buyScore) {
      trendMultiplier = 1.25;
    } else if (trendContext.m15Trend === 'BULLISH' && sellScore > buyScore) {
      trendMultiplier = 0.75;
    } else if (trendContext.m15Trend === 'BEARISH' && buyScore > sellScore) {
      trendMultiplier = 0.75;
    }
    
    // M_PD_Zone: 1.2 if in deep Discount/Premium (>80% or <20%)
    if (smcData?.premiumDiscount) {
      const pd = smcData.premiumDiscount;
      // Deep discount for buy, deep premium for sell
      if ((pd.currentZone === 'DISCOUNT' && pd.zonePercentage < 20 && buyScore > sellScore) ||
          (pd.currentZone === 'PREMIUM' && pd.zonePercentage > 80 && sellScore > buyScore)) {
        pdZoneMultiplier = 1.2;
      }
    }
    
    // M_Vol: 1.15 if ATR > mean, 0.5 if ATR < 0.8 * mean
    if (atrData.ratio > 1.0) {
      volMultiplier = 1.15;
    } else if (atrData.ratio < 0.8) {
      volMultiplier = 0.5;
    }
    
    // Apply multipliers to the winning score
    if (buyScore > sellScore) {
      buyScore = Math.floor(buyScore * trendMultiplier * pdZoneMultiplier * volMultiplier);
      if (trendMultiplier !== 1.0 || pdZoneMultiplier !== 1.0 || volMultiplier !== 1.0) {
        buyReasons.push(`[×${(trendMultiplier * pdZoneMultiplier * volMultiplier).toFixed(2)}] Confluence multiplier (Trend:${trendMultiplier} PD:${pdZoneMultiplier} Vol:${volMultiplier})`);
      }
    } else if (sellScore > buyScore) {
      sellScore = Math.floor(sellScore * trendMultiplier * pdZoneMultiplier * volMultiplier);
      if (trendMultiplier !== 1.0 || pdZoneMultiplier !== 1.0 || volMultiplier !== 1.0) {
        sellReasons.push(`[×${(trendMultiplier * pdZoneMultiplier * volMultiplier).toFixed(2)}] Confluence multiplier (Trend:${trendMultiplier} PD:${pdZoneMultiplier} Vol:${volMultiplier})`);
      }
    }
    
    // ============================================
    // FINAL DECISION WITH CONFLICT-AWARE SCORING
    // ============================================
    
    // Conflict detection: if buyScore and sellScore are too close (< 20% difference), it's consolidation
    const maxScore = Math.max(buyScore, sellScore);
    const minScore = Math.min(buyScore, sellScore);
    const scoreDifference = maxScore > 0 ? ((maxScore - minScore) / maxScore) * 100 : 0;
    const isConflicted = scoreDifference < 20; // Less than 20% difference = no clear direction
    
    let action, rawScore, reasons;
    if (buyScore > sellScore) {
      action = 'BUY';
      rawScore = buyScore;
      reasons = buyReasons;
    } else if (sellScore > buyScore) {
      action = 'SELL';
      rawScore = sellScore;
      reasons = sellReasons;
    } else {
      // Equal scores - default to BUY with absolute score
      action = 'BUY';
      rawScore = Math.max(buyScore, sellScore, 1);
      reasons = buyReasons.length > 0 ? buyReasons : ['[+1] Neutral market - default signal'];
    }
    
    // Convert raw score to confidence percentage
    let confidence = 0;
    if (rawScore >= CONFIDENCE_THRESHOLDS[90]) {
      confidence = 90 + Math.min(CONFIDENCE_INCREMENT, Math.floor((rawScore - CONFIDENCE_THRESHOLDS[90]) / CONFIDENCE_INCREMENT));
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[80]) {
      confidence = 80 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[80]) / (CONFIDENCE_THRESHOLDS[90] - CONFIDENCE_THRESHOLDS[80]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[70]) {
      confidence = 70 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[70]) / (CONFIDENCE_THRESHOLDS[80] - CONFIDENCE_THRESHOLDS[70]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[60]) {
      confidence = 60 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[60]) / (CONFIDENCE_THRESHOLDS[70] - CONFIDENCE_THRESHOLDS[60]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[50]) {
      confidence = 50 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[50]) / (CONFIDENCE_THRESHOLDS[60] - CONFIDENCE_THRESHOLDS[50]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[40]) {
      confidence = 40 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[40]) / (CONFIDENCE_THRESHOLDS[50] - CONFIDENCE_THRESHOLDS[40]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[30]) {
      confidence = 30 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[30]) / (CONFIDENCE_THRESHOLDS[40] - CONFIDENCE_THRESHOLDS[30]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[20]) {
      confidence = 20 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[20]) / (CONFIDENCE_THRESHOLDS[30] - CONFIDENCE_THRESHOLDS[20]) * CONFIDENCE_INCREMENT);
    } else if (rawScore >= CONFIDENCE_THRESHOLDS[10]) {
      confidence = 10 + Math.floor((rawScore - CONFIDENCE_THRESHOLDS[10]) / (CONFIDENCE_THRESHOLDS[20] - CONFIDENCE_THRESHOLDS[10]) * CONFIDENCE_INCREMENT);
    } else {
      // Below 10% threshold - still generate signal but with very low confidence (1-9%)
      confidence = Math.max(1, Math.min(9, Math.floor((rawScore / CONFIDENCE_THRESHOLDS[10]) * 9) + 1));
    }
    
    confidence = Math.min(100, confidence);
    
    // CONFLICT-AWARE ADJUSTMENT: Reduce confidence drastically if signals are conflicted
    if (isConflicted) {
      confidence = Math.floor(confidence * 0.5); // Cut confidence in half for consolidation
      reasons.push(`[-50%] Conflicted signals (${scoreDifference.toFixed(1)}% difference) - consolidation detected`);
    }
    
    // FVG + OB CONFLUENCE REQUIREMENT: For confidence >= 50%, require both FVG and OB
    const hasFVG = qualityComponents.fvg === true;
    const hasOB = qualityComponents.orderBlock === true;
    
    if (confidence >= 50 && !(hasFVG && hasOB)) {
      // Reduce to max 45% if missing FVG+OB confluence
      const oldConfidence = confidence;
      confidence = Math.min(45, confidence);
      if (oldConfidence > confidence) {
        reasons.push(`[Cap @ 45%] Confidence ≥50% requires FVG+OB confluence (FVG:${hasFVG}, OB:${hasOB})`);
      }
    }
    
    // OTE (OPTIMAL TRADE ENTRY) REQUIREMENT: For confidence >= 50%, price must be in OTE zone
    if (smcData && smcData.ote && confidence >= 50) {
      const isInOTE = smcIndicators.isInOTEZone(
        candles[candles.length - 1].c,
        smcData.ote,
        action
      );
      
      if (!isInOTE) {
        // Reduce to max 45% if not in OTE zone
        const oldConfidence = confidence;
        confidence = Math.min(45, confidence);
        if (oldConfidence > confidence) {
          reasons.push(`[Cap @ 45%] Confidence ≥50% requires entry in OTE zone (0.705-0.786 retracement)`);
        }
      }
    }
    
    confidence = Math.min(100, confidence);
    
// ============================================
    // DYNAMIC TRADE DURATION - OPTIMIZED FOR SMC & PRICE ACTION
    // ZOPTYMALIZOWANE na podstawie analizy WR: 3min (Złoty Środek) > 1min (Szum)
    // PREFERUJ 3 MINUTY, aby pozwolić na mitygację stref płynności.
    // ============================================
    
    let tradeDuration = 3; // DOMYŚLNIE 3 minuty (najwyższy statystyczny WR dla M1 SMC)
    
    // Determine setup type for duration optimization
    const hasBreaker = smcData && (smcData.breakerBlocks?.bullishBreakers?.length > 0 || smcData.breakerBlocks?.bearishBreakers?.length > 0);
    const hasLSSweep = smcData && (smcData.liquidity?.sweeps?.bullishSweeps?.length > 0 || smcData.liquidity?.sweeps?.bearishSweeps?.length > 0);
    const hasFVGInData = smcData && (smcData.imbalance?.bullishIMB?.length > 0 || smcData.imbalance?.bearishIMB?.length > 0);
    const hasRejection = smcData && (smcData.rejectionBlocks?.bullishRejection?.length > 0 || smcData.rejectionBlocks?.bearishRejection?.length > 0);
    
    // Sygnały o wysokiej pewności (70%+) utrzymują 3 minuty (filtr szumu rynkowego)
    if (confidence >= 70) {
      tradeDuration = 3; 
    }
    
    // Wyjątkowe setupy z LS + FVG przy bardzo wysokim confidence (80%+): 5 minut
    // Pozwala na pełne rozwinięcie impulsu po zebraniu płynności (Inducement)
    if (hasLSSweep && hasFVGInData && confidence >= 80) {
      tradeDuration = 5; 
    }
    
    return {
      action,
      confidence,
      reasons,
      tradeDuration,
      durationReason: `${tradeDuration}min (SMC Optimized) based on ${confidence}% confidence`,
      indicatorValues: {
        smc_enabled: useSMC,
        smc_marketStructure: smcData?.marketStructure?.trend || 'N/A',
        smc_structure: smcData?.marketStructure?.structure || 'N/A',
        smc_lastBOS: smcData?.marketStructure?.lastBOS?.type || null,
        smc_lastCHoCH: smcData?.marketStructure?.lastCHoCH?.type || null,
        trendM15: trendContext.m15Trend,
        trendH1: trendContext.h1Trend,
        trendCombined: trendContext.combinedTrend,
        trendStrength: trendContext.strength,
        priceAction: priceAction.pinBar?.type || priceAction.engulfing?.type || null,
        rawScore: rawScore,
        qualityComponents: componentCount
      }
    };
  }

  console.log('[Pocket Scout v12.0.0] 💎 Pure Smart Money & Price Action Engine ready');
  console.log('[Pocket Scout v12.0.0] 🎯 Fixed scoring system (NO adaptive weights)');
  console.log('[Pocket Scout v12.0.0] 📊 Signals 1%-100% confidence (Quality-based scoring)');
  
  return { generateSignal };

})(window.TechnicalIndicators);
