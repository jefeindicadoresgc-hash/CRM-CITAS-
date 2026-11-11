// =====================================================================
// ARCHIVO: /js/logic/activosLogic.js
// OBJETIVO: Motores de procesamiento Excel para la Base Inteligente
// =====================================================================

// Utilidad interna para leer archivos de forma segura
const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
});

// ---------------------------------------------------------
// SECCIÓN 1: PROCESAMIENTO DE LA BASE INICIAL (Opción 1)
// ---------------------------------------------------------
export async function processMainBaseActivos(file, targetTab, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: "" });

            let newRecords = [];
            let discardedRecords = [];
            
            // Calculamos la fecha límite (Hace 6 meses)
            const [year, month] = mesTrabajo.split('-');
            const targetDate = new Date(year, month - 1, 1);
            targetDate.setMonth(targetDate.getMonth() - 6);
            
            const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
            const targetMonthName = monthNames[targetDate.getMonth()].toLowerCase();
            const targetYearStr = String(targetDate.getFullYear()).slice(-2);

            rawData.forEach((row, index) => {
                const orden = String(row['NO. ORDEN'] || row['ORDEN'] || '').trim();
                const cliente = String(row['CLIENTE'] || '').trim();
                const fechaFactura = String(row['FECHA'] || row['FECHA FACTURA'] || '').trim();
                
                if (!orden || orden.toLowerCase().includes('totales') || !cliente) {
                    discardedRecords.push(`Fila ${index + 2}: Ignorada (Orden o Cliente vacío / Totales)`);
                    return;
                }

                // Determinar si es Proactivo (ya facturó recientemente)
                let esProactivo = false;
                let fechaProactivo = "";
                let ordenProactivo = "";
                let servicioProactivo = "";
                let asesorProactivo = "";

                if (fechaFactura) {
                    const monthMatch = fechaFactura.match(/([a-zA-Z]{3})\s*(\d{2})/i);
                    let rowMonth = "", rowYear = "";
                    if (monthMatch) { rowMonth = monthMatch[1].toLowerCase(); rowYear = monthMatch[2]; } 
                    else {
                        const parts = fechaFactura.split('/');
                        if (parts.length === 3) {
                            const mIndex = parseInt(parts[1]) - 1;
                            if (mIndex >= 0 && mIndex <= 11) { rowMonth = monthNames[mIndex].toLowerCase(); rowYear = parts[2].slice(-2); }
                        }
                    }

                    if (rowMonth && rowYear) {
                        if (rowYear > targetYearStr || (rowYear === targetYearStr && monthNames.findIndex(m => m.toLowerCase() === rowMonth) > targetDate.getMonth())) {
                            esProactivo = true;
                            fechaProactivo = fechaFactura;
                            ordenProactivo = orden;
                            servicioProactivo = "Facturó Adelantado";
                            asesorProactivo = row['ASESOR'] || "N/A";
                        }
                    }
                }

                const newClient = {
                    orden: esProactivo ? "" : orden,
                    vin: String(row['No. SERIE'] || row['VIN'] || 'N/D').trim(),
                    cliente: cliente,
                    telefono: "Pendiente",
                    ultimo_servicio: "Por verificar",
                    proximo_servicio: esProactivo ? "" : (row['FECHA'] || "Sin Fecha"),
                    contactado: esProactivo ? "PROACTIVO" : "PENDIENTE",
                    agendo: "NO",
                    paso_actual: 0,
                    llamadas: [],
                    mes_anio: mesTrabajo,
                    tab_type: targetTab,
                    auto: String(row['AUTO'] || row['VEHICULO'] || 'N/D').trim(),
                    modelo_anio: String(row['MODELO'] || row['AÑO'] || 'N/D').trim()
                };

                if (esProactivo) {
                    newClient.fecha_proactivo = fechaProactivo;
                    newClient.orden_proactivo = ordenProactivo;
                    newClient.servicio_proactivo = servicioProactivo;
                    newClient.asesor_proactivo = asesorProactivo;
                }
                newRecords.push(newClient);
            });

            resolve({ newRecords, discardedRecords });
        } catch (error) { reject(error); }
    });
}


