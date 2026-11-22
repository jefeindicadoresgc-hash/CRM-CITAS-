//#region SECCIÓN 1: IMPORTS DE MÓDULOS Y DEPENDENCIAS
import { db, collection, getDocs, doc, writeBatch, updateDoc } from './config/firebaseConfig.js';
import { processMainBaseActivos, crossReferenceServicesActivos, enrichClientDataActivos, markEffectiveAppointments } from './logic/activosLogic.js?v=2.8';
import { processPrimerServicioBase } from './logic/primerServicioLogic.js?v=2.8';
import { processMainBaseInactivos } from './logic/inactivosLogic.js?v=2.8';
import { initAuth, adminMode } from './auth/accessController.js?v=2.8';
import { initPipelineManager } from './ui/pipelineManager.js?v=2.8';
//#endregion

//#region SECCIÓN 2: ESTADO GLOBAL Y MEMORIA EN TIEMPO REAL
let database = []; 
let activeTab = 'activos';
let papeleraSubTab = 'activos'; 
let currentFilter = 'all'; 
let isAllMode = false;

let tempSafeDatabase = []; let tempPendingPurge = []; let tempNewRecords = [];

const tableBody = document.getElementById('table-body'); 
const uploadStatus = document.getElementById('upload-status');
const inputMesFiltro = document.getElementById('mes-filtro');

inputMesFiltro.addEventListener('change', renderTable);

function getAllModeMonths() {
    const today = new Date();
    const months = [];
    for (let i = 0; i < 3; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}

function formatMesCorto(mesAnio) {
    if (!mesAnio || !mesAnio.includes('-')) return 'N/D';
    const [y, m] = mesAnio.split('-');
    const nombres = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    return `${nombres[parseInt(m, 10) - 1] || m} ${y.slice(-2)}`;
}

// =========================================================
// SELECTOR DE MES FLOTANTE MINIMALISTA
// =========================================================
(function initCustomMonthPicker() {
    const btn = document.getElementById('month-picker-btn');
    const label = document.getElementById('month-picker-label');
    const popover = document.getElementById('month-picker-popover');
    const yearDisplay = document.getElementById('mp-year-display');
    const grid = document.getElementById('mp-months-grid');
    const prevBtn = document.getElementById('mp-prev-year');
    const nextBtn = document.getElementById('mp-next-year');
    if (!btn || !popover || !grid) return;

    const mesesCortos = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    let pickerYear = new Date().getFullYear();

    function syncLabel() {
        const val = inputMesFiltro.value || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const [y, m] = val.split('-');
        pickerYear = parseInt(y, 10);
        label.textContent = `${mesesCortos[parseInt(m, 10) - 1]} ${y}`;
    }

    function renderGrid() {
        yearDisplay.textContent = pickerYear;
        const currentVal = inputMesFiltro.value;
        grid.innerHTML = mesesCortos.map((name, idx) => {
            const val = `${pickerYear}-${String(idx + 1).padStart(2, '0')}`;
            const activeClass = val === currentVal ? 'active' : '';
            return `<button type="button" class="mp-month-item ${activeClass}" data-val="${val}">${name}</button>`;
        }).join('');

        grid.querySelectorAll('.mp-month-item').forEach(item => {
            item.addEventListener('click', () => {
                inputMesFiltro.value = item.getAttribute('data-val');
                syncLabel();
                popover.classList.add('hidden');
                inputMesFiltro.dispatchEvent(new Event('change'));
            });
        });
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncLabel();
        renderGrid();
        popover.classList.toggle('hidden');
    });

    prevBtn.addEventListener('click', (e) => { e.stopPropagation(); pickerYear--; renderGrid(); });
    nextBtn.addEventListener('click', (e) => { e.stopPropagation(); pickerYear++; renderGrid(); });
    document.addEventListener('click', () => popover.classList.add('hidden'));
    popover.addEventListener('click', (e) => e.stopPropagation());

    // Sincronizar etiqueta al arrancar y cuando el código cambie #mes-filtro
    setTimeout(syncLabel, 50);
    inputMesFiltro.addEventListener('change', syncLabel);
})();

// Mostrar nombre del Excel seleccionado en los botones minimalistas del Panel Admin
document.querySelectorAll('.custom-file-input').forEach(input => {
    input.addEventListener('change', () => {
        const lbl = document.querySelector(`label[for="${input.id}"]`);
        if (!lbl) return;
        const textSpan = lbl.querySelector('.file-label-text');
        if (input.files && input.files.length > 0) {
            textSpan.textContent = input.files.length > 1 ? `${input.files.length} archivos` : input.files[0].name;
            lbl.classList.add('has-file');
        } else {
            textSpan.textContent = '+ Adjuntar Excel';
            lbl.classList.remove('has-file');
        }
    });
});

