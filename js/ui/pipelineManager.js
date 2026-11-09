// =====================================================================
// ARCHIVO: /js/ui/pipelineManager.js
// OBJETIVO: Gestión Visual del Embudo (Timeline, Citas y Pausas) - Apple Pro
// =====================================================================
import { db, doc, updateDoc } from '../config/firebaseConfig.js';

export const TIMELINE_STEPS = [
    { name: "Inv. (45D)", action: "Invitación Inicial (45 días antes)" },
    { name: "Seg 1 (30D)", action: "1er Seguimiento (30 días antes)" },
    { name: "Seg 2 (21D)", action: "2do Seguimiento (21 días antes)" },
    { name: "Seg 3 (15D)", action: "3er Seguimiento (15 días antes)" },
    { name: "Seg 4 (11D)", action: "4to Seguimiento (11 días antes)" },
    { name: "Aviso (3D)", action: "Aviso Urgente (3 días antes)" },
    { name: "Día Cero", action: "Día del Servicio" }
];

let editingIndex = null;
let activeDatabase = [];
let syncCallback = null;
let renderCallback = null;
let viewingStep = 0; 
let proactivoIndex = null;

// =========================================================
// 1. INICIALIZADOR PROTEGIDO (Espera al DOM)
// =========================================================
export function initPipelineManager(dbRef, syncFn, renderFn) {
    activeDatabase = dbRef;
    syncCallback = syncFn;
    renderCallback = renderFn;

    // Conectar botón de cerrar timeline
    const btnClose = document.getElementById('btn-close-x');
    if (btnClose) {
        btnClose.addEventListener('click', () => { 
            document.getElementById('client-modal').classList.add('hidden'); 
            renderCallback(); 
        });
    }

    // Conectar botones del modal Proactivo para evitar Error Null
    const btnProactivoYes = document.getElementById('btn-proactivo-yes');
    if (btnProactivoYes) {
        btnProactivoYes.addEventListener('click', async () => { 
            const client = activeDatabase[proactivoIndex]; 
            await updateDoc(doc(db, "clientes", client.firebaseId), { contactado: 'PROACTIVO_CONFIRMADO', agendo: 'SI', paso_actual: 6 }); 
            document.getElementById('proactivo-modal').classList.add('hidden'); 
            await syncCallback(); 
        });
    }

    const btnProactivoNo = document.getElementById('btn-proactivo-no');
    if (btnProactivoNo) {
        btnProactivoNo.addEventListener('click', async () => { 
            const client = activeDatabase[proactivoIndex]; 
            // Regresa a estado original
            await updateDoc(doc(db, "clientes", client.firebaseId), { contactado: '-', paso_actual: 0 }); 
            document.getElementById('proactivo-modal').classList.add('hidden'); 
            await syncCallback(); 
        });
    }

    const btnProactivoCancel = document.getElementById('btn-proactivo-cancel');
    if (btnProactivoCancel) {
        btnProactivoCancel.addEventListener('click', () => { 
            document.getElementById('proactivo-modal').classList.add('hidden'); 
        });
    }
}

// =========================================================
// 2. LÓGICA DE INTERFAZ Y MÁQUINA DE ESTADOS (VIAJE EN EL TIEMPO)
// =========================================================
window.jumpToStep = function(stepIndex) {
    viewingStep = stepIndex;
    renderTimelineUI(activeDatabase[editingIndex]);
};

window.openModal = function(index) {
    editingIndex = index; 
    const d = activeDatabase[index];
    
    // Asignar el paso actual que vamos a visualizar
    viewingStep = d.paso_actual || 0;
    if (d.agendo === 'SI' || d.contactado === 'CITA_EFECTIVA' || d.contactado === 'PROACTIVO_CONFIRMADO' || d.contactado === 'PERDIDO') {
        viewingStep = 6;
    }
    
    document.getElementById('modal-client-name').textContent = d.cliente;
    document.getElementById('modal-auto').textContent = d.auto || 'N/D'; 
    document.getElementById('modal-anio').textContent = d.modelo_anio || 'N/D'; 
    document.getElementById('modal-vin').textContent = d.vin || 'N/D'; 
    document.getElementById('modal-tel').textContent = d.telefono || 'N/D';
    document.getElementById('modal-ult-servicio').textContent = d.ultimo_servicio || 'Por verificar';
    
    // Formatear Importe si existe
    let importeFormat = 'No registrado';
    if(d.importe && !isNaN(parseFloat(d.importe))) {
        importeFormat = '$' + parseFloat(d.importe).toLocaleString('es-MX', {minimumFractionDigits: 2});
    }
    document.getElementById('modal-importe').textContent = importeFormat;
    
    // Limpiar controles
    document.getElementById('timeline-reason').value = ""; 
    document.getElementById('pause-reason').value = ""; 
    document.getElementById('cita-date').value = "";
    document.getElementById('pause-reason-container').classList.add('hidden'); 
    document.getElementById('cita-date-container').classList.add('hidden');
    
    renderTimelineUI(d); 
    renderModalHistory(d); 
    document.getElementById('client-modal').classList.remove('hidden');
};

