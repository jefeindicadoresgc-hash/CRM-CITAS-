// =====================================================================
// ARCHIVO: /js/app.js
// OBJETIVO: Núcleo Central. Conecta UI, Firebase y Módulos Externos.
// =====================================================================

// ---------------------------------------------------------
// SECCIÓN 1: IMPORTS DE MÓDULOS Y DEPENDENCIAS (CACHE-BUSTER 2.3)
// ---------------------------------------------------------
import { db, collection, getDocs, doc, writeBatch, updateDoc } from './config/firebaseConfig.js';
import { processMainBaseActivos, crossReferenceServicesActivos, enrichClientDataActivos, markEffectiveAppointments } from './logic/activosLogic.js?v=2.3';
import { processPrimerServicioBase } from './logic/primerServicioLogic.js?v=2.3';
import { initAuth, adminMode } from './auth/accessController.js?v=2.3';
import { initPipelineManager } from './ui/pipelineManager.js?v=2.3';

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

// ---------------------------------------------------------
// SECCIÓN 6: FILTROS DEL EMBUDO (PIPELINE ESTADOS)
// ---------------------------------------------------------
const filtersIds = ['filter-all', 'filter-proactivos', 'filter-reactivos', 'filter-agendados', 'filter-efectivas', 'filter-perdidos'];
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


// ---------------------------------------------------------
// SECCIÓN 7: RUTINAS DE CARGA Y LIMPIEZA (PANEL ADMIN 0520)
// ---------------------------------------------------------
document.getElementById('btn-process-excel').addEventListener('click', async () => {
    const adminPass = prompt("Ingresa la clave de Autorización (4 dígitos) para subir la base:");
    if (adminPass !== "2099") return alert("Clave incorrecta. Operación cancelada.");
    const file = document.getElementById('excel-upload').files[0];
    const mesTrabajo = document.getElementById('upload-mes').value; 
    if (!mesTrabajo || !file) return alert("Por favor, selecciona el mes de trabajo y el archivo.");
    
    uploadStatus.textContent = activeTab === 'primer' ? "Analizando Libro de Ventas ⏳..." : "Analizando fechas y detectando Proactivos ⏳..."; 
    try {
        let result;
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
    } catch (err) { uploadStatus.textContent = "Error al procesar la base."; console.error(err);}
});

async function finalizeBaseUpload() {
    uploadStatus.textContent = "Subiendo Base Inteligente a Firebase... ☁️";
    const batch = writeBatch(db);
    tempNewRecords.forEach(record => { batch.set(doc(collection(db, "clientes")), record); });
    await batch.commit();
    document.getElementById('base-report-modal').classList.add('hidden'); tempNewRecords = [];
    document.getElementById('mes-filtro').value = document.getElementById('upload-mes').value;
    await syncWithFirebase(); 
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
        
        if (!fileFacturas || !fileAsesores || !mesTrabajo) return alert("Debes seleccionar el mes y subir ambos archivos (Facturas y Asesores)."); 
        
        uploadStatus.textContent = "Analizando Facturas y VINs (Aplicando regla de 15 días)... ⏳"; 
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
                alert("⚠️ No se encontraron coincidencias para Citas. Verifica los archivos.");
                uploadStatus.textContent = "";
            }
        } catch (err) { 
            console.error(err); 
            uploadStatus.textContent = "Error al procesar el Cruce Taller.";
        }
    });
}

