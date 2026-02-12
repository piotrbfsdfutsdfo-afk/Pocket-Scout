document.addEventListener('DOMContentLoaded', function() {

    const pairsGridEl = document.getElementById('pairsGrid');
    const lastSignalContentEl = document.getElementById('lastSignalContent');
    const intelFillEl = document.getElementById('intel-fill');
    const intelPctEl = document.getElementById('intel-pct');
    const countdownEl = document.getElementById('global-countdown');

    const statTotalEl = document.getElementById('stat-total');
    const statWREl = document.getElementById('stat-wr');
    const statCyclesEl = document.getElementById('stat-cycles');

    const signalIntervalSelect = document.getElementById('signalInterval');
    const tradeDurationSelect = document.getElementById('tradeDuration');
    const resetHistoryBtn = document.getElementById('resetHistory');

    function queryTabs(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs.length > 0) {
                callback(tabs[0].id);
            }
        });
    }

    function sendMessageToContent(tabId, message, callback) {
        chrome.tabs.sendMessage(tabId, message, function(response) {
            if (callback) callback(response);
        });
    }

    function formatPrice(price, pairName) {
        if (price == null) return '--';
        return pairName.includes('JPY') ? price.toFixed(3) : price.toFixed(5);
    }

    function updateCountdown() {
        const interval = parseInt(signalIntervalSelect.value, 10) || 5;
        const now = new Date();
        const min = now.getMinutes();
        const sec = now.getSeconds();
        const boundaryMin = min + (interval - (min % interval));
        const totalSecs = (boundaryMin - min) * 60 - sec;
        
        const m = Math.floor(totalSecs / 60);
        const s = totalSecs % 60;
        countdownEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        
        if (totalSecs <= 15) countdownEl.classList.add('pulse');
        else countdownEl.classList.remove('pulse');
    }

    function renderPairsGrid(pairStatus, warmupTarget) {
        if (!pairStatus) return;
        const pairs = Object.keys(pairStatus).sort();
        let html = '';

        for (const pair of pairs) {
            const status = pairStatus[pair];
            const name = pair.replace('_OTC', '').replace('/', '');
            const price = formatPrice(status.price, pair);
            const cycles = status.cycles || 0;
            const spi = status.spi || 0;
            const mode = status.mode || 'SMC_STANDARD';
            
            const warmupText = status.warmupComplete ? (mode === 'GHOST_INVERSION' ? 'GHOST' : 'SYNCS') : `WARMUP ${status.candles}/${warmupTarget}`;
            const warmupColor = status.warmupComplete ? (mode === 'GHOST_INVERSION' ? '#f472b6' : 'var(--success)') : 'var(--accent)';

            html += `
                <div class="node-card" style="${mode === 'GHOST_INVERSION' ? 'border-color: #f472b6' : ''}">
                    <div class="node-name">
                        <span>${name}</span>
                        <span class="synapse-act" style="color:${mode === 'GHOST_INVERSION' ? '#f472b6' : ''}">SPI: ${spi}</span>
                    </div>
                    <div class="node-price">${price}</div>
                    <div class="node-meta">
                        <span style="color:${warmupColor}">${warmupText}</span>
                        <span style="opacity:0.5">${cycles} CYCLES</span>
                    </div>
                </div>
            `;
        }
        pairsGridEl.innerHTML = html;
    }

    function updatePopup() {
        updateCountdown();
        queryTabs(tabId => {
            sendMessageToContent(tabId, { type: 'GET_METRICS' }, (response) => {
                if (!response) return;

                const { metrics, lastSignal, pairStatus } = response;

                // Update stats
                statTotalEl.textContent = metrics.totalSignals;
                statWREl.textContent = metrics.winRate.toFixed(1) + '%';

                // Intelligence Calculation (based on global cycles)
                let totalCycles = 0;
                if (pairStatus) {
                    Object.values(pairStatus).forEach(s => totalCycles += (s.cycles || 0));
                }
                statCyclesEl.textContent = totalCycles;

                const intelLevel = Math.min(100, Math.floor(totalCycles / 1.5)); // Goal: 150 cycles for 100%
                intelFillEl.style.width = intelLevel + '%';
                intelPctEl.textContent = intelLevel + '%';

                renderPairsGrid(pairStatus, metrics.currentWarmup);

                if (lastSignal) {
                    const time = new Date(lastSignal.timestamp).toLocaleTimeString();
                    const actionColor = lastSignal.action === 'BUY' ? 'var(--success)' : 'var(--danger)';
                    const resTag = lastSignal.result ? `[${lastSignal.result}]` : '[LIVE]';
                    const conf = lastSignal.confidence || 0;
                    const dur = lastSignal.duration || 0;

                    const mode = lastSignal.reasons[0]?.includes('GHOST') ? 'GHOST' : 'SMC';
                    const modeColor = mode === 'GHOST' ? '#f472b6' : 'var(--nexus)';

                    lastSignalContentEl.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="color:var(--dim)">${lastSignal.pair.replace('_OTC','')}</span>
                            <span style="font-size:9px; background:${modeColor}; color:#000; padding:1px 4px; border-radius:3px; font-weight:bold;">${mode} MODE</span>
                        </div>
                        <span style="color:${actionColor}">${lastSignal.action}</span>
                        @ ${formatPrice(lastSignal.entryPrice, lastSignal.pair)}
                        <br/><span style="font-size:10px; opacity:0.7">CONF: ${conf}% | DUR: ${dur}m | ${time} ${resTag}</span>
                        <div style="font-size:9px; opacity:0.5; margin-top:4px;">${lastSignal.reasons.slice(1).join(' | ')}</div>
                    `;
                }

                signalIntervalSelect.value = metrics.currentInterval;
                tradeDurationSelect.value = metrics.currentDuration;
            });
        });
    }

    signalIntervalSelect.addEventListener('change', function() {
        queryTabs(tabId => sendMessageToContent(tabId, { type: 'SET_INTERVAL', interval: this.value }));
    });

    tradeDurationSelect.addEventListener('change', function() {
        queryTabs(tabId => sendMessageToContent(tabId, { type: 'SET_DURATION', duration: this.value }));
    });

    resetHistoryBtn.addEventListener('click', function() {
        if (confirm('RESET ALL NEURAL DATA?')) {
            queryTabs(tabId => sendMessageToContent(tabId, { type: 'RESET_HISTORY' }, updatePopup));
        }
    });

    setInterval(updatePopup, 1000);
    updatePopup();
});
