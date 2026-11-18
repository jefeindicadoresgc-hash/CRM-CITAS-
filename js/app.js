//#region SECCIÓN 1: IMPORTS DE MÓDULOS Y DEPENDENCIAS
// ---------------------------------------------------------
// SECCIÓN 1: IMPORTS DE MÓDULOS Y DEPENDENCIAS (CACHE-BUSTER 2.4)
// ---------------------------------------------------------
import { db, collection, getDocs, doc, writeBatch, updateDoc } from './config/firebaseConfig.js';
import { processMainBaseActivos, crossReferenceServicesActivos, enrichClientDataActivos, markEffectiveAppointments } from './logic/activosLogic.js?v=2.4';
import { processPrimerServicioBase } from './logic/primerServicioLogic.js?v=2.4';
import { processMainBaseInactivos } from './logic/inactivosLogic.js?v=2.4';
import { initAuth, adminMode } from './auth/accessController.js?v=2.4';
import { initPipelineManager } from './ui/pipelineManager.js?v=2.4';
//#endregion

//#region SECCIÓN 2: ESTADO GLOBAL Y MEMORIA EN TIEMPO REAL
// ---------------------------------------------------------
// SECCIÓN 2: ESTADO GLOBAL Y MEMORIA EN TIEMPO REAL
// ---------------------------------------------------------
let database = []; 
let activeTab = 'activos';
let papeleraSubTab = 'activos'; 
let currentFilter = 'all'; 

let tempSafeDatabase = []; let tempPendingPurge = []; let tempNewRecords = [];

const tableBody = document.getElementById('table-body'); 
const uploadStatus = document.getElementById('upload-status');
const inputMesFiltro = document.getElementById('mes-filtro');

inputMesFiltro.addEventListener('change', renderTable);
//#endregion

//#region SECCIÓN 3: RUTINAS DE INICIALIZACIÓN (BOOT)
// ---------------------------------------------------------
// SECCIÓN 3: RUTINAS DE INICIALIZACIÓN (BOOT)
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const uploadInput = document.getElementById('upload-mes');
    
    if(uploadInput) uploadInput.value = currentMonthStr;
    if(inputMesFiltro) inputMesFiltro.value = currentMonthStr;

    initAuth(syncWithFirebase, renderTable);
    initPipelineManager(database, syncWithFirebase, renderTable);
});
//#endregion

//#region SECCIÓN 4: CONEXIÓN A FIREBASE Y DESCARGA MASIVA
// ---------------------------------------------------------
// SECCIÓN 4: CONEXIÓN A FIREBASE Y DESCARGA MASIVA
// ---------------------------------------------------------
async function syncWithFirebase() {
    uploadStatus.textContent = "Sincronizando con la nube ☁️...";
    try {
        const querySnapshot = await getDocs(collection(db, "clientes"));
        database.length = 0; 
        querySnapshot.forEach((docSnap) => {
            database.push({ firebaseId: docSnap.id, ...docSnap.data() });
        });
        renderTable();
        uploadStatus.textContent = "Nube sincronizada ✅";
        setTimeout(() => uploadStatus.textContent = "", 3000);
    } catch (e) {
        console.error("Error Firebase:", e);
        uploadStatus.textContent = "Error de conexión a la nube.";
    }
}
//#endregion

//#region SECCIÓN 5: CONTROLADORES DE PESTAÑAS (TABS)
// ---------------------------------------------------------
// SECCIÓN 5: CONTROLADORES DE PESTAÑAS (TABS)
// ---------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); activeTab = btn.getAttribute('data-target');
        
        if (activeTab === 'papelera') {
            document.getElementById('table-title').textContent = "Papelera de Reciclaje";
            document.getElementById('view-filters').classList.add('hidden'); 
            document.getElementById('stats-panel').classList.add('hidden'); 
            document.getElementById('papelera-filters').classList.remove('hidden');
        } else {
            document.getElementById('table-title').textContent = "Directorio de Clientes";
            document.getElementById('stats-panel').classList.remove('hidden'); 
            document.getElementById('view-filters').classList.remove('hidden'); 
            document.getElementById('papelera-filters').classList.add('hidden');
        }
        
        uploadStatus.textContent = ""; 
        renderTable();
    });
});

document.querySelectorAll('.btn-pap-sub').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-pap-sub').forEach(b => b.classList.remove('active')); 
        e.target.classList.add('active');
        papeleraSubTab = e.target.getAttribute('data-sub'); 
        renderTable();
    });
});
//#endregion

//#region SECCIÓN 6: FILTROS DEL EMBUDO (PIPELINE ESTADOS)
// ---------------------------------------------------------
// SECCIÓN 6: FILTROS DEL EMBUDO (PIPELINE ESTADOS)
// ---------------------------------------------------------
const filtersIds = ['filter-all', 'filter-proactivos', 'filter-reactivos', 'filter-agendados', 'filter-efectivas', 'filter-perdidos', 'filter-demorados'];

