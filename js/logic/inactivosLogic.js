// =====================================================================
// ARCHIVO: /js/logic/inactivosLogic.js
// OBJETIVO: Motor de filtrado local (Ventana de 1 a 3 Años). Exporta a Excel.
// =====================================================================

const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
});

export async function processMainBaseInactivos(file, targetTab, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            
            let rawData = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            const [yearStr, monthStr] = mesTrabajo.split('-');
            const anio = parseInt(yearStr);
            const mes = parseInt(monthStr) - 1; // Los meses en JavaScript van del 0 al 11

            // MATEMÁTICA DE LA VENTANA DE TIEMPO
            // 1. Límite Reciente: Hace exactamente 1 año 
            const limiteReciente = new Date(anio - 1, mes, 1);
            
            // 2. Límite Antiguo: Hace exactamente 3 años 
            const limiteAntiguo = new Date(anio - 3, mes, 1);

            let inactivosFiltrados = [];

            rawData.forEach((row) => {
                const cliente = String(row['NOMBRE DEL CLIENTE'] || row['CLIENTE'] || '').trim();
                const vin = String(row['NUMERO DE SERIE'] || row['No. SERIE'] || row['VIN'] || '').trim();
                const fecha = String(row['FECHA ENTREGA'] || row['FECHA'] || '').trim();

                if (!cliente || !vin || cliente.toLowerCase().includes('totales') || cliente === "undefined") return;

                let dateObj = null;
                if (fecha && fecha !== "undefined") {
                    if (fecha.includes('/')) {
                        const p = fecha.split('/');
                        dateObj = new Date(p[2].length === 2 ? "20"+p[2] : p[2], p[1]-1, p[0]);
                    } else if (!isNaN(fecha)) {
                        dateObj = new Date(Math.round((fecha - 25569)*86400*1000));
                    }
                }

                if (!dateObj) return; // Si no hay fecha válida, se salta el registro

                // ==========================================
                // FILTROS DEL COLADOR:
                // ==========================================
                // 1. Si vino hace menos de 1 año -> A la basura (Sigue siendo Activo)
                if (dateObj >= limiteReciente) return;
                
                // 2. Si vino hace más de 3 años -> A la basura (Incobrable / Muy antiguo)
                if (dateObj < limiteAntiguo) return;

                // SI LLEGA AQUÍ: Está en el rango perfecto de 1 a 3 años
                const fechaFacturaFormateada = `${String(dateObj.getDate()).padStart(2,'0')}/${String(dateObj.getMonth()+1).padStart(2,'0')}/${dateObj.getFullYear()}`;
                
                let mejorTelefono = String(row['CELULAR'] || row['TELÉFONO'] || row['TELEFONO'] || '').trim();
                if (!mejorTelefono || mejorTelefono === "undefined") mejorTelefono = "Pendiente";

                inactivosFiltrados.push({
                    "VIN": vin,
                    "CLIENTE": cliente,
                    "TELÉFONO": mejorTelefono,
                    "ÚLTIMA VISITA": fechaFacturaFormateada,
                    "AUTO": String(row['CARLINE'] || row['AUTO'] || 'N/D').trim(),
                    "MODELO": String(row['MODELO'] || 'N/D').trim(),
                    "ASESOR HISTÓRICO": String(row['NOMBRE DEL VENDEDOR'] || row['ASESOR'] || 'N/D').trim()
                });
            });

            // Ordenamos el Excel resultante para que salgan primero los más recientes dentro de la ventana
            inactivosFiltrados.sort((a, b) => {
                const d1 = a["ÚLTIMA VISITA"].split('/'); const date1 = new Date(d1[2], d1[1]-1, d1[0]);
                const d2 = b["ÚLTIMA VISITA"].split('/'); const date2 = new Date(d2[2], d2[1]-1, d2[0]);
                return date2 - date1;
            });

            resolve({ newRecords: inactivosFiltrados, discardedRecords: [] });
        } catch (error) { reject(error); }
    });
}