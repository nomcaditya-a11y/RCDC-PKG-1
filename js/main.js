// js/main.js

// Register DataLabels plugin globally
Chart.register(ChartDataLabels);

// Global State
let rawData = [];
let filteredData = [];
let chartInstances = {}; 
let mapInstance = null;
let markerGroup = null;

let currentMapZone = "ALL";
let currentMapAging = "Above 3 Months";

document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('connection-status');
    const data = await fetchMeterData();

    if (data && data.length > 0) {
        rawData = data;
        filteredData = [...rawData]; 
        
        statusEl.innerHTML = `🟢 Live: ${rawData.length} records`;
        statusEl.style.color = "#4ade80"; 
        
        // Setup and Render
        populateGlobalFiltersInitial();
        renderDashboard();

        // 1. Event Listeners for Hierarchy Sync (Cascading Dropdowns)
        document.getElementById('filter-region').addEventListener('change', syncDependentFilters);
        document.getElementById('filter-circle').addEventListener('change', syncDependentFilters);
        document.getElementById('filter-division').addEventListener('change', syncDependentFilters);

        // 2. Global Filter Controls
        document.getElementById('apply-filters').addEventListener('click', applyGlobalFilters);
        document.getElementById('reset-filters').addEventListener('click', resetGlobalFilters);
        
        // 3. Map Filter Controls
        document.getElementById('map-zone-filter').addEventListener('change', (e) => {
            currentMapZone = e.target.value;
            updateMapFilters(); 
            updateMapMarkers();
        });
        document.getElementById('map-aging-filter').addEventListener('change', (e) => {
            currentMapAging = e.target.value;
            updateMapFilters(); 
            updateMapMarkers();
        });

    } else {
        statusEl.innerHTML = `🔴 Error connecting to database`;
        statusEl.style.color = "#f87171";
    }
});

// --- HELPER FUNCTIONS ---
function safeGet(row, colName) {
    const key = Object.keys(row).find(k => k.trim() === colName);
    return key ? row[key] : null;
}

function calcPct(part, total) {
    if (total === 0) return "0%";
    return ((part / total) * 100).toFixed(1) + "%";
}

const percentFormatter = {
    color: '#fff',
    font: { weight: 'bold' },
    formatter: (value, ctx) => {
        let sum = 0;
        let dataArr = ctx.chart.data.datasets[0].data;
        dataArr.map(data => { sum += data; });
        if (sum === 0) return value;
        let percentage = (value * 100 / sum).toFixed(1) + "%";
        return `${value}\n(${percentage})`;
    },
    textAlign: 'center'
};

// --- GLOBAL CASCADING FILTER LOGIC ---
function repopulateDropdown(id, validData, columnName, currentValue) {
    const select = document.getElementById(id);
    const uniqueVals = [...new Set(validData.map(r => safeGet(r, columnName)).filter(Boolean))].sort();
    
    select.innerHTML = '<option value="ALL">All</option>';
    let valueStillValid = false;

    uniqueVals.forEach(val => {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = val;
        if (val === currentValue) {
            option.selected = true;
            valueStillValid = true;
        }
        select.appendChild(option);
    });

    if (!valueStillValid && currentValue !== "ALL") {
        select.value = "ALL";
    }
}

function populateGlobalFiltersInitial() {
    repopulateDropdown('filter-region', rawData, 'Region Name', 'ALL');
    repopulateDropdown('filter-circle', rawData, 'Circle Name', 'ALL');
    repopulateDropdown('filter-division', rawData, 'Division Name', 'ALL');
    repopulateDropdown('filter-zone', rawData, 'Zone/DC Name', 'ALL');
}

function syncDependentFilters() {
    const selRegion = document.getElementById('filter-region').value;
    const selCircle = document.getElementById('filter-circle').value;
    const selDiv = document.getElementById('filter-division').value;
    const selZone = document.getElementById('filter-zone').value;

    let circleData = rawData;
    if (selRegion !== "ALL") circleData = circleData.filter(r => safeGet(r, 'Region Name') === selRegion);
    
    let divData = circleData;
    if (selCircle !== "ALL") divData = divData.filter(r => safeGet(r, 'Circle Name') === selCircle);

    let zoneData = divData;
    if (selDiv !== "ALL") zoneData = zoneData.filter(r => safeGet(r, 'Division Name') === selDiv);

    repopulateDropdown('filter-circle', circleData, 'Circle Name', selCircle);
    repopulateDropdown('filter-division', divData, 'Division Name', selDiv);
    repopulateDropdown('filter-zone', zoneData, 'Zone/DC Name', selZone);
}

