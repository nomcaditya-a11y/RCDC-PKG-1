// js/main.js

// Register DataLabels plugin globally
Chart.register(ChartDataLabels);

// --- GLOBAL STATE ---
let rawData = [];
let todayExportData = { disc: [], req: [] };
let satTotal = [], satRecon = [], satDisc = []; // SAT Arrays
let filteredData = [];
let chartInstances = {}; 
let mapInstance = null;
let markerGroup = null;
let neighborGroup = null;

let currentMapZone = "ALL";
let currentMapAging = "Above 3 Months"; 
let currentMapComm = "NonComm"; 

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
   // ==========================================
    // AUTHENTICATION, REGISTRATION & TIMEOUT
    // ==========================================
    let isLoginMode = true;
    let idleTimer;
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const SECRET_REGISTRATION_CODE = "GenusAdmin123"; // Only share this with authorized staff!

    // 1. Check if already logged in
    if (sessionStorage.getItem('dashboard_auth') === 'true') {
        document.getElementById('login-overlay').style.display = 'none';
        startIdleTimer(); 
    }

    // 2. Toggle between Login and Create Account
    window.toggleAuthMode = function() {
        isLoginMode = !isLoginMode;
        document.getElementById('auth-title').innerText = isLoginMode ? "Dashboard Login" : "Authorized Registration";
        document.getElementById('auth-subtitle').innerText = isLoginMode ? "Enter credentials to access the dashboard." : "Requires the secret company code to register.";
        document.getElementById('auth-action-btn').innerText = isLoginMode ? "Login" : "Register Account";
        document.getElementById('auth-toggle-link').innerText = isLoginMode ? "Create a new account" : "Back to Login";
        
        // Show/Hide the Secret Code box
        document.getElementById('auth-admin-code').style.display = isLoginMode ? 'none' : 'block';
        
        document.getElementById('auth-message').style.display = 'none';
        document.getElementById('auth-user').value = '';
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-admin-code').value = '';
    };

    // 3. Handle Submit
    window.handleAuth = function() {
        const user = document.getElementById('auth-user').value.trim();
        const pass = document.getElementById('auth-password').value.trim();
        const adminCode = document.getElementById('auth-admin-code').value.trim();
        const msgEl = document.getElementById('auth-message');

        if (!user || !pass) {
            msgEl.style.color = 'red'; msgEl.innerText = "Username and password required."; msgEl.style.display = 'block';
            return;
        }

        if (isLoginMode) {
            // --- LOGIN ---
            const storedPass = localStorage.getItem(`user_${user}`);
            
            // Allow login if password matches, or use the master override
            if ((storedPass && storedPass === pass) || (user === "admin" && pass === "Genus")) {
                sessionStorage.setItem('dashboard_auth', 'true');
                document.getElementById('login-overlay').style.display = 'none';
                msgEl.style.display = 'none';
                startIdleTimer();
            } else {
                msgEl.style.color = 'red'; msgEl.innerText = "Invalid username or password."; msgEl.style.display = 'block';
            }
        } else {
            // --- REGISTRATION (Now protected by Secret Code!) ---
            if (adminCode !== SECRET_REGISTRATION_CODE) {
                msgEl.style.color = 'red'; msgEl.innerText = "Invalid Secret Registration Code! Access Denied."; msgEl.style.display = 'block';
                return;
            }

            if (localStorage.getItem(`user_${user}`)) {
                msgEl.style.color = 'red'; msgEl.innerText = "Username already exists."; msgEl.style.display = 'block';
            } else {
                localStorage.setItem(`user_${user}`, pass); 
                msgEl.style.color = 'green'; msgEl.innerText = "Account Created! Please log in."; msgEl.style.display = 'block';
                setTimeout(toggleAuthMode, 1500); 
            }
        }
    };

    // Allow hitting "Enter" to submit
    const authInput = document.getElementById('auth-password');
    const authCodeInput = document.getElementById('auth-admin-code');
    if(authInput) authInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleAuth(); });
    if(authCodeInput) authCodeInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleAuth(); });

    // 4. --- IDLE TIMER & LOGOUT ---
    function startIdleTimer() {
        resetTimer();
        ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
            window.addEventListener(evt, resetTimer, true);
        });
    }

    function resetTimer() {
        clearTimeout(idleTimer);
        if (sessionStorage.getItem('dashboard_auth') === 'true') {
            idleTimer = setTimeout(() => logoutUser("Session expired due to 30 minutes of inactivity."), IDLE_TIMEOUT_MS);
        }
    }

    // This runs when the timer hits 30 mins, OR when you click the Logout button!
    window.logoutUser = function(customMessage = "You have been securely logged out.") {
        sessionStorage.removeItem('dashboard_auth');
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('auth-password').value = '';
        document.getElementById('auth-admin-code').value = '';
        
        const msgEl = document.getElementById('auth-message');
        msgEl.style.color = customMessage.includes("expired") ? 'red' : 'green'; 
        msgEl.innerText = customMessage; 
        msgEl.style.display = 'block';
        clearTimeout(idleTimer);
    };
    // Check Dark Mode
    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        const themeBtn = document.getElementById('theme-btn');
        if(themeBtn) themeBtn.innerText = '☀️';
    }

