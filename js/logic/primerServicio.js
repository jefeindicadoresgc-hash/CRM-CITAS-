// ==========================================
// MÓDULO: PRIMER SERVICIO (Ventas Nuevas)
// ==========================================
export async function processPrimerServicio(file, activeTab, mesAnioActual) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                // range: 2 ignora las filas 1 y 2 (Crufer y Libro de Ventas) y toma la fila 3 como encabezados
                const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 2 });
                
                let newRecords = [];

                rawData.forEach(row => {
                    const vin = row['NUMERO DE SERIE'];
                    const cliente = row['NOMBRE DEL CLIENTE'];
                    
                    // Si no hay VIN o Cliente, es una fila vacía o de totales
                    if (!vin || !cliente) return;
                    
                    newRecords.push({
                        id: Date.now() + Math.random(),
                        tab_type: activeTab,
                        mes_anio: mesAnioActual, // Se liga al mes seleccionado
                        orden: vin, // Usamos el VIN como "Orden" para la tabla
                        cliente: cliente.trim(),
                        telefono: row['CELULAR'] || 'Sin Teléfono',
                        auto: row['CARLINE'] || 'No Especificado',
                        modelo_anio: row['MODELO'] || '',
                        vin: String(vin).trim(),
                        kms: 'Venta Nueva',
                        ultimo_servicio: 'Entrega de Auto',
                        proximo_servicio: 'A los 6 meses',
                        contactado: '-', medio: '-', motivo: '-', agendo: '-',
                        comentarios: '', llamadas: []
                    });
                });
                
                resolve(newRecords);
            } catch (error) { reject(error); }
        };
        reader.readAsArrayBuffer(file);
    });
}