filtersIds.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('click', (e) => { 
        currentFilter = id.replace('filter-', ''); 
        updateFilterButtons(e.target); 
        renderTable(); 
    });
});

function updateFilterButtons(activeBtn) {
    filtersIds.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
}
document.getElementById('search-input').addEventListener('input', renderTable);
//#endregion

//#region SECCIÓN 7: RUTINAS DE CARGA Y LIMPIEZA (PANEL ADMIN 0520)
// ---------------------------------------------------------
// SECCIÓN 7: RUTINAS DE CARGA Y LIMPIEZA (PANEL ADMIN 0520)
// ---------------------------------------------------------
document.getElementById('btn-process-excel').addEventListener('click', async () => {
    const adminPass = prompt("Ingresa la clave de Autorización (4 dígitos) para subir la base:");
    if (adminPass !== "2099") return alert("Clave incorrecta. Operación cancelada.");
    const file = document.getElementById('excel-upload').files[0];
    const mesTrabajo = document.getElementById('upload-mes').value; 
    if (!mesTrabajo || !file) return alert("Por favor, selecciona el mes de trabajo y el archivo.");
    
    uploadStatus.textContent = "Analizando archivo... ⏳"; 
    try {
        let result;
        
        // =========================================================
        // MOTOR LOCAL PARA INACTIVOS (0 FIREBASE, CREA EXCEL)
        // =========================================================
        if (activeTab === 'inactivos') {
            result = await processMainBaseInactivos(file, activeTab, mesTrabajo);
            
            if (result.newRecords.length > 0) {
                uploadStatus.textContent = "Generando Excel limpio... 📊";
                
                // Crea y descarga el archivo Excel sin tocar la nube
                const ws = XLSX.utils.json_to_sheet(result.newRecords);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "Inactivos_1a3_Anos");
                XLSX.writeFile(wb, `Base_Inactivos_Filtrada_${mesTrabajo}.xlsx`);
                
                uploadStatus.textContent = `✅ ¡Excel descargado! (${result.newRecords.length} clientes encontrados).`;
                alert(`¡Filtrado Local Exitoso!\n\nSe analizó el historial y se encontraron ${result.newRecords.length} clientes en el rango exacto de 1 a 3 años de inactividad.\n\nSe descargó el Excel a tu computadora. Tu cuota de Firebase está 100% intacta.`);
            } else {
                uploadStatus.textContent = "No se encontraron clientes en el rango de 1 a 3 años.";
                alert("No hay clientes que cumplan con la ventana de 1 a 3 años en este archivo.");
            }
            return; // 🛑 DETIENE EL CÓDIGO AQUÍ. JAMÁS SUBIRÁ A FIREBASE.
        }
        // =========================================================

        // Flujo normal para Activos y Primer Servicio (Sí suben a Firebase)
        if (activeTab === 'primer') {
            result = await processPrimerServicioBase(file, activeTab, mesTrabajo);
        } else {
            result = await processMainBaseActivos(file, activeTab, mesTrabajo);
        }
        
        tempNewRecords = result.newRecords;
        if (result.discardedRecords.length > 0) {
            document.getElementById('base-report-list').innerHTML = '<ul>' + result.discardedRecords.map(msg => `<li>${msg}</li>`).join('') + '</ul>';
            document.getElementById('base-report-modal').classList.remove('hidden');
        } else { finalizeBaseUpload(); }
    } catch (err) { uploadStatus.textContent = "Error al procesar el archivo."; console.error(err);}
});

