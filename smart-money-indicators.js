/**
 * Pocket Scout Smart Money & Price Action Indicators
 * Version 11.0.0
 * 
 * This module implements Smart Money Concepts (SMC) detection:
 * - Market Structure: BOS (Break of Structure), CHoCH (Change of Character)
 * - Swing Points: Higher High/Low, Lower High/Low
 * - Liquidity: EQH/EQL (Equal Highs/Lows), Liquidity Pools, Sweeps
 * - Order Blocks: Last bullish/bearish move before reversal
 * - Imbalance/FVG: Fair Value Gaps (price inefficiencies)
 * - Breaker Blocks: Structure break zones that flip polarity
 */

window.SmartMoneyIndicators = (function() {
  'use strict';

  const SMC_CONFIG = {
    // Swing point detection
    SWING_LOOKBACK: 3,           // Minimum 3 candles for swing detection
    EQUAL_LEVEL_TOLERANCE: 0.0002, // 2 pips tolerance for EQH/EQL
    
    // Liquidity
    LIQUIDITY_LOOKBACK: 20,      // Look back 20 candles for significant levels
    SWEEP_WICK_RATIO: 0.6,       // Wick must be 60% of total candle range for sweep
    
    // Order Blocks
    OB_STRENGTH_THRESHOLD: 0.0005, // 5 pips minimum for significant OB
    
    // Imbalance/FVG
    IMB_MIN_GAP: 0.0003,         // 3 pips minimum gap for FVG
    
    // Market Structure
    BOS_CONFIRMATION_CANDLES: 1,  // Candles needed to confirm BOS/CHoCH
    
    // Breaker & Mitigation Blocks
    BREAKER_LOOKBACK: 10,        // Candles to check for liquidity sweep before OB
    
    // Rejection Blocks
    REJECTION_WICK_THRESHOLD: 0.5, // Minimum 50% wick for rejection
    
    // Inducement
    INDUCEMENT_LOOKBACK: 5,      // Candles to look for inducement patterns
    INDUCEMENT_SIZE_RATIO: 0.3,  // Inducement should be smaller than main move
    INDUCEMENT_SWING_LOOKBACK: 2, // Smaller lookback for inducement swing detection
    INDUCEMENT_MOVE_MULTIPLIER: 3.33, // Move after must be 3.33x larger than swing (1/0.3)
    
    // Premium/Discount Zones
    PREMIUM_THRESHOLD: 0.75,     // 75% of range = Premium zone
    DISCOUNT_THRESHOLD: 0.25,    // 25% of range = Discount zone
    EQUILIBRIUM: 0.5             // 50% of range = Equilibrium
  };

  /**
   * Identify Swing Highs and Swing Lows
   * Swing High: Middle candle has higher high than neighbors
   * Swing Low: Middle candle has lower low than neighbors
   */
  function findSwingPoints(candles, lookback = SMC_CONFIG.SWING_LOOKBACK) {
    if (candles.length < lookback * 2 + 1) return { swingHighs: [], swingLows: [] };

    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      let isSwingHigh = true;
      let isSwingLow = true;

      // Check neighbors
      for (let j = 1; j <= lookback; j++) {
        const left = candles[i - j];
        const right = candles[i + j];

        if (current.h <= left.h || current.h <= right.h) {
          isSwingHigh = false;
        }
        if (current.l >= left.l || current.l >= right.l) {
          isSwingLow = false;
        }
      }

      if (isSwingHigh) {
        swingHighs.push({ index: i, price: current.h, time: current.t });
      }
      if (isSwingLow) {
        swingLows.push({ index: i, price: current.l, time: current.t });
      }
    }

    return { swingHighs, swingLows };
  }

  /**
   * Detect Market Structure: BOS (Break of Structure) and CHoCH (Change of Character)
   * BOS: Price breaks previous swing in same trend direction
   * CHoCH: Price breaks counter-trend swing (potential reversal)
   */
  function detectMarketStructure(candles) {
    const { swingHighs, swingLows } = findSwingPoints(candles);
    
    if (swingHighs.length < 2 || swingLows.length < 2) {
      return {
        trend: 'RANGING',
        lastBOS: null,
        lastCHoCH: null,
        structure: 'NEUTRAL'
      };
    }

    const lastCandle = candles[candles.length - 1];
    
    // Analyze recent structure
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);
    
    // Determine trend based on swing structure
    let trend = 'RANGING';
    let structure = 'NEUTRAL';
    
    if (recentHighs.length >= 2 && recentLows.length >= 2) {
      const highsRising = recentHighs[recentHighs.length - 1].price > recentHighs[0].price;
      const lowsRising = recentLows[recentLows.length - 1].price > recentLows[0].price;
      const highsFalling = recentHighs[recentHighs.length - 1].price < recentHighs[0].price;
      const lowsFalling = recentLows[recentLows.length - 1].price < recentLows[0].price;
      
      if (highsRising && lowsRising) {
        trend = 'BULLISH';
        structure = 'HH_HL'; // Higher Highs, Higher Lows
      } else if (highsFalling && lowsFalling) {
        trend = 'BEARISH';
        structure = 'LH_LL'; // Lower Highs, Lower Lows
      }
    }

    // Detect BOS/CHoCH
    let lastBOS = null;
    let lastCHoCH = null;
    
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    const lastSwingLow = swingLows[swingLows.length - 1];
    
    // BOS: Breaking structure in trend direction
    if (trend === 'BULLISH' && lastCandle.c > lastSwingHigh.price) {
      lastBOS = { type: 'BULLISH_BOS', price: lastSwingHigh.price, time: lastCandle.t };
    } else if (trend === 'BEARISH' && lastCandle.c < lastSwingLow.price) {
      lastBOS = { type: 'BEARISH_BOS', price: lastSwingLow.price, time: lastCandle.t };
    }
    
    // CHoCH: Breaking structure against trend (reversal signal)
    if (trend === 'BULLISH' && lastCandle.c < lastSwingLow.price) {
      lastCHoCH = { type: 'BEARISH_CHoCH', price: lastSwingLow.price, time: lastCandle.t };
    } else if (trend === 'BEARISH' && lastCandle.c > lastSwingHigh.price) {
      lastCHoCH = { type: 'BULLISH_CHoCH', price: lastSwingHigh.price, time: lastCandle.t };
    }

    return { trend, structure, lastBOS, lastCHoCH, swingHighs, swingLows };
  }

  /**
   * Detect Equal Highs/Lows (EQH/EQL)
   * These are double tops/bottoms where liquidity pools form
   */
  function detectEqualLevels(candles, lookback = SMC_CONFIG.LIQUIDITY_LOOKBACK) {
    const { swingHighs, swingLows } = findSwingPoints(candles);
    const tolerance = SMC_CONFIG.EQUAL_LEVEL_TOLERANCE;
    
    const eqHighs = [];
    const eqLows = [];
    
    // Find equal highs
    for (let i = 1; i < swingHighs.length; i++) {
      const current = swingHighs[i];
      const previous = swingHighs[i - 1];
      const priceDiff = Math.abs(current.price - previous.price);
      const avgPrice = (current.price + previous.price) / 2;
      
      if (priceDiff / avgPrice < tolerance) {
        eqHighs.push({
          price: avgPrice,
          count: 2,
          time: current.time,
          type: 'EQH'
        });
      }
    }
    
    // Find equal lows
    for (let i = 1; i < swingLows.length; i++) {
      const current = swingLows[i];
      const previous = swingLows[i - 1];
      const priceDiff = Math.abs(current.price - previous.price);
      const avgPrice = (current.price + previous.price) / 2;
      
      if (priceDiff / avgPrice < tolerance) {
        eqLows.push({
          price: avgPrice,
          count: 2,
          time: current.time,
          type: 'EQL'
        });
      }
    }
    
    return { eqHighs, eqLows };
  }

  /**
   * Calculate Average True Range (ATR) for dynamic volatility-based thresholds
   * Used for making SWEEP_WICK_RATIO adaptive
   */
  function calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return null;

    const recentCandles = candles.slice(-(period + 1));
    let trSum = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i];
      const previous = recentCandles[i - 1];
      
      const high_low = current.h - current.l;
      const high_close = Math.abs(current.h - previous.c);
      const low_close = Math.abs(current.l - previous.c);
      
      const tr = Math.max(high_low, high_close, low_close);
      trSum += tr;
    }

    return trSum / period;
  }

  /**
   * Get dynamic sweep wick ratio based on ATR
   * Higher volatility = allow lower wick ratio
   * Minimum threshold of 0.4 as specified
   */
  function getDynamicSweepWickRatio(candles) {
    const atr = calculateATR(candles, 14);
    if (!atr || candles.length === 0) {
      return SMC_CONFIG.SWEEP_WICK_RATIO; // Fallback to static
    }

    const lastCandle = candles[candles.length - 1];
    const avgPrice = (lastCandle.h + lastCandle.l) / 2;
    const atrPercent = (atr / avgPrice) * 100;

    // Dynamic ratio based on volatility
    // High volatility (>0.1%): 0.4 (minimum allowed)
    // Medium volatility (0.05-0.1%): 0.5
    // Low volatility (<0.05%): 0.6 (default)
    
    if (atrPercent > 0.1) {
      return 0.4; // High volatility - more lenient
    } else if (atrPercent > 0.05) {
      return 0.5; // Medium volatility
    } else {
      return 0.6; // Low volatility - strict
    }
  }

  /**
   * Detect Liquidity Sweeps/Stop Hunts
   * Identified by wicks that pierce levels but close back inside
   * Now uses dynamic wick ratio based on ATR (minimum 0.4)
   */
  function detectLiquiditySweeps(candles, lookback = 5) {
    if (candles.length < lookback + 1) return { bullishSweeps: [], bearishSweeps: [] };
    
    const recentCandles = candles.slice(-lookback - 1);
    const lastCandle = recentCandles[recentCandles.length - 1];
    const previousCandles = recentCandles.slice(0, -1);
    
    const bullishSweeps = [];
    const bearishSweeps = [];
    
    // Find recent significant highs/lows
    const recentHigh = Math.max(...previousCandles.map(c => c.h));
    const recentLow = Math.min(...previousCandles.map(c => c.l));
    
    // Use dynamic wick ratio based on ATR (minimum 0.4)
    const wickRatio = getDynamicSweepWickRatio(candles);
    const totalRange = lastCandle.h - lastCandle.l;
    const bodyRange = Math.abs(lastCandle.c - lastCandle.o);
    const upperWick = lastCandle.h - Math.max(lastCandle.c, lastCandle.o);
    const lowerWick = Math.min(lastCandle.c, lastCandle.o) - lastCandle.l;
    
    // Bearish sweep: Upper wick pierces recent high but closes below
    if (lastCandle.h > recentHigh && lastCandle.c < recentHigh) {
      if (upperWick / totalRange > wickRatio) {
        bearishSweeps.push({
          price: lastCandle.h,
          sweptLevel: recentHigh,
          time: lastCandle.t,
          strength: upperWick / totalRange
        });
      }
    }
    
    // Bullish sweep: Lower wick pierces recent low but closes above
    if (lastCandle.l < recentLow && lastCandle.c > recentLow) {
      if (lowerWick / totalRange > wickRatio) {
        bullishSweeps.push({
          price: lastCandle.l,
          sweptLevel: recentLow,
          time: lastCandle.t,
          strength: lowerWick / totalRange
        });
      }
    }
    
    return { bullishSweeps, bearishSweeps };
  }

  /**
   * Detect Order Blocks
   * Last opposite-colored candle before strong impulsive move
   */
  function detectOrderBlocks(candles, lookback = 10) {
    if (candles.length < lookback) return { bullishOB: [], bearishOB: [] };
    
    const bullishOB = [];
    const bearishOB = [];
    const recentCandles = candles.slice(-lookback);
    
    for (let i = 1; i < recentCandles.length - 1; i++) {
      const prev = recentCandles[i - 1];
      const current = recentCandles[i];
      const next = recentCandles[i + 1];
      
      const currentBullish = current.c > current.o;
      const currentBearish = current.c < current.o;
      const nextBullish = next.c > next.o;
      const nextBearish = next.c < next.o;
      
      const nextRange = Math.abs(next.c - next.o);
      const currentRange = Math.abs(current.c - current.o);
      
      // Bullish OB: Bearish candle followed by strong bullish move
      if (currentBearish && nextBullish && nextRange > currentRange * 1.5) {
        bullishOB.push({
          high: current.h,
          low: current.l,
          time: current.t,
          strength: nextRange / currentRange
        });
      }
      
      // Bearish OB: Bullish candle followed by strong bearish move
      if (currentBullish && nextBearish && nextRange > currentRange * 1.5) {
        bearishOB.push({
          high: current.h,
          low: current.l,
          time: current.t,
          strength: nextRange / currentRange
        });
      }
    }
    
    return { bullishOB, bearishOB };
  }

  /**
   * Detect Imbalance/Fair Value Gaps (FVG)
   * Three-candle pattern with gap between first and third candle
   */
  function detectImbalance(candles, lookback = 10) {
    if (candles.length < 3) return { bullishIMB: [], bearishIMB: [] };
    
    const bullishIMB = [];
    const bearishIMB = [];
    const recentCandles = candles.slice(-Math.min(lookback, candles.length));
    
    for (let i = 0; i < recentCandles.length - 2; i++) {
      const first = recentCandles[i];
      const second = recentCandles[i + 1];
      const third = recentCandles[i + 2];
      
      // Bullish Imbalance: Gap between first high and third low (upward move)
      const bullishGap = third.l - first.h;
      if (bullishGap > 0 && bullishGap > SMC_CONFIG.IMB_MIN_GAP) {
        bullishIMB.push({
          top: third.l,
          bottom: first.h,
          gap: bullishGap,
          time: second.t,
          filled: false
        });
      }
      
      // Bearish Imbalance: Gap between first low and third high (downward move)
      const bearishGap = first.l - third.h;
      if (bearishGap > 0 && bearishGap > SMC_CONFIG.IMB_MIN_GAP) {
        bearishIMB.push({
          top: first.l,
          bottom: third.h,
          gap: bearishGap,
          time: second.t,
          filled: false
        });
      }
    }
    
    return { bullishIMB, bearishIMB };
  }

  /**
   * Detect Breaker Blocks
   * Order Block that was hit AFTER a liquidity sweep occurred
   * These are stronger signals - manipulation confirmed
   */
  function detectBreakerBlocks(candles, orderBlocks, sweeps, lookback = SMC_CONFIG.BREAKER_LOOKBACK) {
    if (!candles || candles.length < lookback) return { bullishBreakers: [], bearishBreakers: [] };
    
    const bullishBreakers = [];
    const bearishBreakers = [];
    
    // Check each Order Block to see if it was hit after a liquidity sweep
    if (orderBlocks.bullishOB && sweeps.bullishSweeps) {
      orderBlocks.bullishOB.forEach(ob => {
        const obIndex = candles.findIndex(c => c.t === ob.time);
        if (obIndex === -1) return;
        
        // Check if there was a bullish sweep before this OB
        const priorSweeps = sweeps.bullishSweeps.filter(sweep => {
          const sweepIndex = candles.findIndex(c => c.t === sweep.time);
          return sweepIndex !== -1 && sweepIndex < obIndex && (obIndex - sweepIndex) <= lookback;
        });
        
        if (priorSweeps.length > 0) {
          bullishBreakers.push({
            high: ob.high,
            low: ob.low,
            time: ob.time,
            strength: ob.strength * 1.5, // Stronger than regular OB
            sweepPrice: priorSweeps[0].price,
            type: 'BULLISH_BREAKER'
          });
        }
      });
    }
    
    if (orderBlocks.bearishOB && sweeps.bearishSweeps) {
      orderBlocks.bearishOB.forEach(ob => {
        const obIndex = candles.findIndex(c => c.t === ob.time);
        if (obIndex === -1) return;
        
        // Check if there was a bearish sweep before this OB
        const priorSweeps = sweeps.bearishSweeps.filter(sweep => {
          const sweepIndex = candles.findIndex(c => c.t === sweep.time);
          return sweepIndex !== -1 && sweepIndex < obIndex && (obIndex - sweepIndex) <= lookback;
        });
        
        if (priorSweeps.length > 0) {
          bearishBreakers.push({
            high: ob.high,
            low: ob.low,
            time: ob.time,
            strength: ob.strength * 1.5, // Stronger than regular OB
            sweepPrice: priorSweeps[0].price,
            type: 'BEARISH_BREAKER'
          });
        }
      });
    }
    
    return { bullishBreakers, bearishBreakers };
  }

  /**
   * Detect Mitigation Blocks
   * Order Block hit WITHOUT prior liquidity sweep
   * Weaker signal - potential fake move
   */
  function detectMitigationBlocks(candles, orderBlocks, sweeps, lookback = SMC_CONFIG.BREAKER_LOOKBACK) {
    if (!candles || candles.length < lookback) return { bullishMitigation: [], bearishMitigation: [] };
    
    const bullishMitigation = [];
    const bearishMitigation = [];
    
    // Check each Order Block to see if it was hit WITHOUT a prior sweep
    if (orderBlocks.bullishOB && sweeps.bullishSweeps) {
      orderBlocks.bullishOB.forEach(ob => {
        const obIndex = candles.findIndex(c => c.t === ob.time);
        if (obIndex === -1) return;
        
        // Check if there was NO bullish sweep before this OB
        const priorSweeps = sweeps.bullishSweeps.filter(sweep => {
          const sweepIndex = candles.findIndex(c => c.t === sweep.time);
          return sweepIndex !== -1 && sweepIndex < obIndex && (obIndex - sweepIndex) <= lookback;
        });
        
        if (priorSweeps.length === 0) {
          bullishMitigation.push({
            high: ob.high,
            low: ob.low,
            time: ob.time,
            strength: ob.strength * 0.7, // Weaker than regular OB
            type: 'BULLISH_MITIGATION'
          });
        }
      });
    }
    
    if (orderBlocks.bearishOB && sweeps.bearishSweeps) {
      orderBlocks.bearishOB.forEach(ob => {
        const obIndex = candles.findIndex(c => c.t === ob.time);
        if (obIndex === -1) return;
        
        // Check if there was NO bearish sweep before this OB
        const priorSweeps = sweeps.bearishSweeps.filter(sweep => {
          const sweepIndex = candles.findIndex(c => c.t === sweep.time);
          return sweepIndex !== -1 && sweepIndex < obIndex && (obIndex - sweepIndex) <= lookback;
        });
        
        if (priorSweeps.length === 0) {
          bearishMitigation.push({
            high: ob.high,
            low: ob.low,
            time: ob.time,
            strength: ob.strength * 0.7, // Weaker than regular OB
            type: 'BEARISH_MITIGATION'
          });
        }
      });
    }
    
    return { bullishMitigation, bearishMitigation };
  }

  /**
   * Detect Rejection Blocks
   * 50% wick zone at tops/bottoms where price was rejected
   * Calculated from 50% of wick length to high/low
   */
  function detectRejectionBlocks(candles, lookback = 10) {
    if (!candles || candles.length < lookback) return { bullishRejection: [], bearishRejection: [] };
    
    const bullishRejection = [];
    const bearishRejection = [];
    const recentCandles = candles.slice(-lookback);
    
    recentCandles.forEach(candle => {
      const bodyTop = Math.max(candle.o, candle.c);
      const bodyBottom = Math.min(candle.o, candle.c);
      const upperWick = candle.h - bodyTop;
      const lowerWick = bodyBottom - candle.l;
      const totalRange = candle.h - candle.l;
      
      // Bearish Rejection: Long upper wick (rejection from top)
      if (upperWick / totalRange >= SMC_CONFIG.REJECTION_WICK_THRESHOLD) {
        const rejectionZoneTop = candle.h;
        const rejectionZoneBottom = candle.h - (upperWick * 0.5); // 50% of wick
        
        bearishRejection.push({
          top: rejectionZoneTop,
          bottom: rejectionZoneBottom,
          time: candle.t,
          wickStrength: upperWick / totalRange,
          type: 'BEARISH_REJECTION'
        });
      }
      
      // Bullish Rejection: Long lower wick (rejection from bottom)
      if (lowerWick / totalRange >= SMC_CONFIG.REJECTION_WICK_THRESHOLD) {
        const rejectionZoneTop = candle.l + (lowerWick * 0.5); // 50% of wick
        const rejectionZoneBottom = candle.l;
        
        bullishRejection.push({
          top: rejectionZoneTop,
          bottom: rejectionZoneBottom,
          time: candle.t,
          wickStrength: lowerWick / totalRange,
          type: 'BULLISH_REJECTION'
        });
      }
    });
    
    return { bullishRejection, bearishRejection };
  }

  /**
   * Detect Inducement
   * False levels/traps created before true Point of Interest (POI)
   * Small highs/lows that trap retail traders
   */
  function detectInducement(candles, lookback = SMC_CONFIG.INDUCEMENT_LOOKBACK) {
    if (!candles || candles.length < lookback + 3) return { bullishInducement: [], bearishInducement: [] };
    
    const bullishInducement = [];
    const bearishInducement = [];
    const { swingHighs, swingLows } = findSwingPoints(candles, SMC_CONFIG.INDUCEMENT_SWING_LOOKBACK);
    
    // Look for small swing lows followed by larger moves up (bullish inducement)
    for (let i = 1; i < swingLows.length; i++) {
      const current = swingLows[i];
      const previous = swingLows[i - 1];
      const currentIndex = current.index;
      
      // Check if there's a significant move after this swing low
      if (currentIndex < candles.length - 3) {
        const nextCandles = candles.slice(currentIndex, currentIndex + lookback);
        const maxPriceAfter = Math.max(...nextCandles.map(c => c.h));
        const moveSize = maxPriceAfter - current.price;
        const swingSize = Math.abs(current.price - previous.price);
        
        // If the move after is much larger than the swing itself, it's likely inducement
        // Move must be 3.33x larger than the swing (configured threshold)
        if (swingSize > 0 && moveSize / swingSize > SMC_CONFIG.INDUCEMENT_MOVE_MULTIPLIER) {
          bullishInducement.push({
            price: current.price,
            time: current.time,
            index: currentIndex,
            type: 'BULLISH_INDUCEMENT',
            strength: moveSize / swingSize
          });
        }
      }
    }
    
    // Look for small swing highs followed by larger moves down (bearish inducement)
    for (let i = 1; i < swingHighs.length; i++) {
      const current = swingHighs[i];
      const previous = swingHighs[i - 1];
      const currentIndex = current.index;
      
      // Check if there's a significant move after this swing high
      if (currentIndex < candles.length - 3) {
        const nextCandles = candles.slice(currentIndex, currentIndex + lookback);
        const minPriceAfter = Math.min(...nextCandles.map(c => c.l));
        const moveSize = current.price - minPriceAfter;
        const swingSize = Math.abs(current.price - previous.price);
        
        // If the move after is much larger than the swing itself, it's likely inducement
        // Move must be 3.33x larger than the swing (configured threshold)
        if (swingSize > 0 && moveSize / swingSize > SMC_CONFIG.INDUCEMENT_MOVE_MULTIPLIER) {
          bearishInducement.push({
            price: current.price,
            time: current.time,
            index: currentIndex,
            type: 'BEARISH_INDUCEMENT',
            strength: moveSize / swingSize
          });
        }
      }
    }
    
    return { bullishInducement, bearishInducement };
  }

  /**
   * Get Dynamic Trading Range based on last confirmed Swing High/Low after BOS
   * This defines the actual "Trading Leg" instead of using static lookback
   * Returns the range defined by institutional impulse move
   */
  function getDynamicTradingRange(candles, marketStructure) {
    if (!candles || candles.length < 20 || !marketStructure) {
      // Fallback to static lookback if no structure detected
      return null;
    }

    const { swingHighs, swingLows, lastBOS, lastCHoCH } = marketStructure;
    
    if (!swingHighs || swingHighs.length < 2 || !swingLows || swingLows.length < 2) {
      return null;
    }

    // Find the most recent structural event (BOS or CHoCH)
    const hasRecentBOS = lastBOS !== null;
    const hasRecentCHoCH = lastCHoCH !== null;
    
    if (!hasRecentBOS && !hasRecentCHoCH) {
      return null; // No confirmed structure break
    }

    // Get last confirmed swing high and low that define the current leg
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    const lastSwingLow = swingLows[swingLows.length - 1];
    
    // Find previous swing points to define the leg range
    const prevSwingHigh = swingHighs.length >= 2 ? swingHighs[swingHighs.length - 2] : lastSwingHigh;
    const prevSwingLow = swingLows.length >= 2 ? swingLows[swingLows.length - 2] : lastSwingLow;
    
    // Define range based on trend direction
    let rangeHigh, rangeLow;
    
    if (lastBOS && lastBOS.type === 'BULLISH_BOS') {
      // Bullish structure: use last swing low to current high
      rangeLow = lastSwingLow.price;
      rangeHigh = lastSwingHigh.price;
    } else if (lastBOS && lastBOS.type === 'BEARISH_BOS') {
      // Bearish structure: use last swing high to current low
      rangeHigh = lastSwingHigh.price;
      rangeLow = lastSwingLow.price;
    } else if (lastCHoCH) {
      // CHoCH: use previous swing points
      rangeHigh = Math.max(lastSwingHigh.price, prevSwingHigh.price);
      rangeLow = Math.min(lastSwingLow.price, prevSwingLow.price);
    } else {
      // Fallback: use last 2 swing points
      rangeHigh = Math.max(lastSwingHigh.price, prevSwingHigh.price);
      rangeLow = Math.min(lastSwingLow.price, prevSwingLow.price);
    }

    const rangeSize = rangeHigh - rangeLow;
    
    return {
      rangeHigh,
      rangeLow,
      rangeSize,
      isDynamic: true,
      swingHighRef: lastSwingHigh,
      swingLowRef: lastSwingLow
    };
  }

  /**
   * Calculate OTE (Optimal Trade Entry) Fibonacci Levels
   * Returns key Fibonacci retracement levels: 0.618, 0.705, 0.786
   * OTE Zone is between 0.705 and 0.786 (optimal institutional entry)
   */
  function calculateOTE(rangeHigh, rangeLow) {
    if (!rangeHigh || !rangeLow || rangeHigh <= rangeLow) {
      return null;
    }

    const rangeSize = rangeHigh - rangeLow;
    
    return {
      fib_0_618: rangeLow + (rangeSize * 0.618),
      fib_0_705: rangeLow + (rangeSize * 0.705),
      fib_0_786: rangeLow + (rangeSize * 0.786),
      // OTE zone for BUY (in discount area): 0.705-0.786 from bottom
      oteDiscountLow: rangeLow + (rangeSize * (1 - 0.786)),  // 0.214 from bottom
      oteDiscountHigh: rangeLow + (rangeSize * (1 - 0.705)), // 0.295 from bottom
      // OTE zone for SELL (in premium area): 0.705-0.786 from top
      otePremiumLow: rangeLow + (rangeSize * 0.705),
      otePremiumHigh: rangeLow + (rangeSize * 0.786),
      rangeHigh,
      rangeLow,
      rangeSize
    };
  }

  /**
   * Check if price is in OTE zone for entry
   * Returns true if price is in optimal entry zone based on direction
   */
  function isInOTEZone(currentPrice, oteData, direction) {
    if (!oteData || !currentPrice) return false;

    if (direction === 'BUY') {
      // BUY requires price in discount OTE zone (lower 0.705-0.786 retracement)
      return currentPrice >= oteData.oteDiscountLow && currentPrice <= oteData.oteDiscountHigh;
    } else if (direction === 'SELL') {
      // SELL requires price in premium OTE zone (upper 0.705-0.786 retracement)
      return currentPrice >= oteData.otePremiumLow && currentPrice <= oteData.otePremiumHigh;
    }

    return false;
  }

  /**
   * Calculate Premium/Discount Zones
   * Divides the current range into zones:
   * - Premium (75-100%): "Expensive" zone for SELL setups
   * - Equilibrium (50%): Balance point
   * - Discount (0-25%): "Cheap" zone for BUY setups
   * 
   * Now uses dynamic range based on actual market structure instead of static lookback
   */
  function calculatePremiumDiscount(candles, lookback = SMC_CONFIG.LIQUIDITY_LOOKBACK, marketStructure = null) {
    if (!candles || candles.length < lookback) return null;
    
    // Try to use dynamic range first
    let rangeHigh, rangeLow, rangeSize, isDynamic = false;
    
    if (marketStructure) {
      const dynamicRange = getDynamicTradingRange(candles, marketStructure);
      if (dynamicRange && dynamicRange.rangeSize > 0) {
        rangeHigh = dynamicRange.rangeHigh;
        rangeLow = dynamicRange.rangeLow;
        rangeSize = dynamicRange.rangeSize;
        isDynamic = true;
      }
    }
    
    // Fallback to static lookback if dynamic range not available
    if (!isDynamic) {
      const recentCandles = candles.slice(-lookback);
      rangeHigh = Math.max(...recentCandles.map(c => c.h));
      rangeLow = Math.min(...recentCandles.map(c => c.l));
      rangeSize = rangeHigh - rangeLow;
    }
    
    if (rangeSize === 0) return null;
    
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle.c;
    
    // Calculate zone levels
    const premiumLevel = rangeLow + (rangeSize * SMC_CONFIG.PREMIUM_THRESHOLD);
    const discountLevel = rangeLow + (rangeSize * SMC_CONFIG.DISCOUNT_THRESHOLD);
    const equilibriumLevel = rangeLow + (rangeSize * SMC_CONFIG.EQUILIBRIUM);
    
    // Determine current zone
    let currentZone = 'EQUILIBRIUM';
    let zonePercentage = ((currentPrice - rangeLow) / rangeSize) * 100;
    
    if (currentPrice >= premiumLevel) {
      currentZone = 'PREMIUM'; // Expensive - good for selling
    } else if (currentPrice <= discountLevel) {
      currentZone = 'DISCOUNT'; // Cheap - good for buying
    }
    
    return {
      rangeHigh,
      rangeLow,
      rangeSize,
      premiumLevel,
      equilibriumLevel,
      discountLevel,
      currentPrice,
      currentZone,
      zonePercentage: Math.round(zonePercentage),
      isDynamic,
      // Trading bias based on zone
      bias: currentZone === 'PREMIUM' ? 'BEARISH' : currentZone === 'DISCOUNT' ? 'BULLISH' : 'NEUTRAL'
    };
  }

  /**
   * Comprehensive Smart Money Analysis
   * Combines all SMC indicators for complete market picture
   */
  function analyzeSmartMoney(candles) {
    if (!candles || candles.length < 20) {
      return null;
    }

    const marketStructure = detectMarketStructure(candles);
    const equalLevels = detectEqualLevels(candles);
    const sweeps = detectLiquiditySweeps(candles);
    const orderBlocks = detectOrderBlocks(candles);
    const imbalance = detectImbalance(candles);
    
    // New SMC elements
    const breakerBlocks = detectBreakerBlocks(candles, orderBlocks, sweeps);
    const mitigationBlocks = detectMitigationBlocks(candles, orderBlocks, sweeps);
    const rejectionBlocks = detectRejectionBlocks(candles);
    const inducement = detectInducement(candles);
    const premiumDiscount = calculatePremiumDiscount(candles, SMC_CONFIG.LIQUIDITY_LOOKBACK, marketStructure);

    // Calculate OTE levels if we have premium/discount data
    let ote = null;
    if (premiumDiscount && premiumDiscount.rangeHigh && premiumDiscount.rangeLow) {
      ote = calculateOTE(premiumDiscount.rangeHigh, premiumDiscount.rangeLow);
    }

    return {
      marketStructure,
      liquidity: {
        equalLevels,
        sweeps
      },
      orderBlocks,
      imbalance,
      breakerBlocks,
      mitigationBlocks,
      rejectionBlocks,
      inducement,
      premiumDiscount,
      ote
    };
  }

  /**
   * Momentum & Velocity Delta
   * Measures price acceleration to confirm impulse
   */
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

  // Public API
  return {
    analyzeSmartMoney,
    calculateVelocityDelta,
    detectMarketStructure,
    findSwingPoints,
    detectEqualLevels,
    detectLiquiditySweeps,
    detectOrderBlocks,
    detectImbalance,
    detectBreakerBlocks,
    detectMitigationBlocks,
    detectRejectionBlocks,
    detectInducement,
    calculatePremiumDiscount,
    calculateOTE,
    isInOTEZone,
    getDynamicTradingRange,
    CONFIG: SMC_CONFIG
  };

})();