// Controlador del Switch MODO ALL
const modeAllToggle = document.getElementById('mode-all-toggle');
if (modeAllToggle) {
    modeAllToggle.addEventListener('change', (e) => {
        isAllMode = e.target.checked;
        const monthWrapper = document.getElementById('custom-month-wrapper');
        const badge = document.getElementById('all-months-badge');
        const btnAll = document.getElementById('filter-all');
        const btnEfectivas = document.getElementById('filter-efectivas');

        if (isAllMode) {
            const meses = getAllModeMonths();
            if (monthWrapper) monthWrapper.classList.add('hidden');
            if (badge) {
                badge.textContent = meses.map(formatMesCorto).join(' · ');
                badge.classList.remove('hidden');
            }
            if (btnAll) btnAll.classList.add('hidden');
            if (btnEfectivas) btnEfectivas.classList.add('hidden');

            currentFilter = 'reactivos';
            updateFilterButtons(document.getElementById('filter-reactivos'));
        } else {
            if (monthWrapper) monthWrapper.classList.remove('hidden');
            if (badge) badge.classList.add('hidden');
            if (btnAll) btnAll.classList.remove('hidden');
            if (btnEfectivas) btnEfectivas.classList.remove('hidden');

            currentFilter = activeTab === 'rezagados' ? 'reactivos' : 'all';
            updateFilterButtons(document.getElementById(activeTab === 'rezagados' ? 'filter-reactivos' : 'filter-all'));
        }
        renderTable();
    });
}
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
document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.parentElement.classList.contains('tabs-container') || btn.getAttribute('data-target')) {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tabs-container .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-target');
            
            if (activeTab === 'papelera') {
                document.getElementById('table-title').textContent = "Papelera de Reciclaje";
                document.getElementById('view-filters').classList.add('hidden'); 
                document.getElementById('stats-panel').classList.add('hidden'); 
                document.getElementById('papelera-filters').classList.remove('hidden');
            } else {
                document.getElementById('table-title').textContent = activeTab === 'rezagados' ? "Base Rezagados (Demorados)" : "Directorio de Clientes";
                document.getElementById('stats-panel').classList.remove('hidden'); 
                document.getElementById('view-filters').classList.remove('hidden'); 
                document.getElementById('papelera-filters').classList.add('hidden');

                if (activeTab === 'rezagados' || isAllMode) {
                    currentFilter = 'reactivos';
                    updateFilterButtons(document.getElementById('filter-reactivos'));
                } else {
                    currentFilter = 'all';
                    updateFilterButtons(document.getElementById('filter-all'));
                }
            }
            
            uploadStatus.textContent = ""; 
            renderTable();
        });
    }
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
    if (!activeBtn) return;
    filtersIds.forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.classList.remove('active');
    });
    activeBtn.classList.add('active');
}
document.getElementById('search-input').addEventListener('input', renderTable);
//#endregion

//#region SECCIÓN 7: RUTINAS DE CARGA Y LIMPIEZA (PANEL ADMIN 0520)
// Auxiliar segura: fragmenta actualizaciones en lotes de 400 para evitar el límite de Firebase (500)
async function commitBatchInChunks(operations) {
    const chunkSize = 400;
    for (let i = 0; i < operations.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = operations.slice(i, i + chunkSize);
        chunk.forEach(op => batch.update(doc(db, "clientes", op.id), op.data));
        await batch.commit();
    }
}