const data = await fetchMeterData('pkg3');
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

    setInterval(refreshData, 300000); // Auto-refresh data every 5 minutes
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
// --- STRICT DD/MM/YYYY DATE PARSER (Fixed for Indian Format) ---
// --- STRICT MM/DD/YYYY DATE PARSER ---
function parseDateString(dateStr) {
    if (!dateStr || dateStr === '#N/A' || dateStr.toString().trim() === '') return null;
    let str = dateStr.toString().trim().split(' ')[0];
    
    // 1. Handle Excel Serial Dates (Numbers)
    if (!isNaN(str) && typeof str !== 'boolean') {
        return new Date((parseFloat(str) - 25569) * 86400 * 1000);
    }

    // 2. Handle MM/DD/YYYY or MM-DD-YYYY
    let parts = str.includes('/') ? str.split('/') : str.split('-');
    
    if (parts.length === 3) {
        // If year is first (YYYY-MM-DD)
        if (parts[0].length === 4) {
            let year = parts[0];
            let month = parts[1].padStart(2, '0');
            let day = parts[2].padStart(2, '0');
            let strictDate = new Date(`${year}-${month}-${day}T00:00:00`);
            if (!isNaN(strictDate.getTime())) return strictDate;
        } 
        // MM/DD/YYYY Format
        else {
            let month = parts[0].padStart(2, '0'); // Month is FIRST
            let day = parts[1].padStart(2, '0');   // Day is SECOND
            let year = parts[2];
            if (year.length === 2) year = '20' + year; 
            
            let strictDate = new Date(`${year}-${month}-${day}T00:00:00`);
            if (!isNaN(strictDate.getTime())) return strictDate;
        }
    }
    
    // 3. Fallback
    let fallback = new Date(str);
    return isNaN(fallback.getTime()) ? null : fallback;
}

function isToday(dateObj) {
    if (!dateObj) return false;
    const today = new Date();
    return dateObj.getDate() === today.getDate() && dateObj.getMonth() === today.getMonth() && dateObj.getFullYear() === today.getFullYear();
}

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
        const rDate = parseDateString(safeGet(row, 'Reconnection date') || safeGet(row, 'Reconnecion date'));
        
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