// =========================================================
// NUEVA FUNCIÓN: PURGADO INTELIGENTE (BÓVEDA DE RESPALDO)
// =========================================================
const btnClearSmart = document.getElementById('btn-clear-data-smart');
if (btnClearSmart) {
    btnClearSmart.addEventListener('click', async () => {
        const mesTrabajo = document.getElementById('upload-mes').value;
        if (!mesTrabajo) return alert("Primero selecciona el 'Mes a trabajar' en la Tarjeta 1.");

        // Definir qué pestaña estamos borrando
        const targetTab = activeTab === 'papelera' ? papeleraSubTab : activeTab;
        
        // Extraer los registros exactos a mover (Los de la tabla activa + Los que ya estaban en papelera de ese mismo mes/origen)
        const registrosABorrar = database.filter(d => 
            (d.tab_type === targetTab && d.mes_anio === mesTrabajo) || 
            (d.tab_type === 'papelera' && d.old_tab === targetTab && d.mes_anio === mesTrabajo)
        );

        if (registrosABorrar.length === 0) return alert(`No hay registros de ${targetTab.toUpperCase()} en el mes ${mesTrabajo} para purgar.`);

        if (prompt("⚠️ ZONA DE PELIGRO ⚠️\nPara continuar, ingresa tu clave de autorización (4 dígitos):") !== "2099") {
            return alert("Clave incorrecta. Operación cancelada.");
        }

        const confirmacion = confirm(`⚠️ ADVERTENCIA FINAL ⚠️\n\nEstás a punto de ELIMINAR ${registrosABorrar.length} clientes correspondientes a:\n\n- Origen: ${targetTab.toUpperCase()}\n- Mes: ${mesTrabajo}\n\nLos registros desaparecerán de esta tabla pero se moverán a la "Bóveda de Respaldo" secreta por 30 días.\n\n¿Estás completamente seguro de continuar?`);
        if (!confirmacion) return;

        uploadStatus.textContent = "Moviendo a Bóveda de Respaldo y limpiando nube... ⏳";
        
        try {
            const batch = writeBatch(db);
            
            // Calculamos la fecha de caducidad (Hoy + 30 días)
            const hoy = new Date();
            const caducidad = new Date(hoy);
            caducidad.setDate(caducidad.getDate() + 30);

            registrosABorrar.forEach(client => {
                if (client.firebaseId) {
                    // 1. Crear copia en la colección secreta 'respaldo_emergencia'
                    const backupRef = doc(collection(db, "respaldo_emergencia"), client.firebaseId);
                    batch.set(backupRef, { 
                        ...client, 
                        fecha_ingreso_boveda: hoy.toISOString(),
                        fecha_caducidad: caducidad.toISOString() 
                    });
                    
                    // 2. Borrar permanentemente de la colección principal 'clientes'
                    const mainRef = doc(db, "clientes", client.firebaseId);
                    batch.delete(mainRef);
                }
            });

            await batch.commit();
            await syncWithFirebase();
            alert(`✅ Limpieza exitosa. ${registrosABorrar.length} registros fueron enviados a la Bóveda de Respaldo.`);
        } catch (error) {
            console.error("Error al purgar:", error);
            uploadStatus.textContent = "Error al limpiar la nube.";
        }
    });
}

// ---------------------------------------------------------
// SECCIÓN 8: MOTOR DE MATEMÁTICA Y DIBUJO DE TABLA
// ---------------------------------------------------------
function calculateNextContact(client) {
    if (!client.proximo_servicio || client.proximo_servicio === "Sin Fecha") return { dateObj: null, text: 'N/D', isOverdue: false };
    const p = client.proximo_servicio.split('/');
    if (p.length !== 3) return { dateObj: null, text: 'N/D', isOverdue: false };
    const targetDate = new Date(p[2], p[1]-1, p[0]);
    let step = client.paso_actual || 0;
    const diasRestar = [45, 30, 21, 15, 11, 3, 0];
    let daysToSub = (step >= 0 && step < 7) ? diasRestar[step] : 0;
    targetDate.setDate(targetDate.getDate() - daysToSub);
    const dd = String(targetDate.getDate()).padStart(2, '0'); 
    const mm = String(targetDate.getMonth()+1).padStart(2, '0');
    const today = new Date(); today.setHours(0,0,0,0);
    return { dateObj: targetDate, text: `${dd}/${mm}/${targetDate.getFullYear()}`, isOverdue: targetDate <= today };
}