// ---------------------------------------------------------
// SECCIÓN 2: DIRECTORIO TELEFÓNICO E IMPORTES (Opción 2)
// ---------------------------------------------------------
export async function enrichClientDataActivos(file, currentDatabase) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false, defval: "" });
            
            const mapaDetalles = {};
            rawData.forEach(row => {
                const orden = String(row['Orden'] || row['NO. ORDEN'] || '').trim();
                if(!orden) return;
                
                const cel = String(row['Celular'] || '').trim();
                const tel = String(row['Telefono'] || '').trim();
                let mejorTelefono = cel || tel;
                
                const importeSIVA = String(row['Importe  S/iva '] || row['Importe S/iva'] || row['Importe'] || '').trim();
                const auto = String(row['Auto'] || '').trim();
                const vin = String(row['Serie'] || row['VIN'] || '').trim();
                
                mapaDetalles[orden] = { telefono: mejorTelefono, auto: auto, vin: vin, importe: importeSIVA };
            });
            
            let recordsToUpdate = [];
            currentDatabase.forEach(client => {
                const detalles = mapaDetalles[client.orden];
                if (detalles) {
                    let updated = false;
                    if (detalles.telefono && (client.telefono === 'Pendiente' || client.telefono === '')) { client.telefono = detalles.telefono; updated = true; }
                    if (detalles.auto && client.auto === 'N/D') { client.auto = detalles.auto; updated = true; }
                    if (detalles.vin && client.vin === 'N/D') { client.vin = detalles.vin; updated = true; }
                    if (detalles.importe) { client.importe = detalles.importe; updated = true; }
                    
                    if (updated) recordsToUpdate.push(client);
                }
            });
            resolve(recordsToUpdate);
        } catch (error) { reject(error); }
    });
}


// ---------------------------------------------------------
// SECCIÓN 3: AUDITORÍA DE CALIDAD / KMs / CORTESÍAS (Opción 3)
// ---------------------------------------------------------
export async function crossReferenceServicesActivos(files, currentDatabase) {
    return new Promise(async (resolve, reject) => {
        try {
            const mapaOrdenes = {};
            
            for (let i = 0; i < files.length; i++) {
                const data = await readFileAsArrayBuffer(files[i]);
                const workbook = XLSX.read(data, { type: 'array' });
                const rawAsesores = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 3, defval: "" }); 

                rawAsesores.forEach(row => {
                    const orden = String(row['ORDEN'] || '').trim();
                    const clasificacion = String(row['CLASIFICACION'] || '').trim().toUpperCase();
                    const descripcion = String(row['DESCRIPCION'] || '').trim();
                    
                    if (orden && clasificacion) {
                        if (!mapaOrdenes[orden]) mapaOrdenes[orden] = { lineas: [] };
                        mapaOrdenes[orden].lineas.push({ clasificacion, descripcion });
                    }
                });
            }

            let pendingPurge = []; 
            let verified = []; 
            let unaffected = [];
            
            currentDatabase.forEach(client => {
                const dataTaller = mapaOrdenes[client.orden];
                
                if (!dataTaller) { 
                    unaffected.push(client); 
                } else {
                    const lineasMantenimiento = dataTaller.lineas.filter(linea => linea.clasificacion === 'MO DE MANTENIMIENTO');
                    
                    if (lineasMantenimiento.length > 0) {
                        let maxKms = -1; let mejorServicio = "Mantenimiento"; 
                        lineasMantenimiento.forEach(linea => {
                            const match = linea.descripcion.match(/([\d,]+)\s*KMS/i);
                            if (match) {
                                const kmsNumber = parseInt(match[1].replace(/,/g, '')); 
                                if (kmsNumber > maxKms) { maxKms = kmsNumber; mejorServicio = linea.descripcion; }
                            } else { if(maxKms === -1) mejorServicio = linea.descripcion; }
                        });
                        
                        client.ultimo_servicio = mejorServicio; 
                        verified.push(client);
                    } else {
                        // Si no hay mantenimiento, se va a papelera (Cortesía, Pintura, etc)
                        client.motivos_eliminacion = dataTaller.lineas.map(l => `${l.clasificacion}: ${l.descripcion}`).join(' | ');
                        pendingPurge.push(client);
                    }
                }
            });
            resolve({ verified, pendingPurge, unaffected });
        } catch (error) { reject(error); }
    });
}


