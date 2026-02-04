document.addEventListener('DOMContentLoaded', function() {

    const statusEl = document.getElementById('status');
    const metricsEl = document.getElementById('metrics');
    const lastSignalContentEl = document.getElementById('lastSignalContent');
    const pairsInfoEl = document.getElementById('pairsInfo');
    const pairsGridEl = document.getElementById('pairsGrid');
    const highConfStatsEl = document.getElementById('highConfStats');

    const signalIntervalSelect = document.getElementById('signalInterval');
    const warmupCandlesSelect = document.getElementById('warmupCandles');
    const resetHistoryBtn = document.getElementById('resetHistory');
    const exportLogsBtn = document.getElementById('exportLogs');

    function queryTabs(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs.length > 0) {
                callback(tabs[0].id);
            } else {
                console.error("Could not find active tab.");
            }
        });
    }

    function sendMessageToContent(tabId, message, callback) {
        chrome.tabs.sendMessage(tabId, message, function(response) {
            if (chrome.runtime.lastError) {
                console.error("Message failed:", chrome.runtime.lastError.message);
                statusEl.textContent = "Error: Refresh page";
                statusEl.className = 'status-bar status-error';
                return;
            }
            if (callback) callback(response);
        });
    }

    function formatPrice(price, pairName) {
        if (price == null) return '--';
        // Format based on pair type - check for JPY in pair name
        if (pairName && pairName.includes('JPY')) {
            return price.toFixed(3); // JPY pairs
        }
        return price.toFixed(5); // Regular pairs
    }

    function formatTimeSince(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        
        // For times over 90 seconds, show in minutes
        if (seconds >= 90) {
            const minutes = Math.floor(seconds / 60);
            return `${minutes}m ago`;
        }
        
        return `${seconds}s ago`;
    }

    function renderPairsGrid(pairStatus) {
        if (!pairStatus || Object.keys(pairStatus).length === 0) {
            pairsGridEl.innerHTML = '<div class="pair-card" style="grid-column: span 2; text-align: center; color: #64748b;">Waiting for POCKET_DATASTREAM_FEED data...</div>';
            return;
        }

        const pairs = Object.keys(pairStatus).sort();
        let html = '';

        for (const pair of pairs) {
            const status = pairStatus[pair];
            const price = formatPrice(status.price, pair);
            let statusClass = 'no-data';
            let statusText = 'No data';
            const cardClasses = [];
            
            // Payout information
            const payout = status.payout || 0;
            const payoutEligible = status.payoutEligible || false;
            const payoutClass = payoutEligible ? 'payout-eligible' : 'payout-low';
            const payoutDisplay = payout > 0 ? `+${payout}%` : '--';

            // Check if frozen
            if (status.frozen) {
                statusClass = 'no-data'; // Use no-data (red) for frozen
                cardClasses.push('frozen'); // Add frozen class to card
                const timeDisplay = formatTimeSince(status.timeSinceUpdate);
                statusText = `❄️ FROZEN (${timeDisplay})`;
            } else if (status.warmupComplete) {
                statusClass = 'ready';
                statusText = `✅ Ready (${status.candles} candles)`;
            } else if (status.candles > 0) {
                statusClass = 'warmup';
                statusText = `⏳ Warmup (${status.candles} candles)`;
            }
            
            // Add low-payout class to card if payout < 80%
            if (!payoutEligible && payout > 0) {
                cardClasses.push('low-payout');
            }

            // Shorten pair name for display
            const displayName = pair.replace('_OTC', '');
            const cardClass = cardClasses.join(' ');

            html += `
                <div class="pair-card ${cardClass}">
                    <div class="pair-name">${displayName} <span class="${payoutClass}">${payoutDisplay}</span></div>
                    <div class="pair-price">${price}</div>
                    <div class="pair-status ${statusClass}">${statusText}</div>
                </div>
            `;
        }

        pairsGridEl.innerHTML = html;
    }

    function updatePopup() {
        queryTabs(tabId => {
            sendMessageToContent(tabId, { type: 'GET_METRICS' }, (response) => {
                if (!response) return;

                // Update status
                const activePairs = response.activePairs || 0;
                const warmupCompletePairs = response.warmupCompletePairs || 0;

                if (warmupCompletePairs > 0) {
                    statusEl.textContent = `✅ Signal Engine Active (${warmupCompletePairs}/${activePairs} pairs ready)`;
                    statusEl.className = 'status-bar status-ok';
                } else if (activePairs > 0) {
                    statusEl.textContent = `⏳ Warming up... (${activePairs} pairs detected)`;
                    statusEl.className = 'status-bar status-warmup';
                } else {
                    statusEl.textContent = '⏳ Waiting for POCKET_DATASTREAM_FEED...';
                    statusEl.className = 'status-bar status-warmup';
                }

                // Update metrics
                const { metrics, lastSignal, pairStatus } = response;
                metricsEl.innerHTML = `
                    <div class="metric"><div class="metric-label">Win Rate</div><div class="metric-value">${metrics.winRate.toFixed(1)}%</div></div>
                    <div class="metric"><div class="metric-label">Total</div><div class="metric-value">${metrics.totalSignals}</div></div>
                    <div class="metric"><div class="metric-label">Wins</div><div class="metric-value">${metrics.wins}</div></div>
                    <div class="metric"><div class="metric-label">Losses</div><div class="metric-value">${metrics.losses}</div></div>
                `;

                // Render pairs grid
                renderPairsGrid(pairStatus);

                // Update last signal (includes pair name and confidence %)
                if (lastSignal) {
                    const time = new Date(lastSignal.timestamp).toLocaleTimeString();
                    const result = lastSignal.result ? `<span style="color:${lastSignal.result === 'WIN' ? '#4ade80' : '#f87171'}">[${lastSignal.result}]</span>` : '[PENDING]';
                    const pairDisplay = lastSignal.pair ? `<strong>${lastSignal.pair.replace('_OTC', '')}</strong> ` : '';
                    const entryPrice = lastSignal.entryPrice ? formatPrice(lastSignal.entryPrice, lastSignal.pair) : '--';
                    const confidence = lastSignal.confidence !== undefined ? `(${lastSignal.confidence}%)` : '';
                    lastSignalContentEl.innerHTML = `${pairDisplay}<strong>${lastSignal.action}</strong> ${confidence} @ ${entryPrice} for <strong>${lastSignal.duration}m</strong> (${time}) ${result}`;
                } else {
                    lastSignalContentEl.textContent = 'Waiting for first signal...';
                }

                // Update pairs info footer
                pairsInfoEl.textContent = `Active Pairs: ${activePairs} / Ready: ${warmupCompletePairs}`;

                // Update high-confidence stats (≥50%)
                const hcTotal = metrics.highConfTotal || 0;
                const hcWinRate = metrics.highConfWinRate || 0;
                const hcWR = hcTotal > 0 ? hcWinRate.toFixed(1) : '--';
                const hcWins = metrics.highConfWins || 0;
                const hcLosses = metrics.highConfLosses || 0;
                highConfStatsEl.innerHTML = `≥70% Conf: <strong>${hcTotal}</strong> signals (${hcWins}W/${hcLosses}L) | WR: <strong>${hcWR}%</strong>`;
                highConfStatsEl.style.color = hcTotal > 0 && hcWinRate >= 55 ? '#4ade80' : (hcTotal > 0 ? '#facc15' : '#64748b');

                // Set dropdowns to current config
                signalIntervalSelect.value = metrics.currentInterval;
                warmupCandlesSelect.value = metrics.currentWarmup;
            });
        });
    }

    // --- Event Listeners ---

    signalIntervalSelect.addEventListener('change', function() {
        queryTabs(tabId => sendMessageToContent(tabId, { type: 'SET_INTERVAL', interval: this.value }));
    });

    warmupCandlesSelect.addEventListener('change', function() {
        queryTabs(tabId => sendMessageToContent(tabId, { type: 'SET_WARMUP', warmup: this.value }));
    });

    resetHistoryBtn.addEventListener('click', function() {
        if (confirm('Are you sure you want to reset all stats and signal history?')) {
            queryTabs(tabId => sendMessageToContent(tabId, { type: 'RESET_HISTORY' }, updatePopup));
        }
    });

    exportLogsBtn.addEventListener('click', function() {
        this.textContent = 'Exporting...';
        this.disabled = true;
        queryTabs(tabId => {
            sendMessageToContent(tabId, { type: 'EXPORT_LOGS' }, (response) => {
                if (response && response.logs) {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.logs, null, 2));
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute("href", dataStr);
                    downloadAnchorNode.setAttribute("download", "diagnostic_logs.json");
                    document.body.appendChild(downloadAnchorNode); // required for firefox
                    downloadAnchorNode.click();
                    downloadAnchorNode.remove();
                }
                this.textContent = 'Export Logs';
                this.disabled = false;
            });
        });
    });

    // Initial update
    updatePopup();
    // And update every 3 seconds
    setInterval(updatePopup, 3000);
});
