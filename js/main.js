// js/main.js

// Register DataLabels plugin globally
Chart.register(ChartDataLabels);

// --- GLOBAL STATE ---
let rawData = [];
let filteredData = [];
let chartInstances = {}; 
let mapInstance = null;
let markerGroup = null;
let neighborGroup = null;

let currentMapZone = "ALL";
let currentMapAging = "Above 3 Months"; // FIX: Default is now Above 3 Months
let currentMapComm = "NonComm"; 

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // Check Dark Mode
    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const themeBtn = document.getElementById('theme-btn');
        if(themeBtn) themeBtn.innerText = '☀️';
    }

    const data = await fetchMeterData();
    if (data && data.length > 0) {
        rawData = data;
        filteredData = [...rawData]; 
        document.getElementById('connection-status').innerHTML = `🟢 Live: ${rawData.length} records`;
        
        populateGlobalFiltersInitial();
        
        applyGlobalFilters(); 

        document.getElementById('filter-region').addEventListener('change', syncDependentFilters);
        document.getElementById('filter-circle').addEventListener('change', syncDependentFilters);
        document.getElementById('filter-division').addEventListener('change', syncDependentFilters);

        document.getElementById('apply-filters').addEventListener('click', applyGlobalFilters);
        document.getElementById('reset-filters').addEventListener('click', resetGlobalFilters);
        
        document.getElementById('map-zone-filter').addEventListener('change', e => { currentMapZone = e.target.value; updateMapFilters(); updateMapMarkers(); });
        document.getElementById('map-aging-filter').addEventListener('change', e => { currentMapAging = e.target.value; updateMapFilters(); updateMapMarkers(); });
        document.getElementById('map-comm-filter').addEventListener('change', e => { currentMapComm = e.target.value; updateMapFilters(); updateMapMarkers(); });
    } else {
        document.getElementById('connection-status').innerHTML = `🔴 Error connecting to database`;
        document.getElementById('connection-status').style.color = "#ef4444";
    }
});

// --- HELPER FUNCTIONS ---
function safeGet(row, colName) {
    const key = Object.keys(row).find(k => k.trim().toLowerCase() === colName.toLowerCase());
    return key ? row[key] : null;
}

const percentFormatter = {
    color: '#fff', font: { weight: 'bold' },
    formatter: (value, ctx) => {
        let sum = 0;
        ctx.chart.data.datasets[0].data.forEach(d => { sum += d; });
        if (sum === 0) return value;
        return `${value}\n(${((value * 100) / sum).toFixed(1)}%)`;
    }, textAlign: 'center'
};

function getGroupingColumn() {
    if (document.getElementById('filter-zone').value !== "ALL") return 'Zone/DC Name';
    if (document.getElementById('filter-division').value !== "ALL") return 'Zone/DC Name';
    if (document.getElementById('filter-circle').value !== "ALL") return 'Division Name';
    if (document.getElementById('filter-region').value !== "ALL") return 'Circle Name';
    return 'Region Name';
}

function getChildColumn(parentCol) {
    if (parentCol === 'Region Name') return 'Circle Name';
    if (parentCol === 'Circle Name') return 'Division Name';
    if (parentCol === 'Division Name') return 'Zone/DC Name';
    return null; 
}

window.toggleParentRow = function(rowElement, childClassName) {
    const children = document.querySelectorAll('.' + childClassName);
    const iconElement = rowElement.querySelector('.toggle-icon');
    if (!children || children.length === 0) return;

    let isCurrentlyHidden = children[0].style.display === 'none';
    
    children.forEach(child => {
        child.style.display = isCurrentlyHidden ? 'table-row' : 'none';
    });
    
    if (iconElement) {
        if (isCurrentlyHidden) {
            iconElement.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
            iconElement.style.color = '#0284c7';
        } else {
            iconElement.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
            iconElement.style.color = '';
        }
    }
};

function repopulateDropdown(id, validData, columnName, currentValue) {
    const select = document.getElementById(id);
    const uniqueVals = [...new Set(validData.map(r => safeGet(r, columnName)).filter(Boolean))].sort();
    select.innerHTML = '<option value="ALL">All</option>';
    uniqueVals.forEach(val => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = val;
        if (val === currentValue) opt.selected = true;
        select.appendChild(opt);
    });
}

