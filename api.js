// js/api.js

// Your Live Google Sheets Data
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ9VtkCQtlhnRF_uj_nMRUuagdITatNEKZ8C48sOhlNf7SeVnLXm1rvzvPHDYPDrA/pub?gid=184861049&single=true&output=csv";

async function fetchMeterData() {
    try {
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) throw new Error("Network response was not ok");
        
        const csvText = await response.text();
        
        return new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => resolve(results.data),
                error: (error) => reject(error)
            });
        });
    } catch (error) {
        console.error("Error fetching data:", error);
        return null;
    }
}