// --- HYBRID KPIs WITH LRCF, TODAY'S ACTIVITY & SAT LOGIC ---
function updateKPIs(data) {
    let totalDisc = [], recon = [], disc = [], pend = [], lrcf = [];
    let todayDisc = [], todayReq = []; 
    satTotal = []; satRecon = []; satDisc = []; // Reset SAT Arrays

    const startVal = document.getElementById('filter-start').value;
    const endVal = document.getElementById('filter-end').value;
    const end = endVal ? new Date(endVal).setHours(23,59,59,999) : null;
    const start = startVal ? new Date(startVal).setHours(0,0,0,0) : null;
    let targetDate = end || start || new Date().setHours(23,59,59,999);

    data.forEach(r => {
        let originalStatus = (safeGet(r, 'Status') || "").toLowerCase();
        let status = originalStatus;
        
        const dDate = parseDateString(safeGet(r, 'disc. date'));
        const rDate = parseDateString(safeGet(r, 'Reconnection date') || safeGet(r, 'Reconnecion date'));
        const rTime = rDate ? rDate.getTime() : null;

        // TIME TRAVEL: Use strict timestamps
        if (originalStatus.includes('reconnected') && rTime && rTime > targetDate) {
            status = 'disconnected'; 
        }

        // Standard KPI Logic
        if (r._isDValid) { totalDisc.push(r); }
        if (r._isRValid && originalStatus.includes('reconnected')) { recon.push(r); }

        if (r._isBacklog) {
            if (status.includes('disconnected')) disc.push(r);
            else if (status.includes('pending')) pend.push(r);
            else if (status.includes('lrcf')) lrcf.push(r);
        }

        // TODAY LOGIC
        if(isToday(dDate)) todayDisc.push(r);
        if(isToday(rDate)) todayReq.push(r); 

        // SAT LOGIC (New)
        let satValue = (safeGet(r, 'sat meters') || "").toString().trim().toUpperCase();
        if (satValue === "SAT") {
            if (r._isDValid) satTotal.push(r);
            if (r._isRValid && originalStatus.includes('reconnected')) satRecon.push(r);
            if (r._isBacklog && status.includes('disconnected')) satDisc.push(r);
        }
    });

    // --- UPDATE DOM FOR MAIN KPIs ---
    if(document.getElementById('kpi-total')) {
        document.getElementById('kpi-total').innerText = totalDisc.length;
        let tM = getMediumCounts(totalDisc);
        if(document.getElementById('sub-total')) document.getElementById('sub-total').innerHTML = `Cell: ${tM.cell} | RF: ${tM.rf}`;
    }

    if(document.getElementById('kpi-reconnected')) {
        document.getElementById('kpi-reconnected').innerText = recon.length;
        let rM = getMediumCounts(recon);
        if(document.getElementById('sub-recon')) document.getElementById('sub-recon').innerHTML = `Cell: ${rM.cell} | RF: ${rM.rf}`;
    }

    if(document.getElementById('kpi-disconnected')) {
        document.getElementById('kpi-disconnected').innerText = disc.length;
        let dM = getMediumCounts(disc);
        if(document.getElementById('sub-disc')) document.getElementById('sub-disc').innerHTML = `Cell: ${dM.cell} | RF: ${dM.rf}`;
    }

    if(document.getElementById('kpi-lrcf')) {
        document.getElementById('kpi-lrcf').innerText = lrcf.length;
        let lM = getMediumCounts(lrcf);
        if(document.getElementById('sub-lrcf')) document.getElementById('sub-lrcf').innerHTML = `Cell: ${lM.cell} | RF: ${lM.rf}`;
    }

    if(document.getElementById('kpi-pending')) {
        document.getElementById('kpi-pending').innerText = pend.length;
        let pM = getMediumCounts(pend);
        if(document.getElementById('sub-pend')) document.getElementById('sub-pend').innerHTML = `Cell: ${pM.cell} | RF: ${pM.rf}`;
    }

    if(document.getElementById('kpi-today-disc')) {
        document.getElementById('kpi-today-disc').innerText = todayDisc.length;
        let tdM = getMediumCounts(todayDisc);
        if(document.getElementById('sub-today-disc')) document.getElementById('sub-today-disc').innerHTML = `Cell: ${tdM.cell} | RF: ${tdM.rf}`;
    }

    if(document.getElementById('kpi-today-req')) {
        document.getElementById('kpi-today-req').innerText = todayReq.length;
        let tReqM = getMediumCounts(todayReq);
        if(document.getElementById('sub-today-req')) document.getElementById('sub-today-req').innerHTML = `Cell: ${tReqM.cell} | RF: ${tReqM.rf}`;
    }

    // --- UPDATE DOM FOR SAT CARD ---
    if(document.getElementById('kpi-sat-total')) {
        document.getElementById('kpi-sat-total').innerText = satTotal.length;
        let sT = getMediumCounts(satTotal);
        document.getElementById('sub-sat-total').innerText = `Cell: ${sT.cell} | RF: ${sT.rf}`;
    }

    if(document.getElementById('kpi-sat-recon')) {
        document.getElementById('kpi-sat-recon').innerText = satRecon.length;
        let sR = getMediumCounts(satRecon);
        document.getElementById('sub-sat-recon').innerText = `Cell: ${sR.cell} | RF: ${sR.rf}`;
    }

    if(document.getElementById('kpi-sat-disc')) {
        document.getElementById('kpi-sat-disc').innerText = satDisc.length;
        
        let commMeters = satDisc.filter(r => {
            let c = (safeGet(r, 'Comm Status') || "").toLowerCase();
            return !c.includes('non') && c.trim() !== "";
        });
        let nonCommMeters = satDisc.filter(r => {
            let c = (safeGet(r, 'Comm Status') || "").toLowerCase();
            return c.includes('non') || c.trim() === "";
        });

        let commCounts = getMediumCounts(commMeters);
        let nonCounts = getMediumCounts(nonCommMeters);

        if(document.getElementById('sub-sat-disc-comm')) document.getElementById('sub-sat-disc-comm').innerText = `C:${commCounts.cell} | R:${commCounts.rf}`;
        if(document.getElementById('sub-sat-disc-non')) document.getElementById('sub-sat-disc-non').innerText = `C:${nonCounts.cell} | R:${nonCounts.rf}`;
    }

    // Save Data to Global Memory
    todayExportData.disc = todayDisc;
    todayExportData.req = todayReq;
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
            // Added typo fallback here just in case!
            let recDate = parseDateString(safeGet(row, 'Reconnection date') || safeGet(row, 'Reconnecion date'));
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
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                datalabels: { 
                    font: { weight: 'bold' },
                    // NEW: Clean up overlapping labels!
                    display: function(context) { 
                        return context.dataset.data[context.dataIndex] > 0; // Hides the annoying 0s
                    },
                    align: function(context) {
                        // Yellow on top, Blue on bottom so they never overlap
                        return context.datasetIndex === 0 ? 'top' : 'bottom'; 
                    }
                } 
            } 
        }
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