document.getElementById('btn-process-excel').addEventListener('click', async () => {
    const file = document.getElementById('excel-upload').files[0];
    const mesTrabajo = document.getElementById('upload-mes').value; 
    if (!mesTrabajo || !file) return alert("Por favor, selecciona el mes destino y adjunta el archivo Excel.");
    
    uploadStatus.textContent = "Analizando archivo... ⏳"; 
    try {
        let result;
        
        // MOTOR LOCAL PARA INACTIVOS (0 FIREBASE, CREA EXCEL)
        if (activeTab === 'inactivos') {
            result = await processMainBaseInactivos(file, activeTab, mesTrabajo);
            
            if (result.newRecords.length > 0) {
                uploadStatus.textContent = "Generando Excel limpio... 📊";
                
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

        // Flujo normal para Activos y Primer Servicio (Sí suben a Firebase)
        if (activeTab === 'primer') {
            result = await processPrimerServicioBase(file, activeTab, mesTrabajo);
        } else {
            result = await processMainBaseActivos(file, activeTab, mesTrabajo);
        }
        
        tempNewRecords = result.newRecords;

        if (tempNewRecords.length === 0) {
            uploadStatus.textContent = "No se encontraron registros válidos para ese mes.";
            return alert(`⚠️ No se encontraron clientes para cargar en ${activeTab.toUpperCase()} (${mesTrabajo}).\n\nVerifica que el Excel contenga el mes correcto (6 meses atrás).`);
        }

        // =========================================================
        // CANDADO DE SEGURIDAD: PREVISUALIZACIÓN OBLIGATORIA
        // =========================================================
        const totalSubir = tempNewRecords.length;
        const totalProactivos = tempNewRecords.filter(r => r.contactado === 'PROACTIVO').length;
        const totalPendientes = totalSubir - totalProactivos;
        const totalDescartados = result.discardedRecords.length;

        const alertaVolumen = totalSubir > 500
            ? `<div style="background:rgba(114,34,39,0.08); border:1px solid #722227; color:#722227; padding:10px; border-radius:10px; margin-bottom:12px; font-weight:700;">🚨 ALERTA DE VOLUMEN ALTO: Estás por subir ${totalSubir} registros. Verifica que el archivo y el mes sean correctos antes de confirmar.</div>`
            : '';

        const resumenHtml = `
            ${alertaVolumen}
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:12px; text-align:center;">
                <div style="background:#f4f2ec; padding:10px; border-radius:10px; border:1px solid rgba(84,74,63,0.15);">
                    <div style="font-size:10px; color:#6e655c; font-weight:700; letter-spacing:0.6px;">TOTAL A SUBIR</div>
                    <div style="font-size:22px; font-weight:700; color:#231f1c;">${totalSubir}</div>
                </div>
                <div style="background:#f4f2ec; padding:10px; border-radius:10px; border:1px solid rgba(84,74,63,0.15);">
                    <div style="font-size:10px; color:#6e655c; font-weight:700; letter-spacing:0.6px;">PENDIENTES DE CITA</div>
                    <div style="font-size:22px; font-weight:700; color:#c98a1c;">${totalPendientes}</div>
                </div>
                <div style="background:#f4f2ec; padding:10px; border-radius:10px; border:1px solid rgba(84,74,63,0.15);">
                    <div style="font-size:10px; color:#6e655c; font-weight:700; letter-spacing:0.6px;">PROACTIVOS</div>
                    <div style="font-size:22px; font-weight:700; color:#231f1c;">${totalProactivos}</div>
                </div>
            </div>
            <div style="font-size:12px; margin-bottom:10px; color:#6e655c;">
                <strong>Destino:</strong> ${activeTab.toUpperCase()} &nbsp;·&nbsp; <strong>Mes Operativo:</strong> ${mesTrabajo}
            </div>
        `;

        const filasHtml = tempNewRecords.map((r, i) => `
            <tr style="border-bottom:1px solid rgba(84,74,63,0.1);">
                <td style="padding:6px; color:#6e655c;">${i + 1}</td>
                <td style="padding:6px;"><strong>${r.orden || r.orden_proactivo || 'N/D'}</strong><br><span style="font-size:10px; color:#6e655c;">${r.vin}</span></td>
                <td style="padding:6px;">${r.cliente}</td>
                <td style="padding:6px;">${r.proximo_servicio || r.fecha_proactivo || '-'}</td>
                <td style="padding:6px; font-weight:700; color:${r.contactado === 'PROACTIVO' ? '#231f1c' : '#c98a1c'};">${r.contactado}</td>
            </tr>
        `).join('');

        const tablaPreviewHtml = `
            <div style="max-height:260px; overflow-y:auto; border:1px solid rgba(84,74,63,0.15); border-radius:10px; background:#ffffff;">
                <table style="width:100%; border-collapse:collapse; font-size:11px; text-align:left;">
                    <thead style="position:sticky; top:0; background:#f4f2ec; border-bottom:1px solid rgba(84,74,63,0.15);">
                        <tr>
                            <th style="padding:7px;">#</th>
                            <th style="padding:7px;">ORDEN / VIN</th>
                            <th style="padding:7px;">CLIENTE</th>
                            <th style="padding:7px;">PRÓX. SERVICIO</th>
                            <th style="padding:7px;">ESTATUS</th>
                        </tr>
                    </thead>
                    <tbody>${filasHtml}</tbody>
                </table>
            </div>
        `;

        const descartadosHtml = totalDescartados > 0
            ? `<details style="margin-top:10px; font-size:11px; color:#6e655c;">
                    <summary style="cursor:pointer; font-weight:700;">Ver ${totalDescartados} filas ignoradas (Totales / Vacías)</summary>
                    <ul style="margin-top:5px; padding-left:18px;">${result.discardedRecords.map(msg => `<li>${msg}</li>`).join('')}</ul>
               </details>`
            : '';

        const reportListEl = document.getElementById('base-report-list');
        reportListEl.style.maxHeight = 'none';
        reportListEl.innerHTML = resumenHtml + tablaPreviewHtml + descartadosHtml;

        const btnConfirm = document.getElementById('btn-confirm-base');
        if (btnConfirm) btnConfirm.textContent = `Confirmar y Subir (${totalSubir})`;

        uploadStatus.textContent = `Esperando confirmación para subir ${totalSubir} clientes... 🔒`;
        document.getElementById('base-report-modal').classList.remove('hidden');

    } catch (err) { uploadStatus.textContent = "Error al procesar el archivo."; console.error(err); }
});

async function finalizeBaseUpload() {
    if (tempNewRecords.length === 0) {
        document.getElementById('base-report-modal').classList.add('hidden');
        return;
    }

    try {
        const chunkSize = 400; 
        const totalLotes = Math.ceil(tempNewRecords.length / chunkSize);
        uploadStatus.textContent = `Preparando ${tempNewRecords.length} clientes en ${totalLotes} lotes... ☁️`;

        for (let i = 0; i < tempNewRecords.length; i += chunkSize) {
            const batch = writeBatch(db);
            const chunk = tempNewRecords.slice(i, i + chunkSize);
            
            chunk.forEach(record => { 
                batch.set(doc(collection(db, "clientes")), record); 
            });
            
            const loteActual = Math.floor(i / chunkSize) + 1;
            uploadStatus.textContent = `Subiendo lote ${loteActual} de ${totalLotes}... ⏳`;
            
            const commitPromise = batch.commit();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT_FIREBASE")), 10000));

            await Promise.race([commitPromise, timeoutPromise]);
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }

        document.getElementById('base-report-modal').classList.add('hidden'); 
        tempNewRecords = [];
        document.getElementById('mes-filtro').value = document.getElementById('upload-mes').value;
        document.getElementById('mes-filtro').dispatchEvent(new Event('change'));
        
        uploadStatus.textContent = "Sincronizando tabla final... 🔄";
        await syncWithFirebase(); 
        
        alert("✅ Carga masiva completada con éxito.");
        uploadStatus.textContent = "";

    } catch (error) {
        console.error("❌ Error al subir la base:", error);
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
document.getElementById('btn-cancel-base').addEventListener('click', () => {
    document.getElementById('base-report-modal').classList.add('hidden');
    tempNewRecords = [];
    uploadStatus.textContent = "Carga cancelada por el administrador.";
});

const btnTelefonos = document.getElementById('btn-process-telefonos');
if (btnTelefonos) {
    btnTelefonos.addEventListener('click', async () => {
        const file = document.getElementById('excel-telefonos').files[0];
        const mesTrabajo = document.getElementById('upload-mes').value;
        if (!file || !mesTrabajo) return alert("Selecciona el mes destino y el archivo 'otras ordenes.xls'.");

        uploadStatus.textContent = "Extrayendo números de teléfono e importes ⏳...";
        try {
            const targetClients = database.filter(d => d.tab_type === activeTab && d.mes_anio === mesTrabajo);
            const recordsToUpdate = await enrichClientDataActivos(file, targetClients);

            const ops = recordsToUpdate
                .filter(c => c.firebaseId)
                .map(c => {
                    const data = { telefono: c.telefono, auto: c.auto, vin: c.vin };
                    if (c.importe) data.importe = c.importe;
                    return { id: c.firebaseId, data };
                });

            if (ops.length > 0) {
                await commitBatchInChunks(ops);
                uploadStatus.textContent = `Directorio actualizado (${ops.length} clientes) ✅`;
                await syncWithFirebase();
            } else {
                uploadStatus.textContent = "Sin cambios nuevos para ese mes.";
            }
        } catch (err) { console.error(err); uploadStatus.textContent = "Error al actualizar directorio."; }
    });
}

document.getElementById('btn-process-asesores').addEventListener('click', async () => {
    const files = document.getElementById('excel-asesores').files;
    const mesTrabajo = document.getElementById('upload-mes').value;
    if (files.length === 0 || !mesTrabajo) return alert("Selecciona el mes destino y los archivos de asesores.");

    uploadStatus.textContent = "Cruzando asesores y purgando... ⏳";
    try {
        const targetClients = database.filter(d => d.tab_type === activeTab && d.mes_anio === mesTrabajo);
        const result = await crossReferenceServicesActivos(files, targetClients);
        tempSafeDatabase = [...result.verified, ...result.unaffected];
        tempPendingPurge = result.pendingPurge;

        if (tempPendingPurge.length > 0) {
            let reportHtml = '';
            tempPendingPurge.forEach((c, index) => {
                reportHtml += `<label class="purge-item"><input type="checkbox" class="purge-checkbox" data-index="${index}" checked><div><strong>${c.cliente} (${c.orden})</strong><br><span style="color:#6e655c;">${c.motivos_eliminacion}</span></div></label>`;
            });
            document.getElementById('report-list').innerHTML = reportHtml;
            document.getElementById('purge-counter').textContent = `${tempPendingPurge.length} seleccionados`;
            document.querySelectorAll('.purge-checkbox').forEach(chk => chk.addEventListener('change', () => {
                document.getElementById('purge-counter').textContent = `${document.querySelectorAll('.purge-checkbox:checked').length} seleccionados`;
            }));
            document.getElementById('report-modal').classList.remove('hidden');
        } else {
            const ops = tempSafeDatabase
                .filter(c => c.firebaseId)
                .map(c => {
                    const data = { ultimo_servicio: c.ultimo_servicio, contactado: c.contactado };
                    if (c.servicio_proactivo) data.servicio_proactivo = c.servicio_proactivo;
                    return { id: c.firebaseId, data };
                });
            if (ops.length > 0) await commitBatchInChunks(ops);
            await syncWithFirebase();
        }
    } catch (err) { console.error(err); uploadStatus.textContent = "Error al filtrar asesores."; }
});

document.getElementById('btn-confirm-purge').addEventListener('click', async () => {
    uploadStatus.textContent = "Actualizando base de datos ☁️...";
    try {
        const ops = [];
        document.querySelectorAll('.purge-checkbox').forEach((chk, index) => {
            const client = tempPendingPurge[index];
            if (chk.checked && client.firebaseId) {
                ops.push({ id: client.firebaseId, data: { tab_type: 'papelera', old_tab: activeTab } });
            }
        });
        tempSafeDatabase.forEach(client => {
            if (client.firebaseId) {
                const data = { ultimo_servicio: client.ultimo_servicio, contactado: client.contactado };
                if (client.servicio_proactivo) data.servicio_proactivo = client.servicio_proactivo;
                ops.push({ id: client.firebaseId, data });
            }
        });

        if (ops.length > 0) await commitBatchInChunks(ops);
        document.getElementById('report-modal').classList.add('hidden');
        await syncWithFirebase();
    } catch (err) { console.error(err); uploadStatus.textContent = "Error al confirmar purga."; }
});

document.getElementById('btn-cancel-report').addEventListener('click', () => {
    document.getElementById('report-modal').classList.add('hidden');
});

const btnEfectivas = document.getElementById('btn-process-efectivas');
if (btnEfectivas) {
    btnEfectivas.addEventListener('click', async () => {
        const fileFacturas = document.getElementById('excel-facturas').files[0];
        const fileAsesores = document.getElementById('excel-efectivas').files[0];
        const mesTrabajo = document.getElementById('upload-mes').value;

        if (!fileFacturas || !fileAsesores || !mesTrabajo) return alert("Debes seleccionar el mes destino y subir ambos archivos.");

        uploadStatus.textContent = "Analizando Facturas y VINs... ⏳";
        try {
            const targetClients = database.filter(d => d.tab_type === activeTab && d.mes_anio === mesTrabajo);
            const resultUpdates = await markEffectiveAppointments(fileFacturas, fileAsesores, targetClients, mesTrabajo);

            if (resultUpdates.length > 0) {
                const ops = resultUpdates.map(u => ({
                    id: u.firebaseId,
                    data: {
                        servicio_realizado: u.servicio_realizado,
                        fecha_factura_efectiva: u.fecha_factura_efectiva,
                        contactado: u.contactado
                    }
                }));
                await commitBatchInChunks(ops);
                await syncWithFirebase();
                alert(`✅ ¡ÉXITO! Se marcaron ${resultUpdates.length} servicios cruzados exitosamente.`);
            } else {
                alert("⚠️ No se encontraron coincidencias para Citas.");
                uploadStatus.textContent = "";
            }
        } catch (err) { console.error(err); uploadStatus.textContent = "Error al procesar el Cruce Taller."; }
    });
}

const btnClearSmart = document.getElementById('btn-clear-data-smart');
if (btnClearSmart) {
    btnClearSmart.addEventListener('click', async () => {
        const mesTrabajo = document.getElementById('upload-mes').value;
        if (!mesTrabajo) return alert("Primero selecciona el 'Mes destino' en la parte superior del panel.");

        const targetTab = activeTab === 'papelera' ? papeleraSubTab : activeTab;
        const registrosABorrar = database.filter(d => 
            (d.tab_type === targetTab && d.mes_anio === mesTrabajo) || 
            (d.tab_type === 'papelera' && d.old_tab === targetTab && d.mes_anio === mesTrabajo)
        );

        if (registrosABorrar.length === 0) return alert(`No hay registros para purgar.`);
        if (prompt("⚠️ ZONA DE PELIGRO ⚠️\nIngresa la clave de autorización para purgar:") !== "1825") return alert("Clave incorrecta.");
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
    // En MODO ALL se desactiva por completo el modo administrador
    const effectiveAdmin = adminMode && !isAllMode;

    // Mostrar/Ocultar pestaña Papelera solo para el Administrador
    const tabPapelera = document.getElementById('tab-papelera');
    if (tabPapelera) {
        if (effectiveAdmin) tabPapelera.classList.remove('hidden');
        else tabPapelera.classList.add('hidden');
    }
    if (!effectiveAdmin && activeTab === 'papelera') {
        activeTab = 'activos';
        document.querySelectorAll('.tabs-container .tab-btn').forEach(b => b.classList.remove('active'));
        const activosBtn = document.querySelector('.tabs-container .tab-btn[data-target="activos"]');
        if (activosBtn) activosBtn.classList.add('active');
        document.getElementById('table-title').textContent = "Directorio de Clientes";
        document.getElementById('stats-panel').classList.remove('hidden');
        document.getElementById('view-filters').classList.remove('hidden');
        document.getElementById('papelera-filters').classList.add('hidden');
    }

    const panelTitle = document.getElementById('title-upload-base');
    const panelDesc = document.getElementById('desc-upload-base');
    const panelOp2 = document.getElementById('panel-opcion-2');
    const panelOp3 = document.getElementById('panel-opcion-3');
    const panelOp4 = document.getElementById('panel-opcion-4'); 
    const btnProcess = document.getElementById('btn-process-excel'); 
    
    if (activeTab === 'papelera' || activeTab === 'rezagados' || !effectiveAdmin) {
        document.getElementById('upload-panel').classList.add('hidden');
    } else if (effectiveAdmin && (activeTab === 'activos' || activeTab === 'primer' || activeTab === 'inactivos')) {
        document.getElementById('upload-panel').classList.remove('hidden');
        if (panelTitle && panelDesc) {
            if (activeTab === 'primer') {
                panelTitle.textContent = "Carga de ventas";
                panelDesc.textContent = "Calcula 6 meses desde fecha de entrega";
                if(btnProcess) btnProcess.textContent = "Procesar";
                if(panelOp2) panelOp2.classList.add('hidden');
                if(panelOp3) panelOp3.classList.add('hidden');
                if(panelOp4) panelOp4.classList.remove('hidden');
            } else if (activeTab === 'inactivos') {
                panelTitle.textContent = "Filtro histórico";
                panelDesc.textContent = "Descarga Excel (1 a 3 años, sin nube)";
                if(btnProcess) btnProcess.textContent = "Descargar Excel"; 
                if(panelOp2) panelOp2.classList.remove('hidden');
                if(panelOp3) panelOp3.classList.remove('hidden');
                if(panelOp4) panelOp4.classList.add('hidden'); 
            } else {
                panelTitle.textContent = "Carga de base";
                panelDesc.textContent = "Filtra a 6 meses y detecta proactivos";
                if(btnProcess) btnProcess.textContent = "Procesar";
                if(panelOp2) panelOp2.classList.remove('hidden');
                if(panelOp3) panelOp3.classList.remove('hidden');
                if(panelOp4) panelOp4.classList.remove('hidden');
            }
        }
    }

    const mesActual = inputMesFiltro.value;
    const allMonths = (isAllMode && activeTab !== 'inactivos') ? getAllModeMonths() : [mesActual];
    const matchMes = (d) => allMonths.includes(d.mes_anio);

    // Actualizar etiqueta superior de meses en MODO ALL según la pestaña activa
    const badgeAll = document.getElementById('all-months-badge');
    if (isAllMode && badgeAll) {
        badgeAll.textContent = allMonths.map(formatMesCorto).join(' · ');
    }

    let baseData = [];
    if (activeTab === 'papelera') {
        baseData = database.filter(d => d.tab_type === 'papelera' && d.old_tab === papeleraSubTab);
    } else if (activeTab === 'rezagados') {
        baseData = database.filter(d => d.contactado === 'DEMORADO' && matchMes(d));
    } else {
        baseData = database.filter(d => d.tab_type === activeTab && matchMes(d));
    }
    
    // KPIs: suman automáticamente los 3 meses en MODO ALL
    if (activeTab !== 'papelera' && activeTab !== 'rezagados') {
        const statTotal = document.getElementById('stat-total');
        if(statTotal) statTotal.textContent = baseData.length;
        
        const statReact = document.getElementById('stat-reactivos');
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
        if (activeTab === 'rezagados') {
            if (currentFilter !== 'reactivos' && currentFilter !== 'all') dataToShow = [];
            dataToShow.sort((a, b) => (calculateNextContact(a).dateObj || new Date(2100,0,1)) - (calculateNextContact(b).dateObj || new Date(2100,0,1)));
        }
        else if (currentFilter === 'proactivos') {
            dataToShow = dataToShow.filter(d => d.contactado === 'PROACTIVO' || d.contactado === 'PROACTIVO_CONFIRMADO');
            dataToShow.sort((a, b) => {
                const parseDate = (dStr) => { if(!dStr) return 0; const p = String(dStr).split('/'); return p.length===3 ? new Date(p[2], p[1]-1, p[0]).getTime() : 0; };
                return parseDate(b.fecha_proactivo) - parseDate(a.fecha_proactivo);
            });
        } 
        else if (currentFilter === 'reactivos') {
            dataToShow = dataToShow.filter(d => d.contactado !== 'CITA_EFECTIVA' && d.contactado !== 'PROACTIVO_CONFIRMADO' && d.contactado !== 'PERDIDO' && d.contactado !== 'PROACTIVO' && d.contactado !== 'DEMORADO' && d.agendo !== 'SI');
            dataToShow.sort((a, b) => (calculateNextContact(a).dateObj || new Date(2100,0,1)) - (calculateNextContact(b).dateObj || new Date(2100,0,1)));
        }
        else if (currentFilter === 'agendados') {
            dataToShow = dataToShow.filter(d => d.agendo === 'SI' && d.contactado !== 'CITA_EFECTIVA');
            dataToShow.sort((a, b) => (a.fecha_cita ? new Date(a.fecha_cita).getTime() : 0) - (b.fecha_cita ? new Date(b.fecha_cita).getTime() : 0));
        }
        else if (currentFilter === 'efectivas') { 
            dataToShow = dataToShow.filter(d => d.contactado === 'CITA_EFECTIVA'); 
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
    let mesHeader = (isAllMode && activeTab !== 'inactivos') ? '<th>MES</th>' : '';
    let extraHeaders = ''; 
    let dynamicDateCol = '<th>PRÓXIMO (6M)</th>';
    let statusHeader = '<th>ESTATUS</th>';
    let actionHeader = '<th style="text-align: right;">ACCIÓN</th>';

    if (activeTab === 'primer' && currentFilter !== 'efectivas' && currentFilter !== 'perdidos') {
        extraHeaders = '<th>VENDEDOR</th>';
    } else if (currentFilter === 'proactivos' && activeTab === 'activos') { 
        extraHeaders = '<th>ASESOR</th>'; 
    } 
    
    if (activeTab === 'inactivos' && currentFilter === 'reactivos') {
        dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
        statusHeader = '<th>AÑO ÚLTIMA VISITA</th>'; 
    } else if (currentFilter === 'proactivos') {
        if (activeTab === 'primer') { dynamicDateCol = '<th style="color:#c98a1c;">FECHA FACTURA</th>'; statusHeader = ''; actionHeader = ''; } 
        else { dynamicDateCol = '<th>FECHA SERVICIO</th>'; }
    } else if (currentFilter === 'reactivos' || activeTab === 'rezagados') { 
        dynamicDateCol = '<th>PRÓXIMO CONTACTO</th>';
    } else if (currentFilter === 'agendados') { 
        dynamicDateCol = '<th>FECHA CITA</th>'; if (effectiveAdmin) extraHeaders += '<th>RETORNO</th>'; 
    } else if (currentFilter === 'efectivas') { 
        dynamicDateCol = '<th style="color:#547a53;">SERVICIO REALIZADO</th>'; 
        statusHeader = '<th style="color:#547a53;">FECHA FACTURA</th>'; actionHeader = ''; 
    } else if (currentFilter === 'perdidos') { 
        dynamicDateCol = '<th>MOTIVO PÉRDIDA</th>'; if (!effectiveAdmin) actionHeader = ''; 
    }
    
    thead.innerHTML = `<tr>${mesHeader}<th>ORDEN / VIN</th><th>CLIENTE</th><th>TELÉFONO</th>${extraHeaders}<th>ÚLTIMO SERVICIO</th>${dynamicDateCol}${statusHeader}${actionHeader}</tr>`;

    if (dataToShow.length === 0) { tableBody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#6e655c; padding: 40px;">No hay registros en esta etapa.</td></tr>`; return; }
    
    let html = '';
    dataToShow.forEach((d) => {
        const realIndex = database.findIndex(x => x.firebaseId === d.firebaseId);
        
        let statusTag = '';
        if (d.contactado === 'PROACTIVO') statusTag = `<span class="status-dot st-proactivo"></span>Por Confirmar`;
        else if (d.contactado === 'PROACTIVO_CONFIRMADO') statusTag = '<span class="status-dot st-efectivo"></span>Confirmado';
        else if (d.contactado === 'PERDIDO') statusTag = '<span class="status-dot st-perdido"></span>Perdido';
        else if (d.contactado === 'CITA_EFECTIVA') statusTag = '<span class="status-dot st-efectivo"></span>Cita Efectiva';
        else if (d.agendo === 'SI') statusTag = '<span class="status-dot st-agendado"></span>Citado';
        else if (d.contactado === 'DEMORADO') statusTag = '<span class="status-dot" style="background:#c98a1c;"></span>Rezagado';
        else statusTag = '<span class="status-dot st-reactivo"></span>Pendiente Cita';

        let tdAction = '';
        if (actionHeader !== '') {
            let actionButtons = `<button class="btn-action-clean" onclick="window.openModal(${realIndex})">Gestionar</button>`;
            
            const today = new Date();
            const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
            if (effectiveAdmin && currentFilter === 'reactivos' && (activeTab === 'activos' || activeTab === 'primer') && mesActual !== currentMonthStr) {
                actionButtons += `<br><button class="btn-corp-outline" style="color:#c98a1c; border-color:#c98a1c; font-size:10px; padding:3px 6px; margin-top:5px; width:100%;" onclick="window.moveToDemorados(${realIndex})">➡️ A Rezagados</button>`;
            }

            if (activeTab === 'papelera') actionButtons = `<button class="btn-action-clean" onclick="window.restoreClient(${realIndex})">Restaurar</button>`;
            else if (effectiveAdmin) actionButtons += `<button class="btn-action-clean" style="color:#722227; border-color:rgba(114,34,39,0.35); margin-left:8px;" onclick="window.deleteClient(${realIndex})">Eliminar</button>`;
            tdAction = `<td style="text-align:right;">${actionButtons}</td>`;
        }

        let servicioText = d.servicio_proactivo || d.ultimo_servicio || 'Por verificar';
        if (currentFilter === 'proactivos' && activeTab === 'primer') servicioText = `<span style="font-weight:600; color:var(--am-ink);">${d.servicio_realizado || 'Servicio Confirmado'}</span>`;

        let fechaColHtml = d.proximo_servicio;
        let statusTagOrDate = statusTag;

        if (activeTab === 'inactivos' && currentFilter === 'reactivos') {
            const nextCont = calculateNextContact(d);
            fechaColHtml = nextCont.isOverdue ? `<span style="color:#ff3b30; font-weight:600;">${nextCont.text} (Atrasado)</span>` : `<span style="color:#6e655c;">${nextCont.text}</span>`;
            statusTagOrDate = `<span style="color:#722227; font-size:11px; font-weight:600;">${d.fecha_ultima_factura || 'Histórica'}</span>`;
        } 
        else if (currentFilter === 'proactivos') {
            if (activeTab === 'primer') fechaColHtml = `<span style="color:var(--am-ink); font-weight:700;">${d.fecha_factura_efectiva || 'Sin Fecha'}</span>`;
            else fechaColHtml = d.fecha_proactivo || d.proximo_servicio || '-';
        }
        else if (currentFilter === 'reactivos' || activeTab === 'rezagados') {
            const nextCont = calculateNextContact(d);
            fechaColHtml = nextCont.isOverdue ? `<span style="color:#ff3b30; font-weight:600;">${nextCont.text} (Atrasado)</span>` : `<span style="color:#6e655c;">${nextCont.text}</span>`;
        } else if (currentFilter === 'agendados') {
            if (d.fecha_cita) { 
                const parts = d.fecha_cita.split('-'); 
                if(parts.length === 3) fechaColHtml = `<span style="color:var(--am-ink); font-weight:600;">${parts[2]}/${parts[1]}/${parts[0]}</span>`;
                else fechaColHtml = `<span style="color:var(--am-ink); font-weight:600;">${d.fecha_cita}</span>`; 
            }
        } else if (currentFilter === 'efectivas') { 
            fechaColHtml = `<span style="color:#547a53; font-weight:700; font-size:11px;">${d.servicio_realizado || 'Mantenimiento Confirmado'}</span>`; 
            statusTagOrDate = `<span style="font-weight:700; color:var(--am-ink);">${d.fecha_factura_efectiva || 'Sin Fecha'}</span>`;
        } else if (currentFilter === 'perdidos') { 
            fechaColHtml = `<span style="color:#6e655c;">${d.motivo_pausa || 'Sin motivo'}</span>`; 
        }

        let extraTd = '';
        if (activeTab === 'primer' && currentFilter !== 'efectivas' && currentFilter !== 'perdidos') {
            let nV = d.vendedor || 'N/A';
            extraTd = `<td><span style="color:var(--am-ink); font-weight:600; font-size:10px;">${nV}</span></td>`;
        } else if (currentFilter === 'proactivos' && activeTab === 'activos') {
            let nA = d.asesor_proactivo || 'N/A';
            if (nA.toUpperCase().includes('JARED')) nA = 'Jared'; else if (nA.toUpperCase().includes('EUGENIA')) nA = 'Eugenia';
            extraTd = `<td><span style="color:var(--am-ink); font-weight:600;">${nA}</span></td>`;
        } 
        
        if (currentFilter === 'agendados' && effectiveAdmin) {
            extraTd += `<td><button class="btn-corp-outline" style="font-size:10px; padding:4px 8px; color:#c98a1c; border-color:#c98a1c;" onclick="window.returnToReactivo(${realIndex})">↺ Retornar</button></td>`;
        }

        let tdStatus = `<td><div style="font-size:12px; font-weight:600; color:var(--am-ink);">${statusTagOrDate}</div></td>`;
        let vinHtml = `<span style="font-size:11px; color:var(--am-muted);">${d.vin || 'N/D'}</span>`;
        
        if (activeTab === 'primer' && currentFilter === 'proactivos') {
            tdStatus = ''; 
            if (effectiveAdmin) vinHtml = `<a href="#" onclick="window.returnProactivoToReactivo(${realIndex}); return false;" style="font-size:11px; color:#c98a1c; text-decoration:underline; font-weight:800; cursor:pointer;" title="Clic para regresar a Reactivos">${d.vin || 'N/D'} ↺</a>`;
        }

        let tdMes = '';
        if (isAllMode && activeTab !== 'inactivos') {
            const idxMes = Math.max(0, allMonths.indexOf(d.mes_anio));
            tdMes = `<td><span class="mes-pill mes-pill-${idxMes}">${formatMesCorto(d.mes_anio)}</span></td>`;
        }

        let filaStyle = activeTab === 'rezagados' ? 'background-color: rgba(201, 138, 28, 0.06);' : '';

        html += `<tr style="${filaStyle}">
            ${tdMes}
            <td><strong>${d.orden_proactivo || d.orden}</strong><br>${vinHtml}</td>
            <td><div style="font-weight:600;">${d.cliente}</div></td>
            <td>${d.telefono}</td>
            ${extraTd}
            <td><div style="font-size:11px; color:var(--am-muted);">${servicioText}</div></td>
            <td>${fechaColHtml}</td>
            ${tdStatus}
            ${tdAction}
        </tr>`;
    });
    tableBody.innerHTML = html;
}
//#endregion

//#region SECCIÓN 9: FUNCIONES GLOBALES Y RESCATE (CERO RE-DESCARGAS)
window.deleteClient = async function(realIndex) { 
    if(confirm("¿Enviar a papelera?")) { 
        const client = database[realIndex];
        const updateObj = { tab_type: 'papelera', old_tab: client.tab_type };
        await updateDoc(doc(db, "clientes", client.firebaseId), updateObj); 
        Object.assign(client, updateObj);
        renderTable(); 
    } 
};

window.restoreClient = async function(realIndex) { 
    const client = database[realIndex];
    const updateObj = { tab_type: client.old_tab, old_tab: null };
    await updateDoc(doc(db, "clientes", client.firebaseId), updateObj); 
    Object.assign(client, updateObj);
    renderTable(); 
};

window.returnToReactivo = async function(realIndex) {
    if(confirm("¿Seguro que deseas retornar este cliente a PENDIENTES DE CITA? Se cancelará su cita agendada.")) {
        const client = database[realIndex];
        const updateObj = { agendo: 'NO', contactado: 'PENDIENTE', fecha_cita: null };
        await updateDoc(doc(db, "clientes", client.firebaseId), updateObj); 
        Object.assign(client, updateObj);
        renderTable(); 
        alert("Cliente retornado a Pendientes exitosamente.");
    }
};

window.moveToDemorados = async function(realIndex) {
    const client = database[realIndex];
    if(confirm(`¿Estás seguro de mover a ${client.cliente} a REZAGADOS?\n\nAl hacer esto, el cliente desaparecerá del mes donde lo estás viendo y será transferido automáticamente al mes actual en curso para que las operadoras le den seguimiento.`)) {
        const today = new Date();
        const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        uploadStatus.textContent = "Transfiriendo cliente a Rezagados... ⏳";
        try {
            const updateObj = { contactado: 'DEMORADO', mes_anio: currentMonthStr };
            await updateDoc(doc(db, "clientes", client.firebaseId), updateObj); 
            Object.assign(client, updateObj);
            renderTable();
            uploadStatus.textContent = "";
            alert(`✅ Cliente rescatado exitosamente.\n\nAhora lo encontrarás en la pestaña "Rezagados" del mes actual (${currentMonthStr}).`);
        } catch (error) {
            console.error(error);
            alert("Error al transferir al cliente.");
        }
    }
};
//#endregion