window.renderTimelineUI = function(client, stateOverride = 'DEFAULT') {
    let actualStep = client.paso_actual || 0;
    
    let isFinished = (client.contactado === 'CITA_EFECTIVA' || client.contactado === 'PROACTIVO_CONFIRMADO' || client.contactado === 'PERDIDO');
    if (client.agendo === 'SI' || isFinished) actualStep = 6; 

    // 1. DIBUJAR CIRCULOS CLICABLES
    const stepsContainer = document.getElementById('timeline-steps-container'); 
    let circlesHtml = '';
    
    TIMELINE_STEPS.forEach((step, i) => {
        let circleClass = 'step-circle';
        if (i < actualStep) circleClass += ' completed'; 
        if (i === viewingStep) circleClass += ' active';
        
        if (i === 6 && actualStep === 6) {
            if (client.contactado === 'CITA_EFECTIVA' || client.contactado === 'PROACTIVO_CONFIRMADO') circleClass += ' success-end'; 
            else if (client.contactado === 'PERDIDO') circleClass += ' danger-end';
            else if (client.agendo === 'SI') circleClass += ' active'; // Esperando llegada
        }
        
        circlesHtml += `<div class="${circleClass}" style="cursor:pointer;" onclick="jumpToStep(${i})">
            ${i < actualStep ? '✓' : i + 1}
            <div class="step-label">${step.name}</div>
        </div>`;
    });
    stepsContainer.innerHTML = circlesHtml;
    document.getElementById('timeline-fill').style.width = `${(actualStep / (TIMELINE_STEPS.length - 1)) * 100}%`;

    // 2. DIBUJAR BOTONES SEGÚN EL PASO VISUALIZADO
    const title = document.getElementById('action-title'); 
    const desc = document.getElementById('action-desc'); 
    const buttons = document.getElementById('action-buttons');
    
    if (viewingStep < 6) {
        title.textContent = `Gestión: ${TIMELINE_STEPS[viewingStep].name}`;
        desc.textContent = "Registra la interacción con el cliente (Sin emojis):";
        
        if (stateOverride === 'DEFAULT') {
            document.getElementById('pause-reason-container').classList.add('hidden'); 
            document.getElementById('cita-date-container').classList.add('hidden');
            document.getElementById('timeline-reason').classList.remove('hidden');
            buttons.innerHTML = `
                <button class="btn-corp-primary" onclick="renderTimelineUI(activeDatabase[${editingIndex}], 'AGENDANDO')">Agendar Cita</button>
                <button class="btn-corp-outline" onclick="procesarTimeline('AVANZAR')">Guardar y Avanzar</button>
                <button class="btn-corp-danger" onclick="renderTimelineUI(activeDatabase[${editingIndex}], 'PAUSANDO')">Marcar como Perdido</button>
            `;
        } else if (stateOverride === 'AGENDANDO') {
            document.getElementById('timeline-reason').classList.add('hidden');
            document.getElementById('cita-date-container').classList.remove('hidden');
            buttons.innerHTML = `
                <button class="btn-corp-primary" style="background:#34c759;" onclick="procesarTimeline('EXITO_CITA')">Confirmar Cita</button>
                <button class="btn-corp-outline" onclick="renderTimelineUI(activeDatabase[${editingIndex}], 'DEFAULT')">Cancelar</button>
            `;
        } else if (stateOverride === 'PAUSANDO') {
            document.getElementById('timeline-reason').classList.add('hidden');
            document.getElementById('pause-reason-container').classList.remove('hidden');
            buttons.innerHTML = `
                <button class="btn-corp-danger" onclick="procesarTimeline('CONFIRMAR_PAUSA')">Confirmar Pérdida</button>
                <button class="btn-corp-outline" onclick="renderTimelineUI(activeDatabase[${editingIndex}], 'DEFAULT')">Cancelar</button>
            `;
        }
    } else {
        // CASO PASO 6 (Finales)
        title.textContent = "Estado Final";
        document.getElementById('timeline-reason').classList.add('hidden');
        document.getElementById('pause-reason-container').classList.add('hidden'); 
        document.getElementById('cita-date-container').classList.add('hidden');
        
        if (client.agendo === 'SI' && client.contactado !== 'CITA_EFECTIVA') {
            desc.textContent = "El cliente tiene una cita programada. ¿Asistió a su cita?";
            buttons.innerHTML = `
                <button class="btn-corp-primary" style="background:#34c759;" onclick="procesarTimeline('LLEGO_CITA')">Sí, Cita Efectiva</button>
                <button class="btn-corp-danger" onclick="renderTimelineUI(activeDatabase[${editingIndex}], 'PAUSANDO')">No asistió (Perdido)</button>
            `;
        } else {
            desc.textContent = client.contactado === 'PERDIDO' ? `Perdido por: ${client.motivo_pausa}` : "Servicio Completado.";
            buttons.innerHTML = `<button class="btn-corp-outline" onclick="document.getElementById('client-modal').classList.add('hidden')">Cerrar Ventana</button>`;
        }
    }
}