// FUNCIÓN DE CARGA A FIREBASE (Para Activos y Primer Servicio)
async function finalizeBaseUpload() {
    console.log("🟢 [DEBUG 1] Iniciando finalizeBaseUpload.");
    if (tempNewRecords.length === 0) {
        document.getElementById('base-report-modal').classList.add('hidden');
        return;
    }

    try {
        const chunkSize = 400; 
        const totalLotes = Math.ceil(tempNewRecords.length / chunkSize);
        console.log(`🟢 [DEBUG 2] Fragmentando carga en ${totalLotes} lotes de ${chunkSize}.`);
        
        uploadStatus.textContent = `Preparando ${tempNewRecords.length} clientes en ${totalLotes} lotes... ☁️`;

        for (let i = 0; i < tempNewRecords.length; i += chunkSize) {
            const batch = writeBatch(db);
            const chunk = tempNewRecords.slice(i, i + chunkSize);
            
            chunk.forEach(record => { 
                batch.set(doc(collection(db, "clientes")), record); 
            });
            
            const loteActual = Math.floor(i / chunkSize) + 1;
            console.log(`🔵 [DEBUG 3] Empujando lote ${loteActual} de ${totalLotes}...`);
            uploadStatus.textContent = `Subiendo lote ${loteActual} de ${totalLotes}... ⏳`;
            
            const commitPromise = batch.commit();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT_FIREBASE")), 10000));

            await Promise.race([commitPromise, timeoutPromise]);
            console.log(`✅ [DEBUG 4] Lote ${loteActual} guardado exitosamente.`);
            
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        console.log("🟢 [DEBUG 5] Limpiando memoria y sincronizando.");
        document.getElementById('base-report-modal').classList.add('hidden'); 
        tempNewRecords = [];
        document.getElementById('mes-filtro').value = document.getElementById('upload-mes').value;
        
        uploadStatus.textContent = "Sincronizando tabla final... 🔄";
        await syncWithFirebase(); 
        
        alert("✅ Carga masiva completada con éxito.");
        uploadStatus.textContent = "";

    } catch (error) {
        console.error("❌ [DEBUG ERROR FATAL] El proceso reventó aquí:", error);
        
        if (error.message === "TIMEOUT_FIREBASE" || String(error).includes("resource-exhausted")) {
            uploadStatus.textContent = "Error: Límite diario de Firebase alcanzado.";
            alert("⚠️ BLOQUEO DE FIREBASE:\nHas superado el límite de operaciones gratuitas por día.\n\nEl sistema detuvo la carga para evitar fallos. El saldo se reinicia a la medianoche.");
        } else {
            uploadStatus.textContent = "Error inesperado al subir la base.";
            alert("⚠️ Ocurrió un error inesperado al subir la base. Revisa la consola (F12) para más detalles.");
        }
    }
}

document.getElementById('btn-confirm-base').addEventListener('click', finalizeBaseUpload);
document.getElementById('btn-cancel-base').addEventListener('click', () => { document.getElementById('base-report-modal').classList.add('hidden'); tempNewRecords = []; });

const btnTelefonos = document.getElementById('btn-process-telefonos');
if(btnTelefonos) {
    btnTelefonos.addEventListener('click', async () => {
        const file = document.getElementById('excel-telefonos').files[0];
        if (!file) return alert("Selecciona el archivo 'otras ordenes.xls'.");
        uploadStatus.textContent = "Extrayendo números de teléfono e importes ⏳..."; 
        try {
            const recordsToUpdate = await enrichClientDataActivos(file, database.filter(d => d.tab_type === activeTab));
            const batch = writeBatch(db);
            recordsToUpdate.forEach(c => { 
                if(c.firebaseId) {
                    let updateData = { telefono: c.telefono, auto: c.auto, vin: c.vin };
                    if(c.importe) updateData.importe = c.importe;
                    batch.update(doc(db, "clientes", c.firebaseId), updateData); 
                }
            });
            await batch.commit(); uploadStatus.textContent = "Directorio actualizado ✅"; await syncWithFirebase();
        } catch (err) { console.error(err); }
    });
}

document.getElementById('btn-process-asesores').addEventListener('click', async () => {
    const files = document.getElementById('excel-asesores').files;
    if (files.length === 0) return alert("Selecciona los archivos para Filtrar Asesores."); 
    uploadStatus.textContent = "Cruzando asesores y purgando... ⏳"; 
    try {
        const result = await crossReferenceServicesActivos(files, database.filter(d => d.tab_type === activeTab));
        tempSafeDatabase = [...result.verified, ...result.unaffected]; tempPendingPurge = result.pendingPurge;
        if (tempPendingPurge.length > 0) {
            let reportHtml = '';
            tempPendingPurge.forEach((c, index) => { reportHtml += `<label class="purge-item"><input type="checkbox" class="purge-checkbox" data-index="${index}" checked><div><strong>${c.cliente} (${c.orden})</strong><br><span style="color:#666;">${c.motivos_eliminacion}</span></div></label>`; });
            document.getElementById('report-list').innerHTML = reportHtml;
            document.getElementById('purge-counter').textContent = `${tempPendingPurge.length} seleccionados`;
            document.querySelectorAll('.purge-checkbox').forEach(chk => chk.addEventListener('change', () => { document.getElementById('purge-counter').textContent = `${document.querySelectorAll('.purge-checkbox:checked').length} seleccionados`; }));
            document.getElementById('report-modal').classList.remove('hidden');
        } else {
            const batch = writeBatch(db);
            tempSafeDatabase.forEach(c => { if(c.firebaseId) { let updateObj = { ultimo_servicio: c.ultimo_servicio, contactado: c.contactado }; if (c.servicio_proactivo) updateObj.servicio_proactivo = c.servicio_proactivo; batch.update(doc(db, "clientes", c.firebaseId), updateObj); } });
            await batch.commit(); await syncWithFirebase();
        }
    } catch (err) { console.error(err); }
});

document.getElementById('btn-confirm-purge').addEventListener('click', async () => {
    uploadStatus.textContent = "Actualizando base de datos ☁️...";
    const batch = writeBatch(db);
    document.querySelectorAll('.purge-checkbox').forEach((chk, index) => {
        const client = tempPendingPurge[index];
        if (chk.checked && client.firebaseId) batch.update(doc(db, "clientes", client.firebaseId), { tab_type: 'papelera', old_tab: activeTab });
    });
    tempSafeDatabase.forEach(client => {
        if(client.firebaseId) { let updateObj = { ultimo_servicio: client.ultimo_servicio, contactado: client.contactado }; if (client.servicio_proactivo) updateObj.servicio_proactivo = client.servicio_proactivo; batch.update(doc(db, "clientes", client.firebaseId), updateObj); }
    });
    await batch.commit(); document.getElementById('report-modal').classList.add('hidden'); await syncWithFirebase();
});
document.getElementById('btn-cancel-report').addEventListener('click', () => { document.getElementById('report-modal').classList.add('hidden'); });

const btnEfectivas = document.getElementById('btn-process-efectivas');
if (btnEfectivas) {
    btnEfectivas.addEventListener('click', async () => {
        const fileFacturas = document.getElementById('excel-facturas').files[0];
        const fileAsesores = document.getElementById('excel-efectivas').files[0];
        const mesTrabajo = document.getElementById('upload-mes').value; 
        
        if (!fileFacturas || !fileAsesores || !mesTrabajo) return alert("Debes seleccionar el mes y subir ambos archivos."); 
        
        uploadStatus.textContent = "Analizando Facturas y VINs... ⏳"; 
        try {
            const resultUpdates = await markEffectiveAppointments(fileFacturas, fileAsesores, database.filter(d => d.tab_type === activeTab), mesTrabajo);
            
            if (resultUpdates.length > 0) {
                const batch = writeBatch(db);
                resultUpdates.forEach(updateObj => { 
                    batch.update(doc(db, "clientes", updateObj.firebaseId), {
                        servicio_realizado: updateObj.servicio_realizado, 
                        fecha_factura_efectiva: updateObj.fecha_factura_efectiva, 
                        contactado: updateObj.contactado 
                    }); 
                });
                await batch.commit(); 
                await syncWithFirebase();
                alert(`✅ ¡ÉXITO! Se marcaron ${resultUpdates.length} servicios cruzados exitosamente.`);
            } else {
                alert("⚠️ No se encontraron coincidencias para Citas.");
                uploadStatus.textContent = "";
            }
        } catch (err) { console.error(err); uploadStatus.textContent = "Error al procesar el Cruce Taller."; }
    });
}

// =========================================================
// FUNCIÓN DE PURGADO A BÓVEDA
// =========================================================
const btnClearSmart = document.getElementById('btn-clear-data-smart');
if (btnClearSmart) {
    btnClearSmart.addEventListener('click', async () => {
        const mesTrabajo = document.getElementById('upload-mes').value;
        if (!mesTrabajo) return alert("Primero selecciona el 'Mes a trabajar' en la Tarjeta 1.");

        const targetTab = activeTab === 'papelera' ? papeleraSubTab : activeTab;
        const registrosABorrar = database.filter(d => 
            (d.tab_type === targetTab && d.mes_anio === mesTrabajo) || 
            (d.tab_type === 'papelera' && d.old_tab === targetTab && d.mes_anio === mesTrabajo)
        );

        if (registrosABorrar.length === 0) return alert(`No hay registros para purgar.`);
        if (prompt("⚠️ ZONA DE PELIGRO ⚠️\nPara continuar, ingresa tu clave:") !== "2099") return alert("Clave incorrecta.");
        if (!confirm(`⚠️ Estás a punto de ELIMINAR ${registrosABorrar.length} clientes. ¿Seguro de continuar?`)) return;

        uploadStatus.textContent = `Moviendo ${registrosABorrar.length} registros a la Bóveda... ⏳`;
        try {
            const hoy = new Date();
            const caducidad = new Date(hoy); caducidad.setDate(caducidad.getDate() + 30);
            let currentBatch = writeBatch(db); let operationCount = 0; let batchPromises = [];

            registrosABorrar.forEach((client) => {
                if (client.firebaseId) {
                    const backupRef = doc(collection(db, "respaldo_emergencia"), client.firebaseId);
                    currentBatch.set(backupRef, { ...client, fecha_ingreso_boveda: hoy.toISOString(), fecha_caducidad: caducidad.toISOString() });
                    const mainRef = doc(db, "clientes", client.firebaseId);
                    currentBatch.delete(mainRef);
                    operationCount += 2; 

                    if (operationCount >= 400) {
                        batchPromises.push(currentBatch.commit());
                        currentBatch = writeBatch(db); operationCount = 0;
                    }
                }
            });
            if (operationCount > 0) batchPromises.push(currentBatch.commit());
            await Promise.all(batchPromises);
            await syncWithFirebase();
            alert(`✅ Limpieza Exitosa. Registros enviados a la Bóveda.`); uploadStatus.textContent = "";
        } catch (error) { console.error(error); uploadStatus.textContent = "Error al limpiar la nube."; }
    });
}
//#endregion

//#region SECCIÓN 8: MOTOR DE MATEMÁTICA Y DIBUJO DE TABLA
// ---------------------------------------------------------
// SECCIÓN 8: MOTOR DE MATEMÁTICA Y DIBUJO DE TABLA
// ---------------------------------------------------------
function calculateNextContact(client) {
    if (!client.proximo_servicio || client.proximo_servicio === "Sin Fecha") return { dateObj: null, text: 'N/D', isOverdue: false };
    const p = client.proximo_servicio.split('/');
    if (p.length !== 3) return { dateObj: null, text: 'N/D', isOverdue: false };
    const targetDate = new Date(p[2], p[1]-1, p[0]);
    let step = client.paso_actual || 0;
    
    let diasRestar = [45, 30, 21, 15, 11, 3, 0]; 
    if (client.tab_type === 'inactivos') diasRestar = [15, 0]; 
    
    let daysToSub = (step >= 0 && step < diasRestar.length) ? diasRestar[step] : 0;
    targetDate.setDate(targetDate.getDate() - daysToSub);
    const dd = String(targetDate.getDate()).padStart(2, '0'); 
    const mm = String(targetDate.getMonth()+1).padStart(2, '0');
    const today = new Date(); today.setHours(0,0,0,0);
    return { dateObj: targetDate, text: `${dd}/${mm}/${targetDate.getFullYear()}`, isOverdue: targetDate <= today };
}

function renderTable() {
    const panelTitle = document.getElementById('title-upload-base');
    const panelDesc = document.getElementById('desc-upload-base');
    const panelOp2 = document.getElementById('panel-opcion-2');
    const panelOp3 = document.getElementById('panel-opcion-3');
    const panelOp4 = document.getElementById('panel-opcion-4'); 
    const btnProcess = document.getElementById('btn-process-excel'); 
    
    if (activeTab === 'papelera' || !adminMode) {
        document.getElementById('upload-panel').classList.add('hidden');
    } else if (adminMode && (activeTab === 'activos' || activeTab === 'primer' || activeTab === 'inactivos')) {
        document.getElementById('upload-panel').classList.remove('hidden');
        if (panelTitle && panelDesc) {
            if (activeTab === 'primer') {
                panelTitle.textContent = "1. Subir Libro de Ventas";
                panelDesc.textContent = "(Calcula 6 meses desde Fecha Entrega)";
                if(btnProcess) btnProcess.textContent = "Procesar Base";
                if(panelOp2) panelOp2.classList.add('hidden');
                if(panelOp3) panelOp3.classList.add('hidden');
                if(panelOp4) panelOp4.classList.remove('hidden');
            } else if (activeTab === 'inactivos') {
                panelTitle.textContent = "1. Generar Filtro Histórico";
                panelDesc.textContent = "(Descarga Excel: Ventana de 1 a 3 años. No sube a la nube)";
                if(btnProcess) btnProcess.textContent = "Descargar Excel Filtrado"; 
                if(panelOp2) panelOp2.classList.remove('hidden');
                if(panelOp3) panelOp3.classList.remove('hidden');
                if(panelOp4) panelOp4.classList.add('hidden'); 
            } else {
                panelTitle.textContent = "1. Subir Base (Clave 2099)";
                panelDesc.textContent = "(Filtra a 6 meses y detecta Proactivos)";
                if(btnProcess) btnProcess.textContent = "Procesar Base";
                if(panelOp2) panelOp2.classList.remove('hidden');
                if(panelOp3) panelOp3.classList.remove('hidden');
                if(panelOp4) panelOp4.classList.remove('hidden');
            }
        }
    }

    const mesActual = inputMesFiltro.value;
    let baseData = activeTab === 'papelera' ? database.filter(d => d.tab_type === 'papelera' && d.old_tab === papeleraSubTab) : database.filter(d => d.tab_type === activeTab && d.mes_anio === mesActual);
    
    if (activeTab !== 'papelera') {
        const statTotal = document.getElementById('stat-total');
        if(statTotal) statTotal.textContent = baseData.length;
        
        const statReact = document.getElementById('stat-reactivos');
        // AHORA EXCLUIMOS A LOS DEMORADOS DE LA LISTA DE REACTIVOS
        if(statReact) statReact.textContent = baseData.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.contactado !== 'DEMORADO' && d.agendo !== 'SI').length;
        
        const statAgen = document.getElementById('stat-agendados');
        if(statAgen) statAgen.textContent = baseData.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA').length;
        
        const statEfec = document.getElementById('stat-efectivas');
        if(statEfec) statEfec.textContent = baseData.filter(d => d.contactado === 'CITA_EFECTIVA').length;
        
        const statPro = document.getElementById('stat-proactivos');
        if(statPro) statPro.textContent = baseData.filter(d => d.contactado === 'PROACTIVO' || d.contactado === 'PROACTIVO_CONFIRMADO').length;
        
        const statPer = document.getElementById('stat-perdidos');
        if(statPer) statPer.textContent = baseData.filter(d => d.contactado === 'PERDIDO').length;
    }
    
    let dataToShow = [...baseData];
    
    if (activeTab !== 'papelera') {
        if (currentFilter === 'proactivos') {
            dataToShow = dataToShow.filter(d => d.contactado === 'PROACTIVO' || d.contactado === 'PROACTIVO_CONFIRMADO');
            dataToShow.sort((a, b) => {
                const parseDate = (dStr) => { if(!dStr) return 0; const p = String(dStr).split('/'); return p.length===3 ? new Date(p[2], p[1]-1, p[0]).getTime() : 0; };
                return parseDate(b.fecha_proactivo) - parseDate(a.fecha_proactivo);
            });
        } 
        else if (currentFilter === 'reactivos') {
            // EXCLUYE DEMORADOS
            dataToShow = dataToShow.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.contactado !== 'DEMORADO' && d.agendo !== 'SI');
            dataToShow.sort((a, b) => (calculateNextContact(a).dateObj || new Date(2100,0,1)) - (calculateNextContact(b).dateObj || new Date(2100,0,1)));
        }
        else if (currentFilter === 'demorados') {
            // NUEVO FILTRO: DEMORADOS
            dataToShow = dataToShow.filter(d => d.contactado === 'DEMORADO');
            dataToShow.sort((a, b) => (calculateNextContact(a).dateObj || new Date(2100,0,1)) - (calculateNextContact(b).dateObj || new Date(2100,0,1)));
        }
        else if (currentFilter === 'agendados') {
            dataToShow = dataToShow.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA');
            dataToShow.sort((a, b) => (a.fecha_cita ? new Date(a.fecha_cita).getTime() : 0) - (b.fecha_cita ? new Date(b.fecha_cita).getTime() : 0));
        }
        else if (currentFilter === 'efectivas') { 
            dataToShow = dataToShow.filter(d => d.contactado === 'CITA_EFECTIVA'); 
            // NUEVA LÓGICA: ORDENAR POR FECHA FACTURA DESCENDENTE (Más reciente arriba)
            dataToShow.sort((a, b) => {
                const parseDate = (dStr) => { 
                    if(!dStr || typeof dStr !== 'string' || dStr === 'Sin Fecha') return 0; 
                    const p = dStr.split('/'); 
                    return p.length === 3 ? new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0])).getTime() : 0; 
                };
                return parseDate(b.fecha_factura_efectiva) - parseDate(a.fecha_factura_efectiva);
            });
        }
        else if (currentFilter === 'perdidos') { 
            dataToShow = dataToShow.filter(d => d.contactado === 'PERDIDO'); 
        }
    }

    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
    if (searchTerm !== "") { 
        dataToShow = dataToShow.filter(d => String(d.orden || '').toLowerCase().includes(searchTerm) || String(d.vin || '').toLowerCase().includes(searchTerm) || String(d.cliente || '').toLowerCase().includes(searchTerm)); 
    }
    
    const thead = document.querySelector('.corp-table thead');
    let extraHeaders = ''; 
    let dynamicDateCol = '<th>PRÓXIMO (6M)</th>';
    let statusHeader = '<th>ESTATUS</th>';
    let actionHeader = '<th style="text-align: right;">ACCIÓN</th>';

    if (activeTab === 'primer' && currentFilter !== 'efectivas' && currentFilter !== 'perdidos') {
        extraHeaders = '<th>VENDEDOR</th>';
    } else if (currentFilter === 'proactivos' && activeTab === 'activos') { 
        extraHeaders = '<th>ASESOR</th>'; 
    } 
    
    if (activeTab === 'inactivos' && (currentFilter === 'reactivos' || currentFilter === 'demorados')) {
        dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
        statusHeader = '<th>AÑO ÚLTIMA VISITA</th>'; 
    } else if (currentFilter === 'proactivos') {
        if (activeTab === 'primer') { dynamicDateCol = '<th style="color:#ff9f0a;">FECHA FACTURA</th>'; statusHeader = ''; actionHeader = ''; } 
        else { dynamicDateCol = '<th>FECHA SERVICIO</th>'; }
    } else if (currentFilter === 'reactivos' || currentFilter === 'demorados') { 
        dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
    } else if (currentFilter === 'agendados') { 
        dynamicDateCol = '<th>FECHA CITA</th>'; if (adminMode) extraHeaders += '<th>RETORNO</th>'; 
    } else if (currentFilter === 'efectivas') { 
        dynamicDateCol = '<th style="color:#34c759;">SERVICIO REALIZADO</th>'; 
        statusHeader = '<th style="color:#34c759;">FECHA FACTURA</th>'; actionHeader = ''; 
    } else if (currentFilter === 'perdidos') { 
        dynamicDateCol = '<th>MOTIVO PÉRDIDA</th>'; if (!adminMode) actionHeader = ''; 
    }
    
    thead.innerHTML = `<tr><th>ORDEN / VIN</th><th>CLIENTE</th><th>TELÉFONO</th>${extraHeaders}<th>ÚLTIMO SERVICIO</th>${dynamicDateCol}${statusHeader}${actionHeader}</tr>`;

    if (dataToShow.length === 0) { tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#86868b; padding: 40px;">No hay registros en esta etapa.</td></tr>`; return; }
    
    let html = '';
    dataToShow.forEach((d) => {
        const realIndex = database.findIndex(x => x.firebaseId === d.firebaseId);
        
        let statusTag = '';
        if (d.contactado === 'PROACTIVO') statusTag = `<span class="status-dot st-proactivo"></span>Por Confirmar`;
        else if (d.contactado === 'PROACTIVO_CONFIRMADO') statusTag = '<span class="status-dot st-efectivo"></span>Confirmado';
        else if (d.contactado === 'PERDIDO') statusTag = '<span class="status-dot st-perdido"></span>Perdido';
        else if (d.contactado === 'CITA_EFECTIVA') statusTag = '<span class="status-dot st-efectivo"></span>Cita Efectiva';
        else if (d.agendo === 'SI') statusTag = '<span class="status-dot st-agendado"></span>Citado';
        else if (d.contactado === 'DEMORADO') statusTag = '<span class="status-dot" style="background:#ff9f0a;"></span>Rezagado';
        else statusTag = '<span class="status-dot st-reactivo"></span>Pendiente Cita';

        let tdAction = '';
        if (actionHeader !== '') {
            let actionButtons = `<button class="btn-action-clean" onclick="window.openModal(${realIndex})">Gestionar</button>`;
            
            // LÓGICA BOTÓN DEMORADOS (Solo para el Admin en PENDIENTES DE CITA, solo en Activos y Primer Servicio)
            if (adminMode && currentFilter === 'reactivos' && (activeTab === 'activos' || activeTab === 'primer')) {
                actionButtons += `<br><button class="btn-corp-outline" style="color:#ff9f0a; border-color:#ff9f0a; font-size:10px; padding:3px 6px; margin-top:5px;" onclick="window.moveToDemorados(${realIndex})">➡️ A Rezagados</button>`;
            }

            if (activeTab === 'papelera') actionButtons = `<button class="btn-action-clean" onclick="window.restoreClient(${realIndex})">Restaurar</button>`;
            else if (adminMode) actionButtons += `<button class="btn-action-clean" style="color:#ff3b30; margin-left:10px;" onclick="window.deleteClient(${realIndex})">Eliminar</button>`;
            tdAction = `<td style="text-align:right;">${actionButtons}</td>`;
        }

        let servicioText = d.servicio_proactivo || d.ultimo_servicio || 'Por verificar';
        if (currentFilter === 'proactivos' && activeTab === 'primer') servicioText = `<span style="font-weight:600; color:var(--apple-text);">${d.servicio_realizado || 'Servicio Confirmado'}</span>`;

        let fechaColHtml = d.proximo_servicio;
        let statusTagOrDate = statusTag;

        if (activeTab === 'inactivos' && (currentFilter === 'reactivos' || currentFilter === 'demorados')) {
            const nextCont = calculateNextContact(d);
            fechaColHtml = nextCont.isOverdue ? `<span style="color:#ff3b30; font-weight:600;">${nextCont.text} (Atrasado)</span>` : `<span style="color:#86868b;">${nextCont.text}</span>`;
            statusTagOrDate = `<span style="color:#ff3b30; font-size:11px; font-weight:600;">${d.fecha_ultima_factura || 'Histórica'}</span>`;
        } 
        else if (currentFilter === 'proactivos') {
            if (activeTab === 'primer') fechaColHtml = `<span style="color:#1d1d1f; font-weight:700;">${d.fecha_factura_efectiva || 'Sin Fecha'}</span>`;
            else fechaColHtml = d.fecha_proactivo || d.proximo_servicio || '-';
        }
        else if (currentFilter === 'reactivos' || currentFilter === 'demorados') {
            const nextCont = calculateNextContact(d);
            fechaColHtml = nextCont.isOverdue ? `<span style="color:#ff3b30; font-weight:600;">${nextCont.text} (Atrasado)</span>` : `<span style="color:#86868b;">${nextCont.text}</span>`;
        } else if (currentFilter === 'agendados') {
            if (d.fecha_cita) { 
                const parts = d.fecha_cita.split('-'); 
                if(parts.length === 3) fechaColHtml = `<span style="color:#1d1d1f; font-weight:600;">${parts[2]}/${parts[1]}/${parts[0]}</span>`;
                else fechaColHtml = `<span style="color:#1d1d1f; font-weight:600;">${d.fecha_cita}</span>`; 
            }
        } else if (currentFilter === 'efectivas') { 
            fechaColHtml = `<span style="color:#34c759; font-weight:700; font-size:11px;">${d.servicio_realizado || 'Mantenimiento Confirmado'}</span>`; 
            statusTagOrDate = `<span style="font-weight:700; color:var(--apple-text);">${d.fecha_factura_efectiva || 'Sin Fecha'}</span>`;
        } else if (currentFilter === 'perdidos') { 
            fechaColHtml = `<span style="color:#86868b;">${d.motivo_pausa || 'Sin motivo'}</span>`; 
        }

        let extraTd = '';
        if (activeTab === 'primer' && currentFilter !== 'efectivas' && currentFilter !== 'perdidos') {
            let nV = d.vendedor || 'N/A';
            extraTd = `<td><span style="color:#5e5ce6; font-weight:600; font-size:10px;">${nV}</span></td>`;
        } else if (currentFilter === 'proactivos' && activeTab === 'activos') {
            let nA = d.asesor_proactivo || 'N/A';
            if (nA.toUpperCase().includes('JARED')) nA = 'Jared'; else if (nA.toUpperCase().includes('EUGENIA')) nA = 'Eugenia';
            extraTd = `<td><span style="color:#5e5ce6; font-weight:600;">${nA}</span></td>`;
        } 
        
        if (currentFilter === 'agendados' && adminMode) {
            extraTd += `<td><button class="btn-corp-outline" style="font-size:10px; padding:4px 8px; color:#ff9f0a; border-color:#ff9f0a;" onclick="window.returnToReactivo(${realIndex})">↺ Retornar</button></td>`;
        }

        let tdStatus = `<td><div style="font-size:12px; font-weight:600; color:var(--apple-text);">${statusTagOrDate}</div></td>`;
        let vinHtml = `<span style="font-size:11px; color:var(--apple-muted);">${d.vin || 'N/D'}</span>`;
        
        if (activeTab === 'primer' && currentFilter === 'proactivos') {
            tdStatus = ''; 
            if (adminMode) vinHtml = `<a href="#" onclick="window.returnProactivoToReactivo(${realIndex}); return false;" style="font-size:11px; color:#ff9f0a; text-decoration:underline; font-weight:800; cursor:pointer;" title="Clic para regresar a Reactivos">${d.vin || 'N/D'} ↺</a>`;
        }

        html += `<tr>
            <td><strong>${d.orden_proactivo || d.orden}</strong><br>${vinHtml}</td>
            <td><div style="font-weight:600;">${d.cliente}</div></td>
            <td>${d.telefono}</td>
            ${extraTd}
            <td><div style="font-size:11px; color:var(--apple-muted);">${servicioText}</div></td>
            <td>${fechaColHtml}</td>
            ${tdStatus}
            ${tdAction}
        </tr>`;
    });
    tableBody.innerHTML = html;
}
//#endregion

