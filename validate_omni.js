
const fs = require('fs');

// Mock global/window
global.window = global;
global.TechnicalIndicators = {
    calculateEMA: (data, p) => Array(data.length).fill(1.1),
    calculateRSI: (data, p) => Array(data.length).fill(50),
    calculateBollingerBands: (data, p, s) => ({ upper: Array(data.length).fill(1.2), lower: Array(data.length).fill(1.0), middle: Array(data.length).fill(1.1) }),
    calculateSMA: (data, p) => Array(data.length).fill(1.1),
    calculateStochastic: (data, k, d) => ({ k: Array(data.length).fill(50), d: Array(data.length).fill(50) }),
    calculateADX: (data, p) => ({ adx: Array(data.length).fill(30), plusDI: [], minusDI: [] }),
    detectRSIDivergence: () => ({ bullish: false, bearish: false, strength: 0 })
};

// Load scripts
eval(fs.readFileSync('smart-money-indicators.js', 'utf8'));
eval(fs.readFileSync('pocket-scout-v12-engine.js', 'utf8'));

console.log("Validating NEXUS OMNI Engine...");

const mockCandles = [];
for (let i = 0; i < 100; i++) {
    mockCandles.push({ o: 1.1, h: 1.15, l: 1.05, c: 1.1, t: Date.now() - (100 - i) * 60000 });
}

const allPairsData = {
    "EUR/USD_OTC": { candles: mockCandles, pairState: null, flux: 0.5 },
    "GBP/USD_OTC": { candles: mockCandles, pairState: null, flux: 0.1 }
};

// 1. Test: Always produce a winner
console.log("Testing mandatory winner generation...");
const result = global.ProjectNexus.processMarketSnapshot(allPairsData, 5, {});

if (result && result.pair) {
    console.log(`✅ Success: Produced winner ${result.pair} even with neutral setups.`);
} else {
    console.log("❌ Failure: Did not produce a winner.");
    process.exit(1);
}

// 2. Test: Ghost Inversion
console.log("Testing Ghost Inversion...");
const stateWithLosses = global.ProjectNexus.init("EUR/USD_OTC");
stateWithLosses.deepSight.virtualHistory = ['LOSS', 'LOSS', 'LOSS', 'LOSS', 'LOSS']; // 0% WR

const dataWithLosses = {
    "EUR/USD_OTC": { candles: mockCandles, pairState: stateWithLosses, flux: 1.5 }
};

const resultInverted = global.ProjectNexus.processMarketSnapshot(dataWithLosses, 5, {});
console.log("Model Mode:", resultInverted.reasons[0]);

if (resultInverted.reasons[0].includes('GHOST_INVERSION')) {
    console.log("✅ Success: Ghost Inversion activated for low WR pair.");
} else {
    console.log("❌ Failure: Ghost Inversion not activated.");
    process.exit(1);
}

console.log("NEXUS OMNI Validation Successful!");