function syncDependentFilters() {
    const r = document.getElementById('filter-region').value;
    const c = document.getElementById('filter-circle').value;
    const d = document.getElementById('filter-division').value;
    
    let cData = rawData; if (r !== "ALL") cData = cData.filter(x => safeGet(x, 'Region Name') === r);
    let dData = cData; if (c !== "ALL") dData = dData.filter(x => safeGet(x, 'Circle Name') === c);
    let zData = dData; if (d !== "ALL") zData = zData.filter(x => safeGet(x, 'Division Name') === d);
    
    repopulateDropdown('filter-circle', cData, 'Circle Name', c);
    repopulateDropdown('filter-division', dData, 'Division Name', d);
    repopulateDropdown('filter-zone', zData, 'Zone/DC Name', document.getElementById('filter-zone').value);
}

function populateGlobalFiltersInitial() {
    repopulateDropdown('filter-region', rawData, 'Region Name', 'ALL');
    syncDependentFilters();
}

// --- STRICT MM/DD/YYYY DATE PARSER ---
function parseDateString(dateStr) {
    // 1. Instantly reject empties or Excel errors like #N/A
    if (!dateStr || dateStr === '#N/A' || dateStr.toString().trim() === '') return null;
    
    let str = dateStr.toString().trim();
    
    // 2. Handle pure numbers (Excel Serial Dates, just in case)
    if (!isNaN(str) && typeof str !== 'boolean') {
        return new Date((parseFloat(str) - 25569) * 86400 * 1000);
    }

    // 3. STRICT MM/DD/YYYY PARSING (Fixes browser timezone/region guessing)
    if (str.includes('/')) {
        let parts = str.split('/');
        if (parts.length === 3) {
            // Force 2-digit formats (e.g., '2' becomes '02')
            let month = parts[0].padStart(2, '0'); 
            let day = parts[1].padStart(2, '0');
            let year = parts[2];
            
            // If the year is 4 digits, format it as YYYY-MM-DD so JS universally accepts it
            if (year.length === 4) {
                // T00:00:00 forces it to calculate at exactly midnight local time
                let strictDate = new Date(`${year}-${month}-${day}T00:00:00`);
                if (!isNaN(strictDate.getTime())) return strictDate;
            }
        }
    }
    
    // 4. Fallback for any other valid formats (like YYYY-MM-DD)
    let fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

function isToday(dateObj) {
    if (!dateObj) return false;
    const today = new Date();
    return dateObj.getDate() === today.getDate() && dateObj.getMonth() === today.getMonth() && dateObj.getFullYear() === today.getFullYear();
}

// --- DUAL-DATE SMART FILTER LOGIC ---
// --- DUAL-DATE SMART FILTER LOGIC (CUMULATIVE BACKLOG) ---
// --- SMART HYBRID FILTER LOGIC ---
// --- SMART HYBRID FILTER LOGIC ---
function applyGlobalFilters() {
    const region = document.getElementById('filter-region').value;
    const circle = document.getElementById('filter-circle').value;
    const division = document.getElementById('filter-division').value;
    const zone = document.getElementById('filter-zone').value;
    
    const startVal = document.getElementById('filter-start').value;
    const endVal = document.getElementById('filter-end').value;
    const start = startVal ? new Date(startVal).setHours(0,0,0,0) : null;
    const end = endVal ? new Date(endVal).setHours(23,59,59,999) : null;
    
    let targetDate = end || start || new Date().setHours(23,59,59,999);

    filteredData = rawData.filter(row => {
        if (region !== "ALL" && safeGet(row, 'Region Name') !== region) return false;
        if (circle !== "ALL" && safeGet(row, 'Circle Name') !== circle) return false;
        if (division !== "ALL" && safeGet(row, 'Division Name') !== division) return false;
        if (zone !== "ALL" && safeGet(row, 'Zone/DC Name') !== zone) return false;

        const dDate = parseDateString(safeGet(row, 'disc. date'));
        // FIX: Look for BOTH spellings so it works no matter what!
        const rDate = parseDateString(safeGet(row, 'Reconnection date') || safeGet(row, 'Reconnecion date'));
        
        // Convert to secure timestamps for math
        const dTime = dDate ? dDate.getTime() : null;
        const rTime = rDate ? rDate.getTime() : null;

        row._isDValid = true;
        if (start || end) {
            row._isDValid = dTime && (!start || dTime >= start) && (!end || dTime <= end);
        }
        
        row._isRValid = true;
        if (start || end) {
            row._isRValid = rTime && (!start || rTime >= start) && (!end || rTime <= end);
        }

        row._isBacklog = dTime && (dTime <= targetDate);

        if (!row._isDValid && !row._isRValid && !row._isBacklog) return false;
        
        return true;
    });

    currentMapZone = "ALL"; 
    currentMapAging = "Above 3 Months"; 
    currentMapComm = "NonComm"; 
    renderDashboard();
}
function resetGlobalFilters() {
    document.querySelectorAll('.filter-grid select').forEach(s => s.value = "ALL");
    document.querySelectorAll('input[type="date"]').forEach(i => i.value = "");
    populateGlobalFiltersInitial();
    applyGlobalFilters();
}

function renderDashboard() {
    updateKPIs(filteredData);
    drawRegionChart(filteredData);
    drawCommStatusChart(filteredData);
    drawTrendChart(filteredData);
    buildProgressTable(filteredData);
    buildAgingTable(filteredData); 
    updateMapFilters();
    buildMap(filteredData);
}

function destroyChart(id) { if (chartInstances[id]) chartInstances[id].destroy(); }

function getMediumCounts(data) {
    let rf = 0, cell = 0;
    data.forEach(r => {
        const m = (safeGet(r, 'Comm Medium') || "").toLowerCase();
        if(m.includes('rf')) rf++; else if(m.includes('cell')) cell++;
    });
    return {rf, cell};
}

// --- KPIs WITH RF/CELL FOR ALL ---
// --- HYBRID KPIs ---
// --- HYBRID KPIs ---
function updateKPIs(data) {
    let totalDisc = [], recon = [], disc = [], pend = [];
    let todayDisc = [], todayRecon = []; 

    const startVal = document.getElementById('filter-start').value;
    const endVal = document.getElementById('filter-end').value;
    const end = endVal ? new Date(endVal).setHours(23,59,59,999) : null;
    const start = startVal ? new Date(startVal).setHours(0,0,0,0) : null;
    let targetDate = end || start || new Date().setHours(23,59,59,999);

    data.forEach(r => {
        let originalStatus = (safeGet(r, 'Status') || "").toLowerCase();
        let status = originalStatus;
        
        const dDate = parseDateString(safeGet(r, 'disc. date'));
        // FIX: Look for BOTH spellings
        const rDate = parseDateString(safeGet(r, 'Reconnection date') || safeGet(r, 'Reconnecion date'));
        const rTime = rDate ? rDate.getTime() : null;

        // TIME TRAVEL: Use strict timestamps
        if (originalStatus.includes('reconnected') && rTime && rTime > targetDate) {
            status = 'disconnected'; 
        }

        if (r._isDValid) { totalDisc.push(r); }
        
        if (r._isRValid && originalStatus.includes('reconnected')) { recon.push(r); }

        if (r._isBacklog) {
            if (status.includes('disconnected')) disc.push(r);
            else if (status.includes('pending')) pend.push(r);
        }

        if(isToday(dDate)) todayDisc.push(r);
        if(isToday(rDate) && originalStatus.includes('reconnected')) todayRecon.push(r);
    });

    // Update DOM
    document.getElementById('kpi-total').innerText = totalDisc.length;
    let tM = getMediumCounts(totalDisc);
    if(document.getElementById('sub-total')) document.getElementById('sub-total').innerHTML = `Cell: ${tM.cell} | RF: ${tM.rf}`;

    document.getElementById('kpi-reconnected').innerText = recon.length;
    let rM = getMediumCounts(recon);
    if(document.getElementById('sub-recon')) document.getElementById('sub-recon').innerHTML = `Cell: ${rM.cell} | RF: ${rM.rf}`;

    document.getElementById('kpi-disconnected').innerText = disc.length;
    let dM = getMediumCounts(disc);
    if(document.getElementById('sub-disc')) document.getElementById('sub-disc').innerHTML = `Cell: ${dM.cell} | RF: ${dM.rf}`;

    document.getElementById('kpi-pending').innerText = pend.length;
    let pM = getMediumCounts(pend);
    if(document.getElementById('sub-pend')) document.getElementById('sub-pend').innerHTML = `Cell: ${pM.cell} | RF: ${pM.rf}`;

    document.getElementById('kpi-today-disc').innerText = todayDisc.length;
    let tdM = getMediumCounts(todayDisc);
    if(document.getElementById('sub-today-disc')) document.getElementById('sub-today-disc').innerHTML = `Cell: ${tdM.cell} | RF: ${tdM.rf}`;

    document.getElementById('kpi-today-recon').innerText = todayRecon.length;
    let trM = getMediumCounts(todayRecon);
    if(document.getElementById('sub-today-recon')) document.getElementById('sub-today-recon').innerHTML = `Cell: ${trM.cell} | RF: ${trM.rf}`;
}

// --- CHARTS ---
function drawTrendChart(data) {
    destroyChart('trendChart');
    const monthData = {};
    
    data.forEach(row => {
        const status = (safeGet(row, 'Status') || "").toLowerCase();

        if (row._isDValid) {
            let discDate = parseDateString(safeGet(row, 'disc. date'));
            if (discDate) {
                const discMonth = discDate.toLocaleString('default', { month: 'short', year: 'numeric' });
                if (!monthData[discMonth]) monthData[discMonth] = { reconnected: 0, disconnected: 0 };
                monthData[discMonth].disconnected++;
            }
        }

        if (row._isRValid && status.includes('reconnected')) {
            let recDate = parseDateString(safeGet(row, 'reconnection date'));
            if (recDate) {
                const recMonth = recDate.toLocaleString('default', { month: 'short', year: 'numeric' });
                if (!monthData[recMonth]) monthData[recMonth] = { reconnected: 0, disconnected: 0 };
                monthData[recMonth].reconnected++;
            }
        }
    });

    const labels = Object.keys(monthData).sort((a, b) => new Date(a) - new Date(b));
    const recLine = labels.map(l => monthData[l].reconnected);
    const discLine = labels.map(l => monthData[l].disconnected);

    chartInstances['trendChart'] = new Chart(document.getElementById('trendChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Disconnections', data: discLine, borderColor: '#eab308', backgroundColor: '#eab308', tension: 0.3, borderWidth: 3 }, 
                { label: 'Reconnections', data: recLine, borderColor: '#0284c7', backgroundColor: '#0284c7', tension: 0.3, borderWidth: 3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { datalabels: { align: 'top', font: { weight: 'bold' } } } }
    });
}