// ---------------------------------------------------------
// SECCIÓN 4: CITAS EFECTIVAS POR VIN (15 DÍAS DE CORTE)
// ---------------------------------------------------------
export async function markEffectiveAppointments(fileFacturas, fileAsesores, currentDatabase, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            // Lógica matemática del corte: Día 15 del mes ANTERIOR al seleccionado
            const [yearStr, monthStr] = mesTrabajo.split('-');
            // Restamos 2: JS maneja meses de 0 a 11. Restamos 1 para el mes actual, y 1 más para el mes pasado.
            const fechaCorteProactivo = new Date(parseInt(yearStr), parseInt(monthStr) - 2, 15);

            const dataFacturas = await readFileAsArrayBuffer(fileFacturas);
            const wbFacturas = XLSX.read(dataFacturas, { type: 'array' });
            const rawFacturas = XLSX.utils.sheet_to_json(wbFacturas.Sheets[wbFacturas.SheetNames[0]], { defval: "" });

            const mapFacturaData = {};
            rawFacturas.forEach(row => {
                const factura = String(row['Factura'] || '').trim().toUpperCase();
                const vin = String(row['No. SERIE'] || row['VIN'] || '').trim().toUpperCase();
                const fechaFac = String(row['FECHA'] || '').trim();
                if (factura && vin) mapFacturaData[factura] = { vin: vin, fechaFac: fechaFac };
            });

            const dataAsesores = await readFileAsArrayBuffer(fileAsesores);
            const wbAsesores = XLSX.read(dataAsesores, { type: 'array' });
            const rawAsesores = XLSX.utils.sheet_to_json(wbAsesores.Sheets[wbAsesores.SheetNames[0]], { range: 3, defval: "" }); 

            const mapVinToServicio = {};
            rawAsesores.forEach(row => {
                const factura = String(row['NO.FACTURA'] || '').trim().toUpperCase();
                const clasificacion = String(row['CLASIFICACION'] || '').trim().toUpperCase();
                const descripcion = String(row['DESCRIPCION'] || '').trim();

                if (factura && clasificacion === 'MO DE MANTENIMIENTO') {
                    const facData = mapFacturaData[factura];
                    if (facData && facData.vin) {
                        if (!mapVinToServicio[facData.vin]) mapVinToServicio[facData.vin] = { descripciones: [], fecha_factura: facData.fechaFac };
                        mapVinToServicio[facData.vin].descripciones.push(descripcion);
                    }
                }
            });

            let verifiedRecords = [];
            currentDatabase.forEach(client => {
                const dbVin = String(client.vin || '').trim().toUpperCase();
                const dataServicio = mapVinToServicio[dbVin];
                
                if (dataServicio && dataServicio.descripciones.length > 0) {
                    let maxKms = -1; let mejorServicio = "Mantenimiento Confirmado"; 
                    
                    dataServicio.descripciones.forEach(desc => {
                        const match = desc.match(/([\d,]+)\s*KMS/i);
                        if (match) {
                            const kmsNumber = parseInt(match[1].replace(/,/g, '')); 
                            if (kmsNumber > maxKms) { maxKms = kmsNumber; mejorServicio = desc; }
                        } else { if(maxKms === -1) mejorServicio = desc; }
                    });
                    
                    // Convertir la fecha de la factura para comparar con el corte de los 15 días
                    let fechaComparacion = null;
                    const fStr = dataServicio.fecha_factura;
                    if (fStr && fStr.includes('/')) {
                        const p = fStr.split('/');
                        fechaComparacion = new Date(p[2], p[1]-1, p[0]);
                    } else if (!isNaN(fStr)) {
                        fechaComparacion = new Date(Math.round((fStr - 25569)*86400*1000));
                    }

                    // Motor de Decisión: Proactivo o Efectiva
                    let estatusFinal = 'CITA_EFECTIVA';
                    if (fechaComparacion && fechaComparacion <= fechaCorteProactivo) {
                        estatusFinal = 'PROACTIVO';
                    }

                    let fechaPrint = fechaComparacion ? `${String(fechaComparacion.getDate()).padStart(2,'0')}/${String(fechaComparacion.getMonth()+1).padStart(2,'0')}/${fechaComparacion.getFullYear()}` : fStr;

                    verifiedRecords.push({
                        firebaseId: client.firebaseId,
                        servicio_realizado: mejorServicio, 
                        fecha_factura_efectiva: fechaPrint,
                        contactado: estatusFinal
                    });
                }
            });
            
            resolve(verifiedRecords);
        } catch (error) { reject(error); }
    });
}