function applyGlobalFilters() {
    const region = document.getElementById('filter-region').value;
    const circle = document.getElementById('filter-circle').value;
    const division = document.getElementById('filter-division').value;
    const zone = document.getElementById('filter-zone').value;
    const startDate = document.getElementById('filter-start').value;
    const endDate = document.getElementById('filter-end').value;

    let start = startDate ? new Date(startDate) : null;
    let end = endDate ? new Date(endDate) : null;
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);

    filteredData = rawData.filter(row => {
        if (region !== "ALL" && safeGet(row, 'Region Name') !== region) return false;
        if (circle !== "ALL" && safeGet(row, 'Circle Name') !== circle) return false;
        if (division !== "ALL" && safeGet(row, 'Division Name') !== division) return false;
        if (zone !== "ALL" && safeGet(row, 'Zone/DC Name') !== zone) return false;

        if (start || end) {
            let rowDate = parseDateString(safeGet(row, 'disc. date'));
            if (!rowDate) return false; 
            rowDate.setHours(0, 0, 0, 0); 
            if (start && rowDate < start) return false;
            if (end && rowDate > end) return false;
        }
        return true;
    });

    currentMapZone = "ALL";
    currentMapAging = "ALL";
    renderDashboard();
}

function resetGlobalFilters() {
    document.getElementById('filter-region').value = "ALL";
    document.getElementById('filter-circle').value = "ALL";
    document.getElementById('filter-division').value = "ALL";
    document.getElementById('filter-zone').value = "ALL";
    document.getElementById('filter-start').value = "";
    document.getElementById('filter-end').value = "";
    
    populateGlobalFiltersInitial();

    currentMapZone = "ALL";
    currentMapAging = "ALL";
    filteredData = [...rawData];
    renderDashboard();
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

function destroyChart(chartId) {
    if (chartInstances[chartId]) chartInstances[chartId].destroy();
}

// --- KPI & CHARTS ---
function updateKPIs(data) {
    const total = data.length;
    let reconnected = 0, disconnected = 0, pending = 0, cellular = 0, rf = 0;

    data.forEach(r => {
        const status = (safeGet(r, 'Status') || "").toLowerCase();
        if (status.includes('reconnected')) reconnected++;
        else if (status.includes('disconnected')) disconnected++;
        else if (status.includes('pending')) pending++;

        const medium = (safeGet(r, 'Comm Medium') || "").toLowerCase();
        if (medium.includes('cellular')) cellular++;
        else if (medium.includes('rf')) rf++;
    });

    document.getElementById('kpi-total').innerText = total.toLocaleString();
    document.getElementById('kpi-reconnected').innerText = reconnected.toLocaleString();
    document.getElementById('kpi-reconnected-pct').innerText = calcPct(reconnected, total);
    document.getElementById('kpi-disconnected').innerText = disconnected.toLocaleString();
    document.getElementById('kpi-disconnected-pct').innerText = calcPct(disconnected, total);
    document.getElementById('kpi-pending').innerText = pending.toLocaleString();
    document.getElementById('kpi-pending-pct').innerText = calcPct(pending, total);
    document.getElementById('kpi-cellular').innerText = cellular.toLocaleString();
    document.getElementById('kpi-cellular-pct').innerText = calcPct(cellular, total);
    document.getElementById('kpi-rf').innerText = rf.toLocaleString();
    document.getElementById('kpi-rf-pct').innerText = calcPct(rf, total);
}

function drawRegionChart(data) {
    destroyChart('regionChart');
    
    // CHANGE: Removed the .filter() so it counts ALL records (Total Disconnections)
    const regionCounts = data.reduce((acc, row) => {
        const region = safeGet(row, 'Region Name') || 'Unknown';
        acc[region] = (acc[region] || 0) + 1;
        return acc;
    }, {});

    const ctx = document.getElementById('regionChart').getContext('2d');
    chartInstances['regionChart'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(regionCounts),
            datasets: [{
                data: Object.values(regionCounts),
                backgroundColor: ['#0284c7', '#f59e0b', '#16a34a', '#dc2626', '#8b5cf6'],
                borderWidth: 0, 
                hoverOffset: 4
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { position: 'right' }, 
                datalabels: percentFormatter,
                // Optional: Add a title inside the chart options to clarify it is Total
                title: {
                    display: true,
                    text: 'Total Disconnections by Region',
                    color: '#475569'
                }
            } 
        }
    });
}