function drawRegionChart(data) {
    destroyChart('regionChart');
    const groupByCol = getGroupingColumn();
    let displayTitle = groupByCol.replace(' Name', '').replace('/DC', ''); 
    if(document.getElementById('dynamic-chart-title')) document.getElementById('dynamic-chart-title').innerText = `Total Disconnections Analysis - ${displayTitle}`;

    const counts = data.filter(r => r._isDValid).reduce((acc, row) => {
        const key = safeGet(row, groupByCol) || 'Unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    chartInstances['regionChart'] = new Chart(document.getElementById('regionChart').getContext('2d'), {
        type: 'doughnut',
        data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ['#0284c7', '#f59e0b', '#16a34a', '#dc2626', '#8b5cf6'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, datalabels: percentFormatter } }
    });
}

function drawCommStatusChart(data) {
    destroyChart('commStatusChart');
    const discData = data.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    const counts = discData.reduce((acc, row) => {
        const s = safeGet(row, 'Comm Status') || 'Unknown';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
    }, {});

    chartInstances['commStatusChart'] = new Chart(document.getElementById('commStatusChart').getContext('2d'), {
        type: 'pie',
        data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: ['#ef4444', '#10b981', '#3b82f6', '#f59e0b'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, datalabels: percentFormatter } }
    });
}