// --- ACCORDION PROGRESS TABLE ---
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

    document.querySelector('#progress-table thead').innerHTML = `<tr><th>${displayHeader}</th><th>Reconnected</th><th>Still Disconnected</th><th>Pending</th><th>Total</th></tr>`;
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

// --- ACCORDION AGING TABLE ---
// --- ACCORDION AGING TABLE ---
function buildAgingTable(data) {
    const groupByCol = getGroupingColumn();
    const childCol = getChildColumn(groupByCol);
    
    let displayHeader = groupByCol.replace(' Name', '').replace('/DC', '');
    if(document.getElementById('dynamic-aging-title')) {
        document.getElementById('dynamic-aging-title').innerText = `Still Disconnected Aging Analysis - ${displayHeader}`;
    }
    
    let discData = data.filter(r => r._isDValid && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    
    // --- NEW: APPLY LOCAL TABLE FILTERS ---
    const satFilter = document.getElementById('aging-sat-filter') ? document.getElementById('aging-sat-filter').value : "ALL";
    const commFilter = document.getElementById('aging-comm-filter') ? document.getElementById('aging-comm-filter').value : "ALL";

    if (satFilter === "SAT") {
        discData = discData.filter(r => (safeGet(r, 'sat meters') || "").toString().trim().toUpperCase() === "SAT");
    }
    if (commFilter !== "ALL") {
        discData = discData.filter(r => {
            let c = (safeGet(r, 'Comm Status') || "").toLowerCase();
            if (commFilter === "NonComm") return c.includes('non') || c.trim() === "";
            if (commFilter === "Comm") return !c.includes('non') && c.trim() !== "";
            return true;
        });
    }

    const buckets = ["Above 3 Months", "Above 2 Months", "Above 1 Month", "Above 15 Days", "Below 15 Days"];
    const tableData = {};
    const grandTotals = { "Above 3 Months": 0, "Above 2 Months": 0, "Above 1 Month": 0, "Above 15 Days": 0, "Below 15 Days": 0, "Total": 0 };

    discData.forEach(row => {
        const key = safeGet(row, groupByCol) || 'Unknown';
        if (!tableData[key]) {
            tableData[key] = { "Above 3 Months": 0, "Above 2 Months": 0, "Above 1 Month": 0, "Above 15 Days": 0, "Below 15 Days": 0, "Total": 0, children: {} };
        }
        
        const b = getAgingBucket(parseDateString(safeGet(row, 'disc. date')));

        if (buckets.includes(b)) {
            tableData[key][b]++;
            tableData[key].Total++;
            grandTotals[b]++;
            grandTotals.Total++;

            if (childCol) {
                const cKey = safeGet(row, childCol) || 'Unknown';
                if (!tableData[key].children[cKey]) {
                    tableData[key].children[cKey] = { "Above 3 Months": 0, "Above 2 Months": 0, "Above 1 Month": 0, "Above 15 Days": 0, "Below 15 Days": 0, "Total": 0 };
                }
                tableData[key].children[cKey][b]++;
                tableData[key].children[cKey].Total++;
            }
        }
    });

    document.querySelector('#aging-table thead').innerHTML = `
        <tr>
            <th>${displayHeader}</th>
            <th style="text-align: center;">> 3 Months</th>
            <th style="text-align: center;">> 2 Months</th>
            <th style="text-align: center;">> 1 Month</th>
            <th style="text-align: center;">> 15 Days</th>
            <th style="text-align: center;">< 15 Days</th>
            <th style="text-align: center;">Total</th>
        </tr>`;
        
    const tbody = document.querySelector('#aging-table tbody'); 
    tbody.innerHTML = '';
    
    let rowIndex = 0;
    const rightArrow = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`;

    for (const [k, v] of Object.entries(tableData)) {
        rowIndex++;
        const hasChildren = childCol && Object.keys(v.children).length > 0;
        
        const expandIcon = hasChildren 
            ? `<span class="toggle-icon" style="margin-right:8px; display:inline-flex; align-items:center;">${rightArrow}</span>` 
            : `<span style="display:inline-block; width:24px; margin-right:8px;"></span>`;
        
        tbody.innerHTML += `<tr class="parent-row" ${hasChildren ? `style="cursor:pointer;" onclick="toggleParentRow(this, 'aging-child-row-${rowIndex}')"` : ''}>
            <td><div style="display:flex; align-items:center;">${expandIcon}<strong>${k}</strong></div></td>
            <td style="text-align: center;">${v["Above 3 Months"]}</td>
            <td style="text-align: center;">${v["Above 2 Months"]}</td>
            <td style="text-align: center;">${v["Above 1 Month"]}</td>
            <td style="text-align: center;">${v["Above 15 Days"]}</td>
            <td style="text-align: center;">${v["Below 15 Days"]}</td>
            <td style="text-align: center; color: var(--danger);"><strong>${v.Total}</strong></td>
        </tr>`;

        if (hasChildren) {
            for (const [cKey, cVal] of Object.entries(v.children)) {
                tbody.innerHTML += `<tr class="child-row aging-child-row-${rowIndex}" style="display:none;">
                    <td class="child-cell" style="padding-left: 2.5rem; border-left: 2px solid var(--primary);">&#8627; ${cKey}</td>
                    <td class="child-cell" style="text-align: center;">${cVal["Above 3 Months"]}</td>
                    <td class="child-cell" style="text-align: center;">${cVal["Above 2 Months"]}</td>
                    <td class="child-cell" style="text-align: center;">${cVal["Above 1 Month"]}</td>
                    <td class="child-cell" style="text-align: center;">${cVal["Above 15 Days"]}</td>
                    <td class="child-cell" style="text-align: center;">${cVal["Below 15 Days"]}</td>
                    <td class="child-cell" style="text-align: center; color: var(--danger);"><strong>${cVal.Total}</strong></td>
                </tr>`;
            }
        }
    }

    tbody.innerHTML += `<tr style="background: rgba(0,0,0,0.05);">
        <td><strong>Grand Total</strong></td>
        <td style="text-align: center;"><strong>${grandTotals["Above 3 Months"]}</strong></td>
        <td style="text-align: center;"><strong>${grandTotals["Above 2 Months"]}</strong></td>
        <td style="text-align: center;"><strong>${grandTotals["Above 1 Month"]}</strong></td>
        <td style="text-align: center;"><strong>${grandTotals["Above 15 Days"]}</strong></td>
        <td style="text-align: center;"><strong>${grandTotals["Below 15 Days"]}</strong></td>
        <td style="text-align: center; color: var(--danger);"><strong>${grandTotals.Total}</strong></td>
    </tr>`;
}

// --- MAP & NEIGHBORS ---
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

                    let nList = neighbors.map(n => `<div class="neighbor-item">Meter: ${n.id} | <span style="color: ${n.stat === 'Reconnected' ? '#0284c7' : '#16a34a'}; font-weight: bold;">${n.stat}</span> | ${n.dist}m away</div>`).join('');
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

// --- DATA CLEANER FOR EXPORTS ---
function cleanDataForExport(dataArray, categoryType) {
    return dataArray.map(row => {
        let cleanRow = { ...row };
        
        Object.keys(cleanRow).forEach(key => {
            if (key.startsWith('_')) delete cleanRow[key];
        });

        if (['disconnected', 'pending', 'lrcf', 'disc', 'sat'].includes(categoryType)) {
            // Also hide Reconnection date for pure SAT downloads if needed, but since SAT includes reconnections, 
            // we will only scrub if the user specifically downloads 'disconnected' or 'pending'.
            if (categoryType !== 'sat') {
                delete cleanRow['Reconnection date'];
                delete cleanRow['Reconnecion date']; 
                delete cleanRow['Reconnection time'];
                delete cleanRow['Reconnection Remark'];
                delete cleanRow['RC BY'];
            }
        }
        return cleanRow;
    });
}

// --- DECORATIVE EXCEL (.xlsx) GENERATOR ---
async function triggerExcelDownload(dataArray, filename) {
    if (!dataArray || dataArray.length === 0) return alert("No data to download!");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report Data');
    const headers = Object.keys(dataArray[0]);

    worksheet.columns = headers.map(h => ({ header: h.toUpperCase(), key: h, width: 20 }));
    worksheet.addRows(dataArray);

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0284C7' } };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
    });

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { 
            row.eachCell((cell) => {
                cell.border = { top: {style:'thin', color: {argb:'FFCBD5E1'}}, left: {style:'thin', color: {argb:'FFCBD5E1'}}, bottom: {style:'thin', color: {argb:'FFCBD5E1'}}, right: {style:'thin', color: {argb:'FFCBD5E1'}} };
                cell.alignment = { vertical: 'middle', horizontal: 'left' };
            });
        }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `RCDC_${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// --- CLICK-TO-DOWNLOAD EXPORT FUNCTIONS ---
window.downloadKPIData = function(type) {
    if (!filteredData || filteredData.length === 0) return alert("No data available!");
    
    let exportData = [];
    let filename = `KPI_${type.toUpperCase()}_Data`;

    const endVal = document.getElementById('filter-end').value;
    const targetDate = endVal ? new Date(endVal).setHours(23,59,59,999) : new Date().setHours(23,59,59,999);

    filteredData.forEach(r => {
        let originalStatus = (safeGet(r, 'Status') || "").toLowerCase();
        let status = originalStatus;
        
        const rDate = parseDateString(safeGet(r, 'Reconnection date') || safeGet(r, 'Reconnecion date'));
        const rTime = rDate ? rDate.getTime() : null;

        if (originalStatus.includes('reconnected') && rTime && rTime > targetDate) {
            status = 'disconnected'; 
        }

        if (type === 'total' && r._isDValid) exportData.push(r);
        else if (type === 'reconnected' && r._isRValid && originalStatus.includes('recon')) exportData.push(r);
        else if (type === 'disconnected' && r._isBacklog && status.includes('disc')) exportData.push(r);
        else if (type === 'pending' && r._isBacklog && status.includes('pending')) exportData.push(r);
        else if (type === 'lrcf' && r._isBacklog && status.includes('lrcf')) exportData.push(r);
        else if (type === 'sat' && (safeGet(r, 'sat meters') || "").toString().trim().toUpperCase() === "SAT") exportData.push(r); // Downloads ALL SAT meters
    });

    if (exportData.length === 0) return alert("No meters found for this category!");
    
    let sanitizedData = cleanDataForExport(exportData, type);
    triggerExcelDownload(sanitizedData, filename);
};

window.downloadTodayData = function(type) {
    let dataToDownload = todayExportData[type];
    
    if (!dataToDownload || dataToDownload.length === 0) {
        return alert("No meters found in this category for today!");
    }

    let filename = type === 'disc' ? "Today_Disconnected_Meters" : "Today_RC_Requests";
    
    let sanitizedData = cleanDataForExport(dataToDownload, type);
    triggerExcelDownload(sanitizedData, filename);
};

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

// 1. Full Dashboard Image-to-PDF
async function exportFullDashboardPDF() {
    const btn = document.getElementById('export-dash-btn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ Generating...";
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const element = document.body;
        
        const canvas = await html2canvas(element, { scale: 1.5, useCORS: true, backgroundColor: "#f1f5f9" });
        const imgData = canvas.toDataURL('image/jpeg', 0.8);
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        let heightLeft = pdfHeight;
        let position = 0;
        const pageHeight = pdf.internal.pageSize.getHeight();

        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
            position = heightLeft - pdfHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, pdfHeight);
            heightLeft -= pageHeight;
        }
        
        pdf.save(`DCRC_Full_Dashboard_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
        console.error(err);
        alert("Error generating full PDF.");
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// 2. Individual Box PDF Tables & CSV (Legacy Raw Download)
function triggerCSVDownloadFallback(dataArray, filename) {
    if (!dataArray || dataArray.length === 0) return alert("No data to download!");
    const blob = new Blob([Papa.unparse(dataArray)], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `RCDC_${filename}_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
}

async function exportBoxData(type, format) {
    let exportData = filteredData;
    
    if(type === 'comm' || type === 'aging') {
        exportData = filteredData.filter(r => r._isBacklog && (safeGet(r, 'Status')||"").toLowerCase().includes('disconnected'));
    }

    if(!exportData || exportData.length === 0) return alert("No data to export!");

    if (format === 'csv') {
        triggerCSVDownloadFallback(exportData, `${type}_Raw_Data`);
    } 
    else if (format === 'pdf') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        const headers = Object.keys(exportData[0]).filter(k => !k.startsWith('_'));

        const rows = exportData.map(row => {
            return headers.map(k => {
                let val = row[k];
                return (val !== null && val !== undefined) ? String(val) : "";
            });
        });

        doc.setFontSize(14);
        doc.text(`Genus Power RCDC Raw Data - ${type.toUpperCase()}`, 14, 15);

        doc.autoTable({
            head: [headers],
            body: rows,
            startY: 22,
            theme: 'grid', 
            styles: { 
                fontSize: 7, 
                cellPadding: 2,
                font: 'helvetica',
                overflow: 'linebreak'
            },
            headStyles: { 
                fillColor: [2, 132, 199], 
                textColor: 255, 
                fontStyle: 'bold',
                halign: 'center'
            },
            alternateRowStyles: { 
                fillColor: [241, 245, 249] 
            },
            margin: { top: 20, left: 10, right: 10 }
        });

        doc.save(`RCDC_${type}_RawData_${new Date().toISOString().slice(0,10)}.pdf`);
    }
}


