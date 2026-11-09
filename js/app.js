// =====================================================================
// ARCHIVO: /js/app.js
// OBJETIVO: Núcleo Central. Conecta UI, Firebase y Módulos Externos.
// =====================================================================

// ---------------------------------------------------------
// SECCIÓN 1: IMPORTS DE MÓDULOS Y DEPENDENCIAS
// ---------------------------------------------------------
import { db, collection, getDocs, doc, writeBatch, updateDoc } from './config/firebaseConfig.js';
import { processMainBaseActivos, crossReferenceServicesActivos, enrichClientDataActivos, markEffectiveAppointments } from './logic/activosLogic.js';
import { initAuth, adminMode } from './auth/accessController.js';
import { initPipelineManager } from './ui/pipelineManager.js';
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
    // A) Inyectar mes actual automáticamente
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const uploadInput = document.getElementById('upload-mes');
    
    if(uploadInput) uploadInput.value = currentMonthStr;
    if(inputMesFiltro) inputMesFiltro.value = currentMonthStr;

    // B) Iniciar Módulos de Control
    initAuth(syncWithFirebase, renderTable);
    initPipelineManager(database, syncWithFirebase, renderTable);
    
    // C) Evento de Formateo Global
    const btnClear = document.getElementById('btn-clear-data');
    if(btnClear) {
        btnClear.addEventListener('click', async () => { 
            if (prompt("Clave de Seguridad Administrativa para BORRAR LA NUBE:") === "2099") { 
                const batch = writeBatch(db); 
                database.forEach(d => { if(d.firebaseId) batch.delete(doc(db, "clientes", d.firebaseId)); }); 
                await batch.commit(); 
                await syncWithFirebase(); 
                alert("Base de datos en la nube formateada exitosamente."); 
            } 
        });
    }
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
            document.getElementById('upload-panel').classList.add('hidden'); 
            document.getElementById('stats-panel').classList.add('hidden'); 
            document.getElementById('view-filters').classList.add('hidden'); 
            document.getElementById('papelera-filters').classList.remove('hidden');
        } else {
            document.getElementById('table-title').textContent = "Directorio de Clientes";
            if (adminMode && activeTab === 'activos') document.getElementById('upload-panel').classList.remove('hidden'); 
            else document.getElementById('upload-panel').classList.add('hidden');
            
            document.getElementById('stats-panel').classList.remove('hidden'); 
            document.getElementById('view-filters').classList.remove('hidden'); 
            document.getElementById('papelera-filters').classList.add('hidden');
        }
        uploadStatus.textContent = ""; renderTable();
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
// SECCIÓN 7: RUTINAS DE CARGA DE EXCEL (PANEL ADMIN 0520)
// ---------------------------------------------------------