// --- ACCORDION PROGRESS TABLE (WITH SVG ICONS) ---
function buildProgressTable(data) {
    const groupByCol = getGroupingColumn();
    const childCol = getChildColumn(groupByCol); 
    
    let displayHeader = groupByCol.replace(' Name', '').replace('/DC', '');
    if(document.getElementById('dynamic-progress-title')) document.getElementById('dynamic-progress-title').innerText = `DCRC Progress Analysis - ${displayHeader}`;

    const tableData = {};
    let grandR = 0, grandD = 0, grandP = 0, grandT = 0;

    data.forEach(row => {
        const key = safeGet(row, groupByCol) || 'Unknown';
        if (!tableData[key]) tableData[key] = { r: 0, d: 0, p: 0, t: 0, children: {} };
        
        const s = (safeGet(row, 'Status') || "").toLowerCase();
        let isR = false, isD = false, isP = false;
        
        if (row._isRValid && s.includes('recon')) { tableData[key].r++; grandR++; isR = true; }
        if (row._isDValid) {
            if (s.includes('disc')) { tableData[key].d++; grandD++; isD = true; }
            else if (s.includes('pend')) { tableData[key].p++; grandP++; isP = true; }
        }

        if (childCol) {
            const cKey = safeGet(row, childCol) || 'Unknown';
            if (!tableData[key].children[cKey]) tableData[key].children[cKey] = { r: 0, d: 0, p: 0, t: 0 };
            
            if (isR) tableData[key].children[cKey].r++;
            if (isD) tableData[key].children[cKey].d++;
            if (isP) tableData[key].children[cKey].p++;
            tableData[key].children[cKey].t = tableData[key].children[cKey].r + tableData[key].children[cKey].d + tableData[key].children[cKey].p;
        }
        
        tableData[key].t = tableData[key].r + tableData[key].d + tableData[key].p;
    });

    document.querySelector('#progress-table thead').innerHTML = `<tr><th>${displayHeader}</th><th>Reconnected</th><th>Disconnected</th><th>Pending</th><th>Total</th></tr>`;
    const tbody = document.querySelector('#progress-table tbody'); 
    tbody.innerHTML = '';
    
    let rowIndex = 0;
    for (const [k, v] of Object.entries(tableData)) {
        rowIndex++;
        const hasChildren = childCol && Object.keys(v.children).length > 0;
        
        const rightArrow = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;
        
        const expandIcon = hasChildren 
            ? `<span class="toggle-icon" style="margin-right:8px; display:inline-flex; align-items:center;">${rightArrow}</span>` 
            : `<span style="display:inline-block; width:24px; margin-right:8px;"></span>`;
        
        tbody.innerHTML += `<tr class="parent-row" ${hasChildren ? `style="cursor:pointer;" onclick="toggleParentRow(this, 'child-row-${rowIndex}')"` : ''}>
            <td><div style="display:flex; align-items:center;">${expandIcon}<strong>${k}</strong></div></td>
            <td>${v.r}</td><td>${v.d}</td><td>${v.p}</td><td><strong>${v.t}</strong></td>
        </tr>`;

        if (hasChildren) {
            for (const [cKey, cVal] of Object.entries(v.children)) {
                tbody.innerHTML += `<tr class="child-row child-row-${rowIndex}" style="display:none;">
                    <td class="child-cell" style="padding-left: 2rem;">&#8627; ${cKey}</td>
                    <td class="child-cell">${cVal.r}</td><td class="child-cell">${cVal.d}</td><td class="child-cell">${cVal.p}</td><td class="child-cell"><strong>${cVal.t}</strong></td>
                </tr>`;
            }
        }
    }

    grandT = grandR + grandD + grandP;
    tbody.innerHTML += `<tr style="background: rgba(0,0,0,0.05);">
        <td><strong>Grand Total</strong></td>
        <td><strong>${grandR}</strong></td><td><strong>${grandD}</strong></td><td><strong>${grandP}</strong></td><td><strong>${grandT}</strong></td>
    </tr>`;
}

