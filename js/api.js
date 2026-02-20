// js/api.js

// Define your URLs here
const PKG_URLS = {
    pkg1: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9VtkCQtlhnRF_uj_nMRUuagdITatNEKZ8C48sOhlNf7SeVnLXm1rvzvPHDYPDrA/pub?gid=184861049&single=true&output=csv",
    pkg3: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRQb0IS5Y4uM7UDODJ_anvOkYbUaZdYToHBXHs_WNpk0P0ygzf-gct4hpGvgxfWOYJrpLrtz1xMi5XN/pub?gid=1602939724&single=true&output=csv"
};

async function fetchMeterData(pkgType = 'pkg1') {
    const url = PKG_URLS[pkgType];
    try {
        const response = await fetch(url);
        const csvText = await response.text();
        return new Promise((resolve) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                transformHeader: h => h.trim(),
                complete: (results) => resolve(results.data)
            });
        });
    } catch (error) {
        console.error("Fetch error:", error);
        return null;
    }
}
