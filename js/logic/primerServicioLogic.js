// =====================================================================
// ARCHIVO: /js/logic/primerServicioLogic.js
// OBJETIVO: Procesar Libro de Ventas con cálculo exacto de +6 meses
// =====================================================================
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { secondaryDb } from '../config/firebaseSecondary.js';

//#region SECCIÓN 1: UTILIDADES DE LECTURA Y FECHAS SEGURAS
const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
});

function parseFechaVenta(val) {
    if (val === null || val === undefined || val === "") return null;

    // Caso 1: Número serial de Excel (ej. 46191 = 18/06/2026) — se calcula en UTC para evitar desfase de día
    if (typeof val === 'number' || (!isNaN(val) && String(val).trim() !== "" && !String(val).includes('/') && !String(val).includes('-'))) {
        const serial = Number(val);
        if (serial > 20000) {
            const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
            return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
        }
    }

    const str = String(val).trim();
    // Caso 2: Formato YYYY-MM-DD
    if (str.includes('-')) {
        const p = str.split('-');
        if (p.length === 3 && p[0].length === 4) {
            return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
        }
    }

    // Caso 3: Formato DD/MM/YYYY o MM/DD/YY
    if (str.includes('/')) {
        const p = str.split('/');
        if (p.length === 3) {
            let p0 = parseInt(p[0], 10);
            let p1 = parseInt(p[1], 10);
            let anio = parseInt(p[2], 10);
            if (anio < 100) anio += 2000;

            let dia = p0;
            let mes = p1;
            // Si el segundo número es > 12, viene en formato estadounidense MM/DD/YYYY
            if (p1 > 12 && p0 <= 12) {
                mes = p0;
                dia = p1;
            }
            if (!isNaN(dia) && !isNaN(mes) && !isNaN(anio)) {
                return new Date(anio, mes - 1, dia);
            }
        }
    }
    return null;
}

function sumarSeisMesesSeguro(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return "Sin Fecha";
    const lastDay = new Date(dateObj.getFullYear(), dateObj.getMonth() + 7, 0).getDate();
    const safeDay = Math.min(dateObj.getDate(), lastDay);
    const prox = new Date(dateObj.getFullYear(), dateObj.getMonth() + 6, safeDay);
    return `${String(prox.getDate()).padStart(2, '0')}/${String(prox.getMonth() + 1).padStart(2, '0')}/${prox.getFullYear()}`;
}
//#endregion

//#region SECCIÓN 2: PROCESADOR PRINCIPAL DEL LIBRO DE VENTAS
export async function processPrimerServicioBase(file, targetTab, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            // 1. Obtener diccionario de vendedores desde RTDB secundaria
            let mapVendedores = {};
            try {
                const snapshot = await get(ref(secondaryDb, 'accesorios/vendedores'));
                if (snapshot.exists()) mapVendedores = snapshot.val();
            } catch (e) {
                console.error("❌ Bloqueo de Firebase RTDB:", e);
            }

            // 2. Leer Excel preservando los números de fecha reales (raw: true por defecto)
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawData = XLSX.utils.sheet_to_json(sheet, { range: 3, defval: "" });

            let newRecords = [];
            let discardedRecords = [];

            rawData.forEach((row, index) => {
                const cliente = String(row['NOMBRE DEL CLIENTE'] || '').trim();
                const vin = String(row['NUMERO DE SERIE'] || row['VIN'] || '').trim().toUpperCase();
                const fechaEntregaRaw = row['FECHA ENTREGA'];

                if (!cliente || !vin || cliente.toLowerCase().includes('totales') || cliente === "undefined" || vin === "undefined") {
                    if (cliente || vin) discardedRecords.push(`Fila ${index + 5}: Ignorada (Datos incompletos)`);
                    return;
                }

                const fechaVentaObj = parseFechaVenta(fechaEntregaRaw);
                const proximoServicioStr = sumarSeisMesesSeguro(fechaVentaObj);

                const rawVendedor = String(row['NOMBRE DEL VENDEDOR'] || '').trim();
                let finalVendedor = rawVendedor;
                const matchRegex = rawVendedor.match(/\d+/);
                if (matchRegex) {
                    const idNum = matchRegex[0];
                    finalVendedor = (mapVendedores && mapVendedores[idNum]) ? mapVendedores[idNum] : "VENDEDOR DESCONOCIDO";
                } else if (!rawVendedor) {
                    finalVendedor = "SIN VENDEDOR";
                }

                let mejorTelefono = String(row['CELULAR'] || '').trim();
                if (!mejorTelefono || mejorTelefono === "undefined") mejorTelefono = String(row['TELÉFONO'] || '').trim();
                if (!mejorTelefono || mejorTelefono === "undefined") mejorTelefono = "Pendiente";

                newRecords.push({
                    orden: "PRIMER SERVICIO",
                    vin: vin,
                    cliente: cliente,
                    telefono: mejorTelefono,
                    ultimo_servicio: "Venta Nueva",
                    proximo_servicio: proximoServicioStr,
                    contactado: "PENDIENTE",
                    agendo: "NO",
                    paso_actual: 0,
                    llamadas: [],
                    mes_anio: mesTrabajo,
                    tab_type: targetTab,
                    auto: String(row['CARLINE'] || 'N/D').trim(),
                    modelo_anio: String(row['MODELO'] || 'N/D').trim(),
                    vendedor: finalVendedor
                });
            });

            resolve({ newRecords, discardedRecords });
        } catch (error) { reject(error); }
    });
}
//#endregion