function getAgingBucket(d) {
    if (!d) return "Unknown";
    const diff = Math.floor((new Date().getTime() - d.getTime()) / (1000 * 3600 * 24));
    if (diff > 90) return "Above 3 Months"; if (diff > 60) return "Above 2 Months";
    if (diff > 30) return "Above 1 Month"; if (diff > 15) return "Above 15 Days"; return "Below 15 Days"; 
}

function buildAgingTable(data) {
    const groupByCol = getGroupingColumn();
    if(document.getElementById('dynamic-aging-title')) document.getElementById('dynamic-aging-title').innerText = `Aging Analysis - ${groupByCol.replace(' Name','').replace('/DC','')}`;
    
    const discData = data.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    const cols = [...new Set(discData.map(r => safeGet(r, groupByCol)).filter(Boolean))].sort();
    const buckets = ["Above 3 Months", "Above 2 Months", "Above 1 Month", "Above 15 Days", "Below 15 Days"];
    
    const agingData = {}; 
    buckets.forEach(b => { agingData[b] = { T: 0 }; cols.forEach(c => agingData[b][c] = 0); });
    
    discData.forEach(row => {
        const b = getAgingBucket(parseDateString(safeGet(row, 'disc. date')));
        const c = safeGet(row, groupByCol);
        if (agingData[b] && c && agingData[b][c] !== undefined) { agingData[b][c]++; agingData[b].T++; }
    });

    document.querySelector('#aging-table thead').innerHTML = `<tr><th>Aging Bucket</th>${cols.map(c => `<th>${c}</th>`).join('')}<th>Total</th></tr>`;
    const tbody = document.querySelector('#aging-table tbody'); 
    tbody.innerHTML = '';
    
    const grandTotals = { Total: 0 };
    cols.forEach(c => grandTotals[c] = 0);

    buckets.forEach(b => {
        let html = `<td>${b}</td>`; 
        cols.forEach(c => { html += `<td>${agingData[b][c]}</td>`; grandTotals[c] += agingData[b][c]; });
        grandTotals.Total += agingData[b].T; 
        tbody.innerHTML += `<tr>${html}<td><strong>${agingData[b].T}</strong></td></tr>`;
    });

    let totalHtml = `<td><strong>Grand Total</strong></td>`;
    cols.forEach(c => totalHtml += `<td><strong>${grandTotals[c]}</strong></td>`);
    totalHtml += `<td><strong>${grandTotals.Total}</strong></td>`;
    tbody.innerHTML += `<tr style="background: rgba(0,0,0,0.05);">${totalHtml}</tr>`;
}

