# Pocket Scout v13 - Advanced SMC Sequence Logic

## 1. SMC Prime Sequence (State Machine)
Signals are no longer based on additive scoring. Instead, the engine must transition through the following states:

1.  **IDLE**: Searching for Liquidity Pools (EQH/EQL) or Major Swing Points.
2.  **LIQUIDITY_SWEPT**: Detected a wick pierce and close back within a major level (Stop Hunt).
3.  **DISPLACEMENT_DETECTED**: Rapid price movement in the opposite direction of the sweep (Minimum Velocity > 1.5x average).
4.  **SHIF_IN_STRUCTURE (CHoCH)**: Price breaks the previous counter-trend swing point.
5.  **RETEST_OF_POI**: Price returns to the "fresh" Order Block or FVG created during displacement.
6.  **EXECUTION**: Entry trigger on the first touch of POI with M1 candle confirmation.

## 2. Breakout Quality Index (BQI)
Validation metrics for all structural breaks (BOS/CHoCH):
- **Body Ratio**: `(Body Size / Total Range) > 0.6`
- **Volume Surge**: `Volume > 1.2x SMA(Volume, 10)`
- **Displacement Factor**: `Candle Size > 1.5x ATR(14)`

## 3. Market Context Gates
- **Volatility Filter**: Block signals if `ATR_Ratio (Current/Mean) < 0.8` (Contraction phase).
- **Trend Synchronization**: M1 entry must be in the direction of the M15 "Super-Trend".
- **Mitigation Limit**: Max 1 mitigation per POI. Secondary tests are ignored.

## 4. Dynamic Entry Optimization
- **Entry Time**: 3-5 minutes depending on the distance to the next major liquidity target.
- **Micro-Momentum**: Confirmation via Velocity Delta at the moment of entry.