function renderTable() {
    // =========================================================
    // NUEVO: CONTROL DINÁMICO DEL PANEL ADMIN (0520)
    // =========================================================
    const panelTitle = document.getElementById('title-upload-base');
    const panelDesc = document.getElementById('desc-upload-base');
    const panelOp2 = document.getElementById('panel-opcion-2');
    const panelOp3 = document.getElementById('panel-opcion-3');
    
    if (activeTab === 'papelera' || !adminMode) {
        document.getElementById('upload-panel').classList.add('hidden');
    } else if (adminMode && (activeTab === 'activos' || activeTab === 'primer')) {
        document.getElementById('upload-panel').classList.remove('hidden');
        if (panelTitle && panelDesc) {
            if (activeTab === 'primer') {
                panelTitle.textContent = "1. Subir Libro de Ventas";
                panelDesc.textContent = "(Calcula 6 meses desde Fecha Entrega)";
                if(panelOp2) panelOp2.classList.add('hidden');
                if(panelOp3) panelOp3.classList.add('hidden');
            } else {
                panelTitle.textContent = "1. Subir Base (Clave 2099)";
                panelDesc.textContent = "(Filtra a 6 meses y detecta Proactivos)";
                if(panelOp2) panelOp2.classList.remove('hidden');
                if(panelOp3) panelOp3.classList.remove('hidden');
            }
        }
    }
    // =========================================================

    const mesActual = inputMesFiltro.value;
    let baseData = activeTab === 'papelera' ? database.filter(d => d.tab_type === 'papelera' && d.old_tab === papeleraSubTab) : database.filter(d => d.tab_type === activeTab && d.mes_anio === mesActual);
    
    if (activeTab !== 'papelera') {
        document.getElementById('stat-total').textContent = baseData.length;
        document.getElementById('stat-reactivos').textContent = baseData.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.agendo !== 'SI').length;
        document.getElementById('stat-agendados').textContent = baseData.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA').length;
        document.getElementById('stat-efectivas').textContent = baseData.filter(d => d.contactado === 'CITA_EFECTIVA').length;
        document.getElementById('stat-proactivos').textContent = baseData.filter(d => d.contactado === 'PROACTIVO' || d.contactado === 'PROACTIVO_CONFIRMADO').length;
        document.getElementById('stat-perdidos').textContent = baseData.filter(d => d.contactado === 'PERDIDO').length;
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
            dataToShow = dataToShow.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.agendo !== 'SI');
            dataToShow.sort((a, b) => (calculateNextContact(a).dateObj || new Date(2100,0,1)) - (calculateNextContact(b).dateObj || new Date(2100,0,1)));
        }
        else if (currentFilter === 'agendados') {
            dataToShow = dataToShow.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA');
            dataToShow.sort((a, b) => (a.fecha_cita ? new Date(a.fecha_cita).getTime() : 0) - (b.fecha_cita ? new Date(b.fecha_cita).getTime() : 0));
        }
        else if (currentFilter === 'efectivas') { 
            dataToShow = dataToShow.filter(d => d.contactado === 'CITA_EFECTIVA'); 
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
    } else if (currentFilter === 'proactivos') { 
        extraHeaders = '<th>ASESOR</th>'; 
        dynamicDateCol = '<th>FECHA SERVICIO</th>';
    } 
    
    if (currentFilter === 'reactivos') { 
        dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
    } else if (currentFilter === 'agendados') { 
        dynamicDateCol = '<th>FECHA CITA</th>';
        if (adminMode) extraHeaders += '<th>RETORNO</th>'; 
    } else if (currentFilter === 'efectivas') { 
        dynamicDateCol = '<th style="color:#34c759;">SERVICIO REALIZADO</th>'; 
        statusHeader = '<th style="color:#34c759;">FECHA FACTURA</th>'; 
        actionHeader = ''; 
    } else if (currentFilter === 'perdidos') { 
        dynamicDateCol = '<th>MOTIVO PÉRDIDA</th>'; 
        if (!adminMode) actionHeader = ''; 
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
        else if (d.agendo === 'SI') statusTag = '<span class="status-dot st-agendado"></span>Agendado';
        else statusTag = '<span class="status-dot st-reactivo"></span>Por Contactar';

        let tdAction = '';
        if (actionHeader !== '') {
            let actionButtons = `<button class="btn-action-clean" onclick="window.openModal(${realIndex})">Gestionar</button>`;
            if (activeTab === 'papelera') actionButtons = `<button class="btn-action-clean" onclick="window.restoreClient(${realIndex})">Restaurar</button>`;
            else if (adminMode) actionButtons += `<button class="btn-action-clean" style="color:#ff3b30; margin-left:10px;" onclick="window.deleteClient(${realIndex})">Eliminar</button>`;
            tdAction = `<td style="text-align:right;">${actionButtons}</td>`;
        }

        let fechaColHtml = d.proximo_servicio;
        if (currentFilter === 'proactivos') fechaColHtml = d.fecha_proactivo || d.proximo_servicio || '-';
        else if (currentFilter === 'reactivos') {
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
        } else if (currentFilter === 'perdidos') { fechaColHtml = `<span style="color:#86868b;">${d.motivo_pausa || 'Sin motivo'}</span>`; }

        let extraTd = '';
        if (activeTab === 'primer' && currentFilter !== 'efectivas' && currentFilter !== 'perdidos') {
            let nV = d.vendedor || 'N/A';
            extraTd = `<td><span style="color:#5e5ce6; font-weight:600; font-size:10px;">${nV}</span></td>`;
        } else if (currentFilter === 'proactivos') {
            let nA = d.asesor_proactivo || 'N/A';
            if (nA.toUpperCase().includes('JARED')) nA = 'Jared'; else if (nA.toUpperCase().includes('EUGENIA')) nA = 'Eugenia';
            extraTd = `<td><span style="color:#5e5ce6; font-weight:600;">${nA}</span></td>`;
        } 
        
        if (currentFilter === 'agendados' && adminMode) {
            extraTd += `<td><button class="btn-corp-outline" style="font-size:10px; padding:4px 8px; color:#ff9f0a; border-color:#ff9f0a;" onclick="window.returnToReactivo(${realIndex})">↺ Retornar</button></td>`;
        }

        let statusTagOrDate = statusTag;
        if (currentFilter === 'efectivas') {
            statusTagOrDate = `<span style="font-weight:700; color:var(--apple-text);">${d.fecha_factura_efectiva || 'Sin Fecha'}</span>`;
        }

        html += `<tr>
            <td><strong>${d.orden_proactivo || d.orden}</strong><br><span style="font-size:11px; color:var(--apple-muted);">${d.vin || 'N/D'}</span></td>
            <td><div style="font-weight:600;">${d.cliente}</div></td>
            <td>${d.telefono}</td>
            ${extraTd}
            <td><div style="font-size:11px; color:var(--apple-muted);">${d.servicio_proactivo || d.ultimo_servicio || 'Por verificar'}</div></td>
            <td>${fechaColHtml}</td>
            <td><div style="font-size:12px; font-weight:600; color:var(--apple-text);">${statusTagOrDate}</div></td>
            ${tdAction}
        </tr>`;
    });
    tableBody.innerHTML = html;
}

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
    if(confirm("¿Seguro que deseas retornar este cliente a REACTIVOS? Se cancelará su cita agendada.")) {
        const client = database[realIndex];
        await updateDoc(doc(db, "clientes", client.firebaseId), { 
            agendo: 'NO', 
            contactado: 'PENDIENTE',
            fecha_cita: null
        }); 
        await syncWithFirebase(); 
        alert("Cliente retornado a Reactivos exitosamente.");
    }
};