// --- MAP & NEIGHBORS (WITH JITTER FOR OVERLAPPING PINS) ---
function updateMapFilters() {
    const mapData = filteredData.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    
    let cData = mapData;
    if (currentMapComm === "NonComm") cData = cData.filter(r => (safeGet(r, 'Comm Status')||"").toLowerCase().includes('non'));
    else if (currentMapComm === "Comm") cData = cData.filter(r => !(safeGet(r, 'Comm Status')||"").toLowerCase().includes('non'));

    let zData = currentMapAging !== "ALL" ? cData.filter(r => getAgingBucket(parseDateString(safeGet(r, 'disc. date'))) === currentMapAging) : cData;
    let aData = currentMapZone !== "ALL" ? cData.filter(r => safeGet(r, 'Zone/DC Name') === currentMapZone) : cData;
    
    repopulateDropdown('map-zone-filter', zData, 'Zone/DC Name', currentMapZone);
    
    const validAgings = [...new Set(aData.map(r => getAgingBucket(parseDateString(safeGet(r, 'disc. date')))).filter(Boolean))];
    const aSel = document.getElementById('map-aging-filter'); aSel.innerHTML = `<option value="ALL">All Available Aging</option>`;
    ["Above 3 Months", "Above 2 Months", "Above 1 Month", "Above 15 Days", "Below 15 Days"].forEach(v => {
        if(validAgings.includes(v)) {
            const opt = document.createElement('option'); opt.value = v; opt.textContent = v;
            if(v === currentMapAging) opt.selected = true; aSel.appendChild(opt);
        }
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; const p1 = lat1 * Math.PI/180; const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180; const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function buildMap(data) {
    if (!mapInstance) {
        mapInstance = L.map('map');
        const sat = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { subdomains:['mt0','mt1','mt2','mt3']}).addTo(mapInstance);
        L.control.layers({ "Satellite": sat, "Normal": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png') }, null, { position:'topright' }).addTo(mapInstance);
        markerGroup = L.layerGroup().addTo(mapInstance);
        
        neighborGroup = L.layerGroup().addTo(mapInstance);
        mapInstance.on('popupclose', function() { if (neighborGroup) neighborGroup.clearLayers(); });
    }
    updateMapMarkers();
}

function updateMapMarkers() {
    markerGroup.clearLayers();
    if (neighborGroup) neighborGroup.clearLayers(); 
    const bounds = [];
    
    const redPinHtml = `<svg class="custom-pin" viewBox="0 0 24 24" width="30" height="30"><path fill="#dc2626" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
    const greenPinHtml = `<svg class="custom-pin" viewBox="0 0 24 24" width="24" height="24"><path fill="#16a34a" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
    const bluePinHtml = `<svg class="custom-pin" viewBox="0 0 24 24" width="24" height="24"><path fill="#0284c7" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;

    const redPin = L.divIcon({ html: redPinHtml, className: '', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30] });
    const greenPin = L.divIcon({ html: greenPinHtml, className: '', iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24] });
    const bluePin = L.divIcon({ html: bluePinHtml, className: '', iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24] });

    filteredData.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected')).forEach(row => {
        const bucket = getAgingBucket(parseDateString(safeGet(row, 'disc. date')));
        const commStat = (safeGet(row, 'Comm Status') || "").toLowerCase();
        
        let commMatch = false;
        if (currentMapComm === "ALL") commMatch = true;
        else if (currentMapComm === "NonComm" && commStat.includes('non')) commMatch = true;
        else if (currentMapComm === "Comm" && !commStat.includes('non')) commMatch = true;

        if ((currentMapZone === "ALL" || safeGet(row, 'Zone/DC Name') === currentMapZone) && 
            (currentMapAging === "ALL" || bucket === currentMapAging) && commMatch) {
            
            const lat = parseFloat(safeGet(row, 'Latitute')), lng = parseFloat(safeGet(row, 'Longitude'));
            if (!isNaN(lat)) {
                const marker = L.marker([lat, lng], { icon: redPin }).addTo(markerGroup);
                
                marker.on('click', function() {
                    neighborGroup.clearLayers(); 
                    let neighbors = [];
                    
                    rawData.forEach(nRow => {
                        if (nRow === row) return; 
                        let nLat = parseFloat(safeGet(nRow, 'Latitute')); 
                        let nLng = parseFloat(safeGet(nRow, 'Longitude'));
                        if (isNaN(nLat)) return;
                        
                        const dist = getDistance(lat, lng, nLat, nLng);
                        if (dist <= 200) { 
                            const stat = (safeGet(nRow, 'Status')||"").toLowerCase();
                            const comm = (safeGet(nRow, 'Comm Status')||"").toLowerCase();
                            
                            const isRecon = stat.includes('recon');
                            const isComm = !comm.includes('non') && comm.trim() !== "";
                            
                            if (isRecon || isComm) {
                                // FIX: Jitter for exactly identical coordinates so pins don't overlap completely
                                if (Math.abs(nLat - lat) < 0.00001 && Math.abs(nLng - lng) < 0.00001) {
                                    nLat += (Math.random() - 0.5) * 0.0002;
                                    nLng += (Math.random() - 0.5) * 0.0002;
                                }

                                neighbors.push({ id: safeGet(nRow, 'meter_id'), dist: Math.round(dist), stat: isRecon ? 'Reconnected' : 'Communicating' });
                                
                                const nMarker = L.marker([nLat, nLng], { icon: isRecon ? bluePin : greenPin, zIndexOffset: 1000 })
                                    .bindPopup(`<b style="font-size:11px; color:#333;">Neighbor Meter: ${safeGet(nRow, 'meter_id')}</b><br><span style="font-size:10px; color:${isRecon ? '#0284c7' : '#16a34a'};">${isRecon ? 'Reconnected' : 'Communicating'}</span>`);
                                neighborGroup.addLayer(nMarker);
                            }
                        }
                    });

                    let nList = neighbors.map(n => `<div class="neighbor-item">Meter: ${n.id} | <span class="${n.stat==='Reconnected'?'n-recon':'n-comm'}">${n.stat}</span> | ${n.dist}m away</div>`).join('');
                    if(neighbors.length === 0) nList = "<div style='font-size:10px; color:#888;'>No active neighbors within 200m.</div>";

                    marker.bindPopup(`
                        <div style="font-family:Inter; min-width: 200px;">
                            <h4 style="margin:0 0 5px 0;">Meter No: <b style="color:#dc2626;">${safeGet(row, 'meter_id')}</b></h4>
                            <p style="margin:2px 0; font-size:11px;"><b>Consumer:</b> ${safeGet(row, 'consumer_no')}</p>
                            <p style="margin:2px 0; font-size:11px;"><b>Aging:</b> ${bucket}</p>
                            <p style="margin:2px 0; font-size:11px;"><b>Comm Status:</b> ${safeGet(row, 'Comm Status') || 'N/A'}</p>
                            <hr style="margin:5px 0;">
                            <h5 style="margin:0; font-size:11px;">Nearby Active Meters (Theft Check):</h5>
                            <div class="neighbor-list">${nList}</div>
                        </div>
                    `).openPopup();
                });
                bounds.push([lat, lng]);
            }
        }
    });
    if (bounds.length > 0) mapInstance.fitBounds(bounds, { padding: [40, 40] });
}

// --- EXPORT LOGIC ---
function downloadKPIData(type) {
    let data = [];
    if(type === 'total') data = filteredData.filter(r => r._isDValid);
    else if(type === 'reconnected') data = filteredData.filter(r => r._isRValid && (safeGet(r, 'Status')||"").toLowerCase().includes('reconnected'));
    else if(type === 'disconnected') data = filteredData.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    else if(type === 'pending') data = filteredData.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('pending'));
    else if(type === 'today-disc') data = filteredData.filter(r => isToday(parseDateString(safeGet(r, 'disc. date'))));
    else if(type === 'today-recon') data = filteredData.filter(r => isToday(parseDateString(safeGet(r, 'reconnection date'))));
    
    if(data.length===0) return alert("No data to download.");
    triggerCSVDownload(data, `${type}_Report`);
}

async function exportBoxData(type, format, elementId) {
    let data = filteredData;
    if(type === 'comm') data = filteredData.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));

    if (format === 'csv') triggerCSVDownload(data, `${type}_Box_Data`);
    else if (format === 'pdf') {
        const element = document.getElementById(elementId);
        if (!element) return alert("Error finding element.");
        
        const canvas = await html2canvas(element, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jspdf.jsPDF({ orientation: 'landscape' });
        
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`RCDC_${type}_Report.pdf`);
    }
}

function triggerCSVDownload(dataArray, filename) {
    const blob = new Blob([Papa.unparse(dataArray)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `RCDC_${filename}_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

// --- PACKAGE SWITCHER & THEME ---
async function switchPackage(pkgType) {
    document.querySelectorAll('.pkg-btn').forEach(btn => btn.classList.remove('active'));
    if(pkgType === 'pkg1') document.getElementById('btn-pkg1').classList.add('active');
    if(pkgType === 'pkg3') document.getElementById('btn-pkg3').classList.add('active');

    const statusEl = document.getElementById('connection-status');
    statusEl.innerHTML = `🟡 Loading ${pkgType.toUpperCase()}...`;

    const newData = await fetchMeterData(pkgType); 

    if (newData && newData.length > 0) {
        rawData = newData;
        filteredData = [...rawData];
        statusEl.innerHTML = `🟢 ${pkgType.toUpperCase()} Live: ${rawData.length} records`;
        populateGlobalFiltersInitial();
        applyGlobalFilters(); 
    } else {
        statusEl.innerHTML = `🔴 Error loading ${pkgType.toUpperCase()}`;
    }
}

async function refreshData() {
    const activePkg = document.getElementById('btn-pkg3').classList.contains('active') ? 'pkg3' : 'pkg1';
    await switchPackage(activePkg);
}

function toggleTheme() {
    const root = document.documentElement;
    const themeBtn = document.getElementById('theme-btn');
    
    if (root.getAttribute('data-theme') === 'dark') {
        root.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        if(themeBtn) themeBtn.innerText = '🌙'; 
    } else {
        root.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        if(themeBtn) themeBtn.innerText = '☀️'; 
    }
}