function drawCommStatusChart(data) {
    destroyChart('commStatusChart');
    const disconnectedData = data.filter(r => safeGet(r, 'Status') && safeGet(r, 'Status').toLowerCase().includes('disconnected'));
    const commCounts = disconnectedData.reduce((acc, row) => {
        const status = safeGet(row, 'Comm Status') || 'Unknown';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    const ctx = document.getElementById('commStatusChart').getContext('2d');
    chartInstances['commStatusChart'] = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(commCounts),
            datasets: [{
                data: Object.values(commCounts),
                backgroundColor: ['#3b82f6', '#1e40af', '#f97316', '#34d399'],
                borderWidth: 0, hoverOffset: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, datalabels: percentFormatter } }
    });
}

function drawTrendChart(data) {
    destroyChart('trendChart');
    const monthData = {};
    data.forEach(row => {
        let dateObj = parseDateString(safeGet(row, 'disc. date'));
        if (!dateObj) return; 
        
        const monthKey = dateObj.toLocaleString('default', { month: 'short', year: 'numeric' });
        if (!monthData[monthKey]) monthData[monthKey] = { reconnected: 0, disconnected: 0 };
        
        if (safeGet(row, 'Status') && safeGet(row, 'Status').toLowerCase().includes('reconnected')) monthData[monthKey].reconnected++;
        monthData[monthKey].disconnected++;
    });

    const labels = Object.keys(monthData).sort((a, b) => new Date(a) - new Date(b));
    const reconnectedLine = labels.map(l => monthData[l].reconnected);
    const disconnectedLine = labels.map(l => monthData[l].disconnected);

    const ctx = document.getElementById('trendChart').getContext('2d');
    chartInstances['trendChart'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Total Disconnection', data: disconnectedLine, borderColor: '#1e40af', backgroundColor: '#1e40af', tension: 0.3, borderWidth: 3 },
                { label: 'Reconnected', data: reconnectedLine, borderColor: '#0284c7', backgroundColor: '#0284c7', tension: 0.3, borderWidth: 3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { datalabels: { align: 'top', font: { weight: 'bold' } } } }
    });
}

// --- TABLES ---
function buildProgressTable(data) {
    const tableData = {};
    let grandReconnected = 0, grandDisconnected = 0, grandPending = 0, grandTotal = 0;

    data.forEach(row => {
        const region = safeGet(row, 'Region Name') || 'Unknown';
        const circle = safeGet(row, 'Circle Name') || 'Unknown';
        const key = `${region} - ${circle}`;

        if (!tableData[key]) tableData[key] = { reconnected: 0, disconnected: 0, pending: 0, total: 0 };

        tableData[key].total++;
        grandTotal++;

        const status = (safeGet(row, 'Status') || "").toLowerCase();
        if (status.includes('reconnected')) { tableData[key].reconnected++; grandReconnected++; }
        else if (status.includes('disconnected')) { tableData[key].disconnected++; grandDisconnected++; }
        else if (status.includes('pending')) { tableData[key].pending++; grandPending++; }
    });

    const tbody = document.querySelector('#progress-table tbody');
    tbody.innerHTML = ''; 
    for (const [name, stats] of Object.entries(tableData)) {
        tbody.innerHTML += `<tr>
            <td>${name}</td>
            <td>${stats.reconnected} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(stats.reconnected, stats.total)})</span></td>
            <td>${stats.disconnected} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(stats.disconnected, stats.total)})</span></td>
            <td>${stats.pending} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(stats.pending, stats.total)})</span></td>
            <td><strong>${stats.total}</strong></td>
        </tr>`;
    }
    
    tbody.innerHTML += `<tr>
        <td><strong>Grand Total</strong></td>
        <td><strong>${grandReconnected} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(grandReconnected, grandTotal)})</span></strong></td>
        <td><strong>${grandDisconnected} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(grandDisconnected, grandTotal)})</span></strong></td>
        <td><strong>${grandPending} <span style="color:#64748b; font-size:0.75rem;">(${calcPct(grandPending, grandTotal)})</span></strong></td>
        <td><strong>${grandTotal}</strong></td>
    </tr>`;
}