window.procesarTimeline = async function(tipoAccion) {
    const client = activeDatabase[editingIndex];
    const selectedReason = document.getElementById('timeline-reason').value;
    const notaFinal = selectedReason ? ` [Reporte: ${selectedReason}]` : '';
    
    const now = new Date(); 
    const fechaLog = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    let updateObj = {}; 
    let logMsg = "";

    if (tipoAccion === 'EXITO_CITA') {
        const citaStr = document.getElementById('cita-date').value;
        if(!citaStr) return alert("Por favor selecciona la fecha y hora de la cita.");
        
        updateObj.agendo = 'SI'; 
        updateObj.contactado = 'PENDIENTE'; 
        updateObj.paso_actual = 6; 
        updateObj.fecha_cita = citaStr;
        logMsg = `${fechaLog} | CITA AGENDADA (${citaStr.replace('T', ' ')}). Acción desde paso ${viewingStep + 1}.`;
    } 
    else if (tipoAccion === 'CONFIRMAR_PAUSA') {
        const motivo = document.getElementById('pause-reason').value;
        if(!motivo) return alert("Selecciona un motivo.");
        
        updateObj.contactado = 'PERDIDO'; 
        updateObj.agendo = 'NO'; 
        updateObj.paso_actual = 6; 
        updateObj.motivo_pausa = motivo;
        logMsg = `${fechaLog} | CLIENTE PERDIDO: ${motivo}.`;
    }
    else if (tipoAccion === 'LLEGO_CITA') {
        updateObj.contactado = 'CITA_EFECTIVA';
        logMsg = `${fechaLog} | CITA EFECTIVA (El cliente asistió al taller).`;
    }
    else if (tipoAccion === 'AVANZAR') {
        if(!selectedReason) return alert("Selecciona un motivo del listado superior.");
        let nextStep = viewingStep + 1;
        
        // Si retoma a un cliente perdido o agendado desde un paso anterior
        if (client.agendo === 'SI' || client.contactado === 'PERDIDO' || client.paso_actual >= 6) {
            updateObj.agendo = 'NO'; 
            updateObj.contactado = 'PENDIENTE'; 
            updateObj.motivo_pausa = '';
        }
        
        updateObj.paso_actual = nextStep;
        logMsg = `${fechaLog} | Paso ${viewingStep + 1}: ${selectedReason}`;
        document.getElementById('timeline-reason').value = ""; 
    }

    const nuevasLlamadas = [...(client.llamadas || []), logMsg]; 
    updateObj.llamadas = nuevasLlamadas;

    document.getElementById('action-desc').textContent = "Sincronizando con la nube..."; 
    document.getElementById('action-buttons').innerHTML = "";
    
    await updateDoc(doc(db, "clientes", client.firebaseId), updateObj);
    
    Object.assign(client, updateObj); 
    viewingStep = client.paso_actual || 0; 
    renderTimelineUI(client); 
    renderModalHistory(client);
    
    syncCallback(); 
};

// =========================================================
// 3. FUNCIONES GLOBALES (Expuestas)
// =========================================================
function renderModalHistory(client) { 
    document.getElementById('modal-history').innerHTML = (client.llamadas || []).length === 0 ? "<em>Sin historial previo.</em>" : (client.llamadas || []).slice().reverse().map((f) => `<div style="margin-bottom:8px; border-bottom: 1px solid #eee; padding-bottom: 5px; color:#495057;">${f}</div>`).join(''); 
}

window.abrirModalProactivo = function(index) { 
    proactivoIndex = index; 
    document.getElementById('proactivo-name').textContent = activeDatabase[index].cliente; 
    document.getElementById('proactivo-vin-text').textContent = activeDatabase[index].vin || 'N/D'; 
    document.getElementById('proactivo-modal').classList.remove('hidden'); 
};