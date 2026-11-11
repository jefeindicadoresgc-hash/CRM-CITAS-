// =====================================================================
// ARCHIVO: /js/logic/primerServicioLogic.js
// OBJETIVO: Procesar Libro de Ventas cruzando IDs con RTDB secundaria
// =====================================================================
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { secondaryDb } from '../config/firebaseSecondary.js';

const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
});

export async function processPrimerServicioBase(file, targetTab, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            // 1. OBTENER DICCIONARIO DE VENDEDORES DESDE LA 2DA BASE DE DATOS
            let mapVendedores = {};
            try {
                const snapshot = await get(ref(secondaryDb, 'accesorios/vendedores'));
                if (snapshot.exists()) {
                    mapVendedores = snapshot.val();
                    console.log("✅ Vendedores cargados desde RTDB:", mapVendedores);
                } else {
                    console.warn("⚠️ La ruta accesorios/vendedores existe pero está vacía.");
                }
            } catch (e) {
                console.error("❌ Bloqueo de Firebase RTDB. Revisa las 'Reglas' de tu tablero-pruebas. Error:", e);
            }

            // 2. LEER EXCEL
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawData = XLSX.utils.sheet_to_json(sheet, { range: 3, defval: "" });

            let newRecords = [];
            let discardedRecords = [];

            rawData.forEach((row, index) => {
                const cliente = String(row['NOMBRE DEL CLIENTE'] || '').trim();
                const vin = String(row['NUMERO DE SERIE'] || row['VIN'] || '').trim();
                const fechaEntrega = String(row['FECHA ENTREGA'] || '').trim();

                if (!cliente || !vin || cliente.toLowerCase().includes('totales') || cliente === "undefined" || vin === "undefined") {
                    if (cliente || vin) discardedRecords.push(`Fila ${index + 5}: Ignorada (Datos incompletos)`);
                    return;
                }

                let proximoServicioStr = "Sin Fecha";
                if (fechaEntrega && fechaEntrega !== "undefined") {
                    const parts = fechaEntrega.split('/');
                    if (parts.length === 3) {
                        let dia = parseInt(parts[0], 10);
                        let mes = parseInt(parts[1], 10) - 1;
                        let anio = parseInt(parts[2], 10);
                        if (anio < 100) anio += 2000;
                        const dateObj = new Date(anio, mes + 6, dia); 
                        proximoServicioStr = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
                    } else if (!isNaN(fechaEntrega)) { 
                        const excelDate = new Date(Math.round((fechaEntrega - 25569)*86400*1000));
                        excelDate.setMonth(excelDate.getMonth() + 6);
                        proximoServicioStr = `${String(excelDate.getDate()).padStart(2, '0')}/${String(excelDate.getMonth() + 1).padStart(2, '0')}/${excelDate.getFullYear()}`;
                    }
                }

                // =======================================================
                // LÓGICA BLINDADA PARA EL NOMBRE DEL VENDEDOR
                // =======================================================
                const rawVendedor = String(row['NOMBRE DEL VENDEDOR'] || '').trim();
                let finalVendedor = rawVendedor; // Por defecto dejamos lo que diga el Excel (Ej. WILLIAMS GIL)

                const matchRegex = rawVendedor.match(/\d+/); // Extrae los números si los hay
                if (matchRegex) {
                    const idNum = matchRegex[0];
                    if (mapVendedores && mapVendedores[idNum]) {
                        finalVendedor = mapVendedores[idNum]; // Encontró el número en Firebase
                    } else {
                        finalVendedor = "VENDEDOR DESCONOCIDO"; // Tiene número pero no está en Firebase
                    }
                } else if (!rawVendedor) {
                    finalVendedor = "SIN VENDEDOR";
                }
                // =======================================================

                let mejorTelefono = String(row['CELULAR'] || '').trim();
                if (!mejorTelefono || mejorTelefono === "undefined") mejorTelefono = String(row['TELÉFONO'] || '').trim();
                if (!mejorTelefono || mejorTelefono === "undefined") mejorTelefono = "Pendiente";

                const newClient = {
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
                };

                newRecords.push(newClient);
            });

            resolve({ newRecords, discardedRecords });
        } catch (error) { reject(error); }
    });
}