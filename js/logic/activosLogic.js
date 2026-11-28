// =====================================================================
// ARCHIVO: /js/logic/activosLogic.js
// OBJETIVO: Motores de procesamiento Excel para la Base Inteligente
// =====================================================================

const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
});

function parseExcelDate(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (!str || str === "undefined") return null;

    if (str.includes('/')) {
        const p = str.split('/');
        if (p.length === 3) {
            const d = parseInt(p[0], 10);
            const m = parseInt(p[1], 10) - 1;
            const y = p[2].length === 2 ? parseInt("20" + p[2], 10) : parseInt(p[2], 10);
            if (!isNaN(d) && !isNaN(m) && !isNaN(y)) return new Date(y, m, d);
        }
    }
    if (!isNaN(str) && Number(str) > 20000) {
        return new Date(Math.round((Number(str) - 25569) * 86400 * 1000));
    }
    return null;
}

function formatDateDDMMYYYY(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return "Sin Fecha";
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dateObj.getFullYear()}`;
}

//#region SECCIÓN 1: PROCESAMIENTO DE LA BASE INICIAL (Opción 1)
export async function processMainBaseActivos(file, targetTab, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false, defval: "" });

            let discardedRecords = [];

            // Calculamos el mes objetivo exacto (6 meses antes de mesTrabajo)
            const [yearStr, monthStr] = mesTrabajo.split('-');
            const targetDate = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 1);
            targetDate.setMonth(targetDate.getMonth() - 6);

            const targetYear = targetDate.getFullYear();
            const targetMonth = targetDate.getMonth();
            const endOfTargetMonth = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

            const baseObjetivoPorVin = new Map();
            const retornosPosterioresPorVin = new Map();

            // PASADA 1: Separar Mes Objetivo (hace 6 meses) vs Retornos Posteriores
            rawData.forEach((row, index) => {
                const orden = String(row['NO. ORDEN'] || row['ORDEN'] || '').trim();
                const cliente = String(row['CLIENTE'] || '').trim();
                const vin = String(row['No. SERIE'] || row['VIN'] || '').trim().toUpperCase();
                const fechaRaw = row['FECHA'] || row['FECHA FACTURA'] || '';

                if (!orden || orden.toLowerCase().includes('totales') || !cliente) {
                    discardedRecords.push(`Fila ${index + 2}: Ignorada (Orden/Cliente vacío o Totales)`);
                    return;
                }

                const dateObj = parseExcelDate(fechaRaw);
                if (!dateObj) {
                    discardedRecords.push(`Fila ${index + 2}: Ignorada (Fecha inválida: "${fechaRaw}")`);
                    return;
                }

                if (dateObj.getFullYear() === targetYear && dateObj.getMonth() === targetMonth) {
                    const key = vin || `SIN_VIN_${orden}`;
                    const prev = baseObjetivoPorVin.get(key);
                    if (!prev || dateObj >= prev.dateObj) {
                        baseObjetivoPorVin.set(key, { row, orden, cliente, vin: vin || 'N/D', dateObj });
                    }
                } else if (dateObj > endOfTargetMonth && vin) {
                    const prevRet = retornosPosterioresPorVin.get(vin);
                    if (!prevRet || dateObj >= prevRet.dateObj) {
                        retornosPosterioresPorVin.set(vin, {
                            dateObj,
                            fechaStr: formatDateDDMMYYYY(dateObj),
                            orden,
                            asesor: String(row['ASESOR'] || 'N/A').trim()
                        });
                    }
                }
            });

            // PASADA 2: Armar registros finales con fecha +6 meses y corte individual de -45 días
            let newRecords = [];
            baseObjetivoPorVin.forEach(({ row, orden, cliente, vin, dateObj }) => {
                const targetMonthLastDay = new Date(dateObj.getFullYear(), dateObj.getMonth() + 7, 0).getDate();
                const safeDay = Math.min(dateObj.getDate(), targetMonthLastDay);
                const proxDate = new Date(dateObj.getFullYear(), dateObj.getMonth() + 6, safeDay);
                const proxServicioStr = formatDateDDMMYYYY(proxDate);

                // Corte individual: 45 días antes de su próximo servicio
                const fechaCorte45 = new Date(proxDate.getFullYear(), proxDate.getMonth(), proxDate.getDate() - 45);

                const retorno = vin !== 'N/D' ? retornosPosterioresPorVin.get(vin) : null;
                const esProactivo = Boolean(retorno && retorno.dateObj < fechaCorte45);

                const newClient = {
                    orden: orden,
                    vin: vin,
                    cliente: cliente,
                    telefono: "Pendiente",
                    ultimo_servicio: "Por verificar",
                    fecha_ultima_factura: formatDateDDMMYYYY(dateObj),
                    proximo_servicio: proxServicioStr,
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
                    newClient.fecha_proactivo = retorno.fechaStr;
                    newClient.orden_proactivo = retorno.orden;
                    newClient.servicio_proactivo = "Facturó Adelantado";
                    newClient.asesor_proactivo = retorno.asesor;
                }

                newRecords.push(newClient);
            });

            resolve({ newRecords, discardedRecords });
        } catch (error) { reject(error); }
    });
}
//#endregion

//#region SECCIÓN 2: DIRECTORIO TELEFÓNICO E IMPORTES (Opción 2)
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
//#endregion

//#region SECCIÓN 3: AUDITORÍA DE CALIDAD / KMs / CORTESÍAS (Opción 3)
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
                        client.motivos_eliminacion = dataTaller.lineas.map(l => `${l.clasificacion}: ${l.descripcion}`).join(' | ');
                        pendingPurge.push(client);
                    }
                }
            });
            resolve({ verified, pendingPurge, unaffected });
        } catch (error) { reject(error); }
    });
}
//#endregion

//#region SECCIÓN 4: CITAS EFECTIVAS POR VIN (CORTE INDIVIDUAL -45 DÍAS Y SOLO NUEVOS)
export async function markEffectiveAppointments(fileFacturas, fileAsesores, currentDatabase, mesTrabajo) {
    return new Promise(async (resolve, reject) => {
        try {
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
                // Evita volver a contar y sobrescribir clientes que ya fueron marcados antes
                if (
                    client.contactado === 'CITA_EFECTIVA' ||
                    client.contactado === 'PROACTIVO' ||
                    client.contactado === 'PROACTIVO_CONFIRMADO'
                ) {
                    return;
                }

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
                    
                    const fechaFactura = parseExcelDate(dataServicio.fecha_factura);
                    const fechaProxServicio = parseExcelDate(client.proximo_servicio);

                    // Corte individual: 45 días antes de su propio proximo_servicio (Activos y Primer Servicio)
                    let estatusFinal = 'CITA_EFECTIVA';
                    if (fechaFactura && fechaProxServicio) {
                        const fechaCorte45 = new Date(
                            fechaProxServicio.getFullYear(),
                            fechaProxServicio.getMonth(),
                            fechaProxServicio.getDate() - 45
                        );
                        if (fechaFactura < fechaCorte45) {
                            estatusFinal = 'PROACTIVO';
                        }
                    }

                    let fechaPrint = fechaFactura ? formatDateDDMMYYYY(fechaFactura) : dataServicio.fecha_factura;

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
//#endregion

//#region SECCIÓN 5: CONFIRMA PREPIKING (Opción 6 - Cruce VIN en Activos y Primer Servicio)
export async function confirmPrepikingAppointments(file, allDatabase) {
    return new Promise(async (resolve, reject) => {
        try {
            const data = await readFileAsArrayBuffer(file);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            // Lectura por posición de columna (A=0, B=1 ... H=7 ... L=11)
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

            const mapVinToCita = new Map();

            rows.forEach((row) => {
                if (!Array.isArray(row) || row.length < 8) return;

                const vin = String(row[7] || '').trim().toUpperCase();      // Columna H
                const fechaRaw = String(row[1] || '').trim();               // Columna B
                const estatus = String(row[11] || '').trim().toUpperCase(); // Columna L

                // Validar VIN (17 caracteres) y descartar citas canceladas
                if (vin.length !== 17 || estatus.includes('CANCEL')) return;

                const fechaObj = parseExcelDate(fechaRaw);
                if (!fechaObj) return;

                const yyyy = fechaObj.getFullYear();
                const mm = String(fechaObj.getMonth() + 1).padStart(2, '0');
                const dd = String(fechaObj.getDate()).padStart(2, '0');
                const fechaISO = `${yyyy}-${mm}-${dd}`;
                const fechaPrint = `${dd}/${mm}/${yyyy}`;

                const prev = mapVinToCita.get(vin);
                if (!prev || fechaObj >= prev.fechaObj) {
                    mapVinToCita.set(vin, { fechaObj, fechaISO, fechaPrint });
                }
            });

            const now = new Date();
            const fechaLog = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            const updates = [];

            allDatabase.forEach((client) => {
                // Solo busca en Base Activos y Primer Servicio
                if (client.tab_type !== 'activos' && client.tab_type !== 'primer') return;

                // Solo toma clientes que aún NO tienen cita ni están cerrados
                if (
                    client.agendo === 'SI' ||
                    client.contactado === 'CITA_EFECTIVA' ||
                    client.contactado === 'PROACTIVO' ||
                    client.contactado === 'PROACTIVO_CONFIRMADO' ||
                    client.contactado === 'PERDIDO'
                ) {
                    return;
                }

                const dbVin = String(client.vin || '').trim().toUpperCase();
                const citaInfo = mapVinToCita.get(dbVin);

                if (citaInfo && client.firebaseId) {
                    const logMsg = `${fechaLog} | CITA CONFIRMADA POR PREPIKING (${citaInfo.fechaPrint}).`;
                    const nuevasLlamadas = [...(client.llamadas || []), logMsg];

                    updates.push({
                        client,
                        firebaseId: client.firebaseId,
                        data: {
                            agendo: 'SI',
                            contactado: 'PENDIENTE',
                            paso_actual: 6,
                            fecha_cita: citaInfo.fechaISO,
                            llamadas: nuevasLlamadas
                        }
                    });
                }
            });

            resolve({ updates, totalVinsExcel: mapVinToCita.size });
        } catch (error) {
            reject(error);
        }
    });
}
//#endregion