// 7.1 Botón 1: Subir Base Nueva
document.getElementById('btn-process-excel').addEventListener('click', async () => {
    const adminPass = prompt("Ingresa la clave de Autorización (4 dígitos) para subir la base:");
    if (adminPass !== "2099") return alert("Clave incorrecta. Operación cancelada.");
    const file = document.getElementById('excel-upload').files[0];
    const mesTrabajo = document.getElementById('upload-mes').value; 
    
    if (!mesTrabajo || !file) return alert("Por favor, selecciona el mes de trabajo y el archivo.");
    
    uploadStatus.textContent = "Analizando fechas y detectando Proactivos ⏳..."; 
    try {
        const result = await processMainBaseActivos(file, activeTab, mesTrabajo);
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

// 7.2 Botón 2: Actualizar Teléfonos
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

// 7.3 Botón 3: Filtro de Calidad (KMs y Cortesías)
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

// 7.4 Botón 4: Citas Efectivas (POR VIN Y FACTURA)
const btnEfectivas = document.getElementById('btn-process-efectivas');
if (btnEfectivas) {
    btnEfectivas.addEventListener('click', async () => {
        const fileFacturas = document.getElementById('excel-facturas').files[0];
        const fileAsesores = document.getElementById('excel-efectivas').files[0];
        
        if (!fileFacturas || !fileAsesores) return alert("Debes subir ambos archivos (Facturas y Asesores) para cruzar los VIN."); 
        
        uploadStatus.textContent = "Analizando Facturas y VINs para confirmar Asistencias... ⏳"; 
        try {
            const resultUpdates = await markEffectiveAppointments(fileFacturas, fileAsesores, database.filter(d => d.tab_type === activeTab));
            
            if (resultUpdates.length > 0) {
                const batch = writeBatch(db);
                resultUpdates.forEach(updateObj => { 
                    batch.update(doc(db, "clientes", updateObj.firebaseId), {
                        servicio_realizado: updateObj.servicio_realizado, // Se guarda el nuevo servicio realizado hoy
                        contactado: updateObj.contactado
                    }); 
                });
                await batch.commit(); 
                await syncWithFirebase();
                alert(`✅ ¡ÉXITO! Se encontraron y marcaron ${resultUpdates.length} Citas Efectivas.`);
            } else {
                alert("⚠️ No se encontraron coincidencias para Citas Efectivas. Verifica los archivos.");
                uploadStatus.textContent = "";
            }
        } catch (err) { 
            console.error(err); 
            uploadStatus.textContent = "Error al procesar Citas Efectivas.";
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
    
    const targetDate = new Date(p[2], p[1]-1, p[0]); // Fecha límite (6 meses)
    let step = client.paso_actual || 0;
    
    const diasRestar = [45, 30, 21, 15, 11, 3, 0];
    let daysToSub = (step >= 0 && step < 7) ? diasRestar[step] : 0;

    targetDate.setDate(targetDate.getDate() - daysToSub);
    
    const dd = String(targetDate.getDate()).padStart(2, '0'); 
    const mm = String(targetDate.getMonth()+1).padStart(2, '0');
    const today = new Date(); today.setHours(0,0,0,0);
    const isOverdue = targetDate <= today; 
    
    return { dateObj: targetDate, text: `${dd}/${mm}/${targetDate.getFullYear()}`, isOverdue: isOverdue };
}

function renderTable() {
    const mesActual = inputMesFiltro.value;
    let baseData = activeTab === 'papelera' ? database.filter(d => d.tab_type === 'papelera' && d.old_tab === papeleraSubTab) : database.filter(d => d.tab_type === activeTab && d.mes_anio === mesActual);
    
    // Asignación de KPIs Superiores
    if (activeTab !== 'papelera') {
        document.getElementById('stat-total').textContent = baseData.length;
        document.getElementById('stat-reactivos').textContent = baseData.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.agendo !== 'SI').length;
        document.getElementById('stat-agendados').textContent = baseData.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA').length;
        document.getElementById('stat-efectivas').textContent = baseData.filter(d => d.contactado === 'CITA_EFECTIVA').length;
        document.getElementById('stat-proactivos').textContent = baseData.filter(d => d.contactado === 'PROACTIVO' || d.contactado === 'PROACTIVO_CONFIRMADO').length;
        document.getElementById('stat-perdidos').textContent = baseData.filter(d => d.contactado === 'PERDIDO').length;
    }
    
    let dataToShow = [...baseData];
    
    // Reglas de Filtrado de los 6 Estados
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
    
    // Cabeceras Dinámicas Elegantes
    const thead = document.querySelector('.corp-table thead');
    let extraHeaders = ''; let dynamicDateCol = '<th>PRÓXIMO (6M)</th>';
    
    if (currentFilter === 'proactivos') { extraHeaders = '<th>ASESOR</th>'; dynamicDateCol = '<th>FECHA SERVICIO</th>';
    } else if (currentFilter === 'reactivos') { dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
    } else if (currentFilter === 'agendados') { dynamicDateCol = '<th>FECHA CITA</th>';
    // AQUÍ SE AGREGA LA NUEVA COLUMNA DE "SERVICIO REALIZADO" PARA CITAS EFECTIVAS:
    } else if (currentFilter === 'efectivas') { dynamicDateCol = '<th style="color:#34c759;">SERVICIO REALIZADO</th>'; 
    } else if (currentFilter === 'perdidos') { dynamicDateCol = '<th>MOTIVO PÉRDIDA</th>'; }
    
    thead.innerHTML = `<tr><th>ORDEN / VIN</th><th>CLIENTE</th><th>TELÉFONO</th>${extraHeaders}<th>ÚLTIMO SERVICIO</th>${dynamicDateCol}<th>ESTATUS</th><th style="text-align: right;">ACCIÓN</th></tr>`;

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

        let actionButtons = `<button class="btn-action-clean" onclick="window.openModal(${realIndex})">Gestionar</button>`;
        if (activeTab === 'papelera') actionButtons = `<button class="btn-action-clean" onclick="window.restoreClient(${realIndex})">Restaurar</button>`;
        else if (adminMode) actionButtons += `<button class="btn-action-clean" style="color:#ff3b30; margin-left:10px;" onclick="window.deleteClient(${realIndex})">Eliminar</button>`;

        let fechaColHtml = d.proximo_servicio;
        if (currentFilter === 'proactivos') fechaColHtml = d.fecha_proactivo || d.proximo_servicio || '-';
        else if (currentFilter === 'reactivos') {
            const nextCont = calculateNextContact(d);
            fechaColHtml = nextCont.isOverdue ? `<span style="color:#ff3b30; font-weight:600;">${nextCont.text} (Atrasado)</span>` : `<span style="color:#86868b;">${nextCont.text}</span>`;
        } else if (currentFilter === 'agendados') {
            if (d.fecha_cita) { const cd = new Date(d.fecha_cita); fechaColHtml = `<span style="color:#1d1d1f; font-weight:600;">${String(cd.getDate()).padStart(2,'0')}/${String(cd.getMonth()+1).padStart(2,'0')} - ${String(cd.getHours()).padStart(2,'0')}:${String(cd.getMinutes()).padStart(2,'0')}</span>`; }
        // Y AQUÍ SE IMPRIME LO QUE SE LE HIZO REALMENTE ESTE MES
        } else if (currentFilter === 'efectivas') { 
            fechaColHtml = `<span style="color:#34c759; font-weight:700; font-size:11px;">${d.servicio_realizado || 'Mantenimiento Confirmado'}</span>`; 
        } else if (currentFilter === 'perdidos') { fechaColHtml = `<span style="color:#86868b;">${d.motivo_pausa || 'Sin motivo'}</span>`; }

        let asesorTd = '';
        if (currentFilter === 'proactivos') {
            let nA = d.asesor_proactivo || 'N/A';
            if (nA.toUpperCase().includes('JARED')) nA = 'Jared'; else if (nA.toUpperCase().includes('EUGENIA')) nA = 'Eugenia';
            asesorTd = `<td><span style="color:#5e5ce6; font-weight:600;">${nA}</span></td>`;
        }

        html += `<tr>
            <td><strong>${d.orden_proactivo || d.orden}</strong><br><span style="font-size:11px; color:var(--apple-muted);">${d.vin || 'N/D'}</span></td>
            <td><div style="font-weight:600;">${d.cliente}</div></td>
            <td>${d.telefono}</td>
            ${asesorTd}
            <td><div style="font-size:11px; color:var(--apple-muted);">${d.servicio_proactivo || d.ultimo_servicio || 'Por verificar'}</div></td>
            <td>${fechaColHtml}</td>
            <td><div style="font-size:12px; font-weight:600; color:var(--apple-text);">${statusTag}</div></td>
            <td style="text-align:right;">${actionButtons}</td>
        </tr>`;
    });
    tableBody.innerHTML = html;
}

// ---------------------------------------------------------
// SECCIÓN 9: FUNCIONES GLOBALES (Papelera)
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