// --- AGING LOGIC ---
function parseDateString(dateStr) {
    if (!dateStr) return null;
    let d = new Date(dateStr.trim());
    if (isNaN(d.getTime())) {
        const parts = dateStr.includes('/') ? dateStr.split('/') : dateStr.split('-');
        if (parts.length >= 3) d = new Date(`${parts[2].substring(0,4)}-${parts[1]}-${parts[0]}`);
    }
    return isNaN(d.getTime()) ? null : d;
}

function getAgingBucket(dateObj) {
    if (!dateObj) return "Unknown";
    const daysDiff = Math.floor((new Date().getTime() - dateObj.getTime()) / (1000 * 3600 * 24));
    if (daysDiff > 90) return "Above 3 Months";
    if (daysDiff > 60) return "Above 2 Months";
    if (daysDiff > 30) return "Above 1 Month";
    if (daysDiff > 15) return "Above 15 Days";
    return "Below 15 Days"; 
}

function buildAgingTable(data) {
    const disconnectedMeters = data.filter(row => safeGet(row, 'Status') && safeGet(row, 'Status').toLowerCase().includes('disconnected'));
    const regions = [...new Set(disconnectedMeters.map(r => safeGet(r, 'Region Name')).filter(Boolean))].sort();
    const buckets = ["Above 3 Months", "Above 2 Months", "Above 1 Month", "Above 15 Days", "Below 15 Days"];

    const agingData = {};
    buckets.forEach(b => { agingData[b] = { Total: 0 }; regions.forEach(r => agingData[b][r] = 0); });

    disconnectedMeters.forEach(row => {
        const bucket = getAgingBucket(parseDateString(safeGet(row, 'disc. date')));
        const region = safeGet(row, 'Region Name');
        if (agingData[bucket] && region && agingData[bucket][region] !== undefined) {
            agingData[bucket][region]++;
            agingData[bucket].Total++;
        }
    });

    const thead = document.querySelector('#aging-table thead');
    thead.innerHTML = `<tr><th>Aging Bucket</th>${regions.map(r => `<th>${r}</th>`).join('')}<th>Total</th></tr>`;

    const tbody = document.querySelector('#aging-table tbody');
    tbody.innerHTML = ''; 
    const grandTotals = { Total: 0 };
    regions.forEach(r => grandTotals[r] = 0);

    buckets.forEach(bucket => {
        let rowHtml = `<td>${bucket}</td>`;
        regions.forEach(r => { rowHtml += `<td>${agingData[bucket][r]}</td>`; grandTotals[r] += agingData[bucket][r]; });
        rowHtml += `<td><strong>${agingData[bucket].Total}</strong></td>`;
        grandTotals.Total += agingData[bucket].Total;
        tbody.innerHTML += `<tr>${rowHtml}</tr>`;
    });

    let totalHtml = `<td><strong>Grand Total</strong></td>`;
    regions.forEach(r => totalHtml += `<td><strong>${grandTotals[r]}</strong></td>`);
    totalHtml += `<td><strong>${grandTotals.Total}</strong></td>`;
    tbody.innerHTML += `<tr>${totalHtml}</tr>`;
}

// --- EXCEL-LIKE MAP FILTER LOGIC ---
function updateMapFilters() {
    const mapBaseData = filteredData.filter(row => safeGet(row, 'Status') && safeGet(row, 'Status').toLowerCase().includes('disconnected'));
    
    let dataForZoneOptions = mapBaseData;
    if (currentMapAging !== "ALL") {
        dataForZoneOptions = mapBaseData.filter(row => getAgingBucket(parseDateString(safeGet(row, 'disc. date'))) === currentMapAging);
    }
    const validZones = [...new Set(dataForZoneOptions.map(r => safeGet(r, 'Zone/DC Name')).filter(Boolean))].sort();

    let dataForAgingOptions = mapBaseData;
    if (currentMapZone !== "ALL") {
        dataForAgingOptions = mapBaseData.filter(row => safeGet(row, 'Zone/DC Name') === currentMapZone);
    }
    const validAgings = [...new Set(dataForAgingOptions.map(r => getAgingBucket(parseDateString(safeGet(r, 'disc. date')))).filter(Boolean))].sort();

    const zoneSelect = document.getElementById('map-zone-filter');
    zoneSelect.innerHTML = `<option value="ALL">All Available Zones</option>`;
    validZones.forEach(val => {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = val;
        if (val === currentMapZone) option.selected = true; 
        zoneSelect.appendChild(option);
    });

    const agingSelect = document.getElementById('map-aging-filter');
    agingSelect.innerHTML = `<option value="ALL">All Available Aging</option>`;
    const bucketOrder = ["Above 3 Months", "Above 2 Months", "Above 1 Month", "Above 15 Days", "Below 15 Days"];
    bucketOrder.forEach(val => {
        if (validAgings.includes(val)) {
            const option = document.createElement('option');
            option.value = val;
            option.textContent = val;
            if (val === currentMapAging) option.selected = true; 
            agingSelect.appendChild(option);
        }
    });
}