//#region SECCIÓN 9: FUNCIONES GLOBALES Y RESCATE
// ---------------------------------------------------------
// SECCIÓN 9: FUNCIONES GLOBALES (Papelera y Retornos)
// ---------------------------------------------------------

window.deleteClient = async function(realIndex) { 
    if(confirm("¿Enviar a papelera?")) { 
        await updateDoc(doc(db, "clientes", database[realIndex].firebaseId), { tab_type: 'papelera', old_tab: database[realIndex].tab_type }); 
        await syncWithFirebase(); 
    } 
};

window.restoreClient = async function(realIndex) { 
    await updateDoc(doc(db, "clientes", database[realIndex].firebaseId), { tab_type: database[realIndex].old_tab, old_tab: null }); 
    await syncWithFirebase(); 
};

window.returnToReactivo = async function(realIndex) {
    if(confirm("¿Seguro que deseas retornar este cliente a PENDIENTES DE CITA? Se cancelará su cita agendada.")) {
        const client = database[realIndex];
        await updateDoc(doc(db, "clientes", client.firebaseId), { 
            agendo: 'NO', 
            contactado: 'PENDIENTE',
            fecha_cita: null
        }); 
        await syncWithFirebase(); 
        alert("Cliente retornado a Pendientes exitosamente.");
    }
};

// NUEVA FUNCIÓN: RESCATAR A REZAGADOS (Salta el tiempo hacia el mes actual)
window.moveToDemorados = async function(realIndex) {
    const client = database[realIndex];
    
    if(confirm(`¿Estás seguro de mover a ${client.cliente} a REZAGADOS?\n\nAl hacer esto, el cliente desaparecerá del mes donde lo estás viendo y será transferido automáticamente al mes actual en curso para que las operadoras le den seguimiento.`)) {
        
        // Obtener el mes y año real de hoy
        const today = new Date();
        const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        
        uploadStatus.textContent = "Transfiriendo cliente a Rezagados... ⏳";
        
        try {
            await updateDoc(doc(db, "clientes", client.firebaseId), { 
                contactado: 'DEMORADO',
                mes_anio: currentMonthStr // La magia: Lo sacamos del mes viejo y lo inyectamos al nuevo
            }); 
            
            await syncWithFirebase(); 
            alert(`✅ Cliente rescatado exitosamente.\n\nAhora lo encontrarás en la pestaña "Rezagados" seleccionando el mes actual (${currentMonthStr}) en el filtro superior.`);
        } catch (error) {
            console.error(error);
            alert("Error al transferir al cliente.");
        }
    }
};
//#endregion