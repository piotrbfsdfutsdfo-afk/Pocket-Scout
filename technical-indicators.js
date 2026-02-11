/**
 * Pocket Scout v12.0.0 - Technical Indicators
 * A specialized library of SM-focused technical indicators.
 * FIX: The IIFE now returns the library object directly and assigns it to window,
 * making it available for explicit injection and preventing scope/timing issues.
 */
window.TechnicalIndicators = (function(window) {
    'use strict';

    // Helper to check for valid array input
    function validateArray(input) {
        return Array.isArray(input) && input.length > 0;
    }

    // Simple Moving Average
    function calculateSMA(data, period) {
        if (!validateArray(data) || data.length < period) return null;
        let results = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j];
            }
            results.push(sum / period);
        }
        return results;
    }

    // Exponential Moving Average
    function calculateEMA(data, period) {
        if (!validateArray(data) || data.length < period) return null;
        let results = [];
        const k = 2 / (period + 1);
        let sma = 0;
        for (let i = 0; i < period; i++) {
            sma += data[i];
        }
        results[period - 1] = sma / period;
        for (let i = period; i < data.length; i++) {
            results[i] = (data[i] * k) + (results[i - 1] * (1 - k));
        }
        return results.slice(period - 1);
    }

    // Bollinger Bands
    function calculateBollingerBands(data, period, stdDev) {
        if (!validateArray(data) || data.length < period) return null;
        const middle = [];
        const upper = [];
        const lower = [];
        for (let i = period - 1; i < data.length; i++) {
            const slice = data.slice(i - period + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b, 0) / period;
            const std = Math.sqrt(slice.map(x => Math.pow(x - sma, 2)).reduce((a, b) => a + b, 0) / period);
            middle.push(sma);
            upper.push(sma + (std * stdDev));
            lower.push(sma - (std * stdDev));
        }
        return { middle, upper, lower };
    }

    // Relative Strength Index (RSI)
    function calculateRSI(data, period) {
        if (!validateArray(data) || data.length < period) return null;
        let gains = 0;
        let losses = 0;
        let results = [];

        for (let i = 1; i < period; i++) {
            const diff = data[i] - data[i - 1];
            if (diff > 0) gains += diff;
            else losses -= diff;
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        if (avgLoss === 0) results[period - 1] = 100;
        else results[period - 1] = 100 - (100 / (1 + (avgGain / avgLoss)));

        for (let i = period; i < data.length; i++) {
            const diff = data[i] - data[i - 1];
            let currentGain = 0;
            let currentLoss = 0;

            if (diff > 0) currentGain = diff;
            else currentLoss = -diff;

            avgGain = (avgGain * (period - 1) + currentGain) / period;
            avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
            
            if (avgLoss === 0) results[i] = 100;
            else results[i] = 100 - (100 / (1 + (avgGain / avgLoss)));
        }
        return results.slice(period-1);
    }
    
    // Stochastic Oscillator
    function calculateStochastic(candles, kPeriod, dPeriod) {
        if (!validateArray(candles) || candles.length < kPeriod) return null;
        
        const kValues = [];
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const slice = candles.slice(i - kPeriod + 1, i + 1);
            const low = Math.min(...slice.map(c => c.l));
            const high = Math.max(...slice.map(c => c.h));
            const close = candles[i].c;
            kValues.push(100 * ((close - low) / (high - low || 1)));
        }

        if (kValues.length < dPeriod) return null;
        
        const dValues = calculateSMA(kValues, dPeriod);
        
        return {
            k: kValues,
            d: dValues
        };
    }

    /**
     * RSI Divergence Detection - A Leading Indicator for Reversals
     * 
     * Divergence occurs when price action and RSI momentum move in opposite directions,
     * signaling potential trend exhaustion and reversal opportunities.
     * 
     * BULLISH DIVERGENCE:
     * - Price makes a LOWER low (bearish continuation)
     * - BUT RSI makes a HIGHER low (momentum weakening)
     * - Interpretation: Selling pressure is diminishing, reversal to upside likely
     * 
     * BEARISH DIVERGENCE:
     * - Price makes a HIGHER high (bullish continuation)
     * - BUT RSI makes a LOWER high (momentum weakening)
     * - Interpretation: Buying pressure is diminishing, reversal to downside likely
     * 
     * @param {Array<number>} prices - Array of closing prices (must be aligned with rsiValues)
     * @param {Array<number>} rsiValues - Array of RSI values corresponding to prices
     * @param {number} lookback - Number of candles to look back for divergence (default: 10)
     * @returns {Object} { bullish: boolean, bearish: boolean, strength: number }
     */
    function detectRSIDivergence(prices, rsiValues, lookback = 10) {
        // Minimum offset from current candle for extrema to be valid for divergence
        // This ensures the extrema is not too recent (needs at least 3 candles separation)
        const MIN_LOOKBACK_OFFSET = 3;
        
        // Validate inputs
        if (!validateArray(prices) || !validateArray(rsiValues)) return { bullish: false, bearish: false, strength: 0 };
        if (prices.length !== rsiValues.length) return { bullish: false, bearish: false, strength: 0 };
        if (prices.length < lookback) return { bullish: false, bearish: false, strength: 0 };
        
        // Get recent data for analysis
        const recentPrices = prices.slice(-lookback);
        const recentRSI = rsiValues.slice(-lookback);
        
        // Find local extrema (peaks and troughs) in the lookback window
        let priceMin = recentPrices[0];
        let priceMinIdx = 0;
        let priceMax = recentPrices[0];
        let priceMaxIdx = 0;
        let rsiMin = recentRSI[0];
        let rsiMinIdx = 0;
        let rsiMax = recentRSI[0];
        let rsiMaxIdx = 0;
        
        // Scan for extrema in the lookback window
        for (let i = 1; i < recentPrices.length; i++) {
            if (recentPrices[i] < priceMin) {
                priceMin = recentPrices[i];
                priceMinIdx = i;
            }
            if (recentPrices[i] > priceMax) {
                priceMax = recentPrices[i];
                priceMaxIdx = i;
            }
            if (recentRSI[i] < rsiMin) {
                rsiMin = recentRSI[i];
                rsiMinIdx = i;
            }
            if (recentRSI[i] > rsiMax) {
                rsiMax = recentRSI[i];
                rsiMaxIdx = i;
            }
        }
        
        // Current values (most recent point)
        const currentPrice = recentPrices[recentPrices.length - 1];
        const currentRSI = recentRSI[recentRSI.length - 1];
        
        let bullish = false;
        let bearish = false;
        let strength = 0;
        
        // BULLISH DIVERGENCE CHECK
        // Condition: Current price is making lower low, but RSI is making higher low
        if (currentPrice < priceMin && priceMinIdx < recentPrices.length - MIN_LOOKBACK_OFFSET) {
            // Price made a new low
            if (currentRSI > rsiMin && rsiMinIdx < recentRSI.length - MIN_LOOKBACK_OFFSET) {
                // RSI is NOT making a new low (divergence!)
                bullish = true;
                if (priceMin > 0) {
                    const priceChange = ((priceMin - currentPrice) / priceMin) * 100;
                    const rsiChange = currentRSI - rsiMin;
                    strength = Math.min(100, Math.abs(priceChange * 10) + rsiChange);
                }
            }
        }
        
        // BEARISH DIVERGENCE CHECK
        // Condition: Current price is making higher high, but RSI is making lower high
        if (currentPrice > priceMax && priceMaxIdx < recentPrices.length - MIN_LOOKBACK_OFFSET) {
            // Price made a new high
            if (currentRSI < rsiMax && rsiMaxIdx < recentRSI.length - MIN_LOOKBACK_OFFSET) {
                // RSI is NOT making a new high (divergence!)
                bearish = true;
                if (priceMax > 0) {
                    const priceChange = ((currentPrice - priceMax) / priceMax) * 100;
                    const rsiChange = rsiMax - currentRSI;
                    strength = Math.min(100, Math.abs(priceChange * 10) + rsiChange);
                }
            }
        }
        
        return { bullish, bearish, strength: Math.round(strength) };
    }

    // Average Directional Index (ADX)
    function calculateADX(candles, period = 14) {
        if (!validateArray(candles) || candles.length < period * 2) return null;

        const results = [];
        let plusDI = [];
        let minusDI = [];
        let tr = [];
        let plusDM = [];
        let minusDM = [];

        for (let i = 1; i < candles.length; i++) {
            const h = candles[i].h;
            const l = candles[i].l;
            const ph = candles[i-1].h;
            const pl = candles[i-1].l;
            const pc = candles[i-1].c;

            const currentTR = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
            tr.push(currentTR);

            const upMove = h - ph;
            const downMove = pl - l;

            if (upMove > downMove && upMove > 0) plusDM.push(upMove);
            else plusDM.push(0);

            if (downMove > upMove && downMove > 0) minusDM.push(downMove);
            else minusDM.push(0);
        }

        const smoothedTR = calculateEMA(tr, period);
        const smoothedPlusDM = calculateEMA(plusDM, period);
        const smoothedMinusDM = calculateEMA(minusDM, period);

        if (!smoothedTR || !smoothedPlusDM || !smoothedMinusDM) return null;

        const dx = [];
        for (let i = 0; i < smoothedTR.length; i++) {
            const pDI = 100 * (smoothedPlusDM[i] / smoothedTR[i]);
            const mDI = 100 * (smoothedMinusDM[i] / smoothedTR[i]);
            const currentDX = 100 * (Math.abs(pDI - mDI) / (pDI + mDI || 1));
            dx.push(currentDX);
            plusDI.push(pDI);
            minusDI.push(mDI);
        }

        const adx = calculateEMA(dx, period);

        return {
            adx: adx,
            plusDI: plusDI.slice(-adx.length),
            minusDI: minusDI.slice(-adx.length)
        };
    }

    const library = {
        calculateSMA,
        calculateEMA,
        calculateBollingerBands,
        calculateRSI,
        calculateStochastic,
        calculateADX,
        detectRSIDivergence
    };
    
    console.log('[Pocket Scout v12.0.0] Technical Indicators loaded (SMA, EMA, BB, RSI, Stoch).');
    return library;

})(window);