// --- MAP LOGIC WITH TOGGLE FOR SATELLITE/NORMAL VIEWS ---
function buildMap(data) {
    if (!mapInstance) {
        mapInstance = L.map('map');
        
        // Define the High Quality Google Hybrid Satellite Layer
        const satelliteLayer = L.tileLayer('http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '&copy; Google Maps'
        });

        // Define the standard OpenStreetMap Normal View Layer
        const normalLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        });

        // Add Satellite as the default view
        satelliteLayer.addTo(mapInstance);

        // Add the standard Leaflet Layer Control (Toggle Switch) to the top right of the map
        const baseMaps = {
            "Satellite View": satelliteLayer,
            "Normal View": normalLayer
        };
        L.control.layers(baseMaps, null, { position: 'topright' }).addTo(mapInstance);
        
        markerGroup = L.layerGroup().addTo(mapInstance);
    }
    updateMapMarkers();
}

function updateMapMarkers() {
    if (!markerGroup || !mapInstance) return;
    markerGroup.clearLayers();
    
    const selectedZone = currentMapZone;
    const selectedAging = currentMapAging;

    const disconnectedMeters = filteredData.filter(row => safeGet(row, 'Status') && safeGet(row, 'Status').toLowerCase().includes('disconnected'));
    const bounds = [];

    disconnectedMeters.forEach(row => {
        const lat = parseFloat(safeGet(row, 'Latitute'));
        const lng = parseFloat(safeGet(row, 'Longitude'));
        const zone = safeGet(row, 'Zone/DC Name');
        const bucket = getAgingBucket(parseDateString(safeGet(row, 'disc. date')));
        const meterNo = safeGet(row, 'meter_id') || 'Unknown';
        
        if (!isNaN(lat) && !isNaN(lng)) {
            const zoneMatch = (selectedZone === "ALL" || zone === selectedZone);
            const agingMatch = (selectedAging === "ALL" || bucket === selectedAging);

            if (zoneMatch && agingMatch) {
                
                const markerHtml = `
                    <div style="
                        background-color: #dc2626; 
                        color: #ffffff; 
                        font-family: 'Inter', sans-serif;
                        font-size: 11px; 
                        font-weight: 700; 
                        padding: 3px 6px; 
                        border-radius: 4px; 
                        border: 2px solid #ffffff; 
                        box-shadow: 0 3px 6px rgba(0,0,0,0.4);
                        white-space: nowrap;
                        text-align: center;
                        position: relative;
                        top: -10px;
                        left: -15px;
                    ">
                        ${meterNo}
                    </div>
                `;
                
                const icon = L.divIcon({ 
                    html: markerHtml, 
                    className: '', 
                    iconSize: null 
                });

                const marker = L.marker([lat, lng], { icon: icon })
                    .bindPopup(`
                        <div style="font-family:Inter,sans-serif;">
                            <h4 style="margin:0 0 5px 0; color:#1f2937;">Meter No: <b style="color:#0284c7;">${meterNo}</b></h4>
                            <p style="margin:2px 0; font-size:12px;"><b>Consumer No:</b> ${safeGet(row, 'consumer_no') || 'N/A'}</p>
                            <p style="margin:2px 0; font-size:12px;"><b>Zone/DC:</b> ${zone || 'N/A'}</p>
                            <p style="margin:2px 0; font-size:12px; color:#dc2626;"><b>Aging:</b> ${bucket}</p>
                        </div>
                    `);
                
                markerGroup.addLayer(marker);
                bounds.push([lat, lng]); 
            }
        }
    });

    if (bounds.length > 0) {
        mapInstance.fitBounds(L.latLngBounds(bounds), { padding: [40, 40] });
    } else {
        mapInstance.setView([21.25, 81.62], 6);
    }
}
// --- EXPORT KPI DATA TO CSV ---
function downloadKPIData(kpiType) {
    if (!filteredData || filteredData.length === 0) {
        alert("No data available to download.");
        return;
    }

    let exportData = [];
    let fileName = "";

    // Filter the data based on which card was clicked
    switch(kpiType) {
        case 'total':
            exportData = filteredData;
            fileName = "Total_Disconnections.csv";
            break;
        case 'reconnected':
            exportData = filteredData.filter(r => safeGet(r, 'Status') && safeGet(r, 'Status').toLowerCase().includes('reconnected'));
            fileName = "Reconnected_Meters.csv";
            break;
        case 'disconnected':
            exportData = filteredData.filter(r => safeGet(r, 'Status') && safeGet(r, 'Status').toLowerCase().includes('disconnected'));
            fileName = "Still_Disconnected_Meters.csv";
            break;
        case 'pending':
            exportData = filteredData.filter(r => safeGet(r, 'Status') && safeGet(r, 'Status').toLowerCase().includes('pending'));
            fileName = "Pending_Meters.csv";
            break;
        case 'cellular':
            exportData = filteredData.filter(r => safeGet(r, 'Comm Medium') && safeGet(r, 'Comm Medium').toLowerCase().includes('cellular'));
            fileName = "Cellular_Meters.csv";
            break;
        case 'rf':
            exportData = filteredData.filter(r => safeGet(r, 'Comm Medium') && safeGet(r, 'Comm Medium').toLowerCase().includes('rf'));
            fileName = "RF_Meters.csv";
            break;
    }

    if (exportData.length === 0) {
        alert(`No records found for ${kpiType} in the current filter.`);
        return;
    }

    // Convert the array of objects back into CSV text using PapaParse
    const csvContent = Papa.unparse(exportData);
    
    // Create a Blob containing the CSV data
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    // Create a hidden link, click it to trigger download, and remove it
    const link = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0,10); // Format: YYYY-MM-DD
    
    link.setAttribute("href", url);
    link.setAttribute("download", `RCDC_${dateStr}_${fileName}`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// js/main.js

async function switchPackage(pkgType) {
    // 1. UI Feedback: Update active button
    document.querySelectorAll('.pkg-btn').forEach(btn => btn.classList.remove('active'));
    if(pkgType === 'pkg1') document.getElementById('btn-pkg1').classList.add('active');
    if(pkgType === 'pkg3') document.getElementById('btn-pkg3').classList.add('active');

    // 2. Show Loading State
    const statusEl = document.getElementById('connection-status');
    statusEl.innerHTML = "🟡 Loading " + pkgType.toUpperCase() + "...";

    // 3. Fetch New Data
    const newData = await fetchMeterData(pkgType);

    if (newData && newData.length > 0) {
        rawData = newData;
        filteredData = [...rawData];
        
        statusEl.innerHTML = `🟢 ${pkgType.toUpperCase()} Live: ${rawData.length} records`;
        
        // 4. Refresh everything with new data
        populateGlobalFiltersInitial();
        renderDashboard();
    } else {
        statusEl.innerHTML = `🔴 Error loading ${pkgType.toUpperCase()}`;
    }
}

// js/main.js

// Function to start the background auto-reload
function startAutoReload(minutes = 5) {
    console.log(`Auto-reload scheduled every ${minutes} minutes.`);
    
    setInterval(async () => {
        // 1. Identify which package is currently active
        const activePkg = document.getElementById('btn-pkg3').classList.contains('active') ? 'pkg3' : 'pkg1';
        
        // 2. Silently update the status badge to show it's checking
        const statusEl = document.getElementById('connection-status');
        const originalStatus = statusEl.innerHTML;
        statusEl.innerHTML = `🔄 Syncing...`;

        // 3. Fetch fresh data using the Cache Buster we set up in api.js
        const newData = await fetchMeterData(activePkg);

        if (newData && newData.length > 0) {
            // 4. Update global variables
            rawData = newData;
            
            // Re-apply existing filters so the user doesn't lose their current view
            applyGlobalFilters(); 
            
            statusEl.innerHTML = `🟢 Live Sync: ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            console.log("Background data sync complete.");
        } else {
            statusEl.innerHTML = originalStatus; // Revert if fetch fails
        }
    }, minutes * 60 * 1000); 
}

// 5. Initialize the reload when the page first loads
// Add this inside your document.addEventListener('DOMContentLoaded', ...) block
startAutoReload(5);

async function refreshData() {
    // Get the current active package (detect which button has the 'active' class)
    const activePkg = document.getElementById('btn-pkg3').classList.contains('active') ? 'pkg3' : 'pkg1';
    
    // Call your switch function to reload everything
    await switchPackage(activePkg);
    console.log("Data manually refreshed!");
}
