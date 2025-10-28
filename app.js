// app.js

// ************************************************************
// 1. CONFIGURACIÓN DE FIREBASE (REEMPLAZA CON TUS CREDENCIALES)
// ************************************************************
const firebaseConfig = {
    apiKey: "TU_API_KEY_DE_FIREBASE",
    authDomain: "TU_PROJECT_ID.firebaseapp.com",
    projectId: "TU_PROJECT_ID",
    storageBucket: "TU_PROJECT_ID.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:xxxxxxxxxxxx"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const leadsCollection = db.collection('leads');
const sellersCollection = db.collection('sellers');

// ************************************************************
// 2. UTILIDADES Y MANEJO DE VISTAS
// ************************************************************

/** Muestra un mensaje de feedback */
function showFeedback(message, isSuccess = true) {
    const container = document.getElementById('feedback-message');
    container.innerHTML = `<div class='${isSuccess ? 'success-message' : 'error-message'}'>${message}</div>`;
    setTimeout(() => { container.innerHTML = ''; }, 10000);
}

/** Toggle de visibilidad de secciones */
function setupToggle(buttonId, sectionId, iconClass, defaultText, hideText, successColor, defaultColor) {
    const button = document.getElementById(buttonId);
    const section = document.getElementById(sectionId);

    button.addEventListener('click', function() {
        if (section.classList.contains('hidden')) {
            section.classList.remove('hidden');
            button.innerHTML = `<i class="fas fa-times-circle"></i> ${hideText}`;
            button.style.backgroundColor = successColor;
        } else {
            section.classList.add('hidden');
            button.innerHTML = `<i class="${iconClass}"></i> ${defaultText}`;
            button.style.backgroundColor = defaultColor;
        }
    });
}

/** Carga de datos inicial */
document.addEventListener('DOMContentLoaded', () => {
    // Configurar botones ocultar/mostrar
    setupToggle('toggle-sale-form', 'sale-registration-section', 'fas fa-search-dollar', 'Registrar/Buscar Venta', 'Ocultar Registro de Venta', '#dc3545', '#f7931e');
    setupToggle('toggle-upload-form', 'upload-section', 'fas fa-file-upload', 'Mostrar Carga de Archivo', 'Ocultar Carga de Archivo', '#dc3545', '#1a73e8');
    
    // Configurar Reloj
    setInterval(updateClock, 1000);
    updateClock();
    
    // FORZAR MAYÚSCULAS
    document.getElementById('register_seller_name').addEventListener('input', function() {
        this.value = this.value.toUpperCase();
    });

    // Cargar todas las estadísticas e historial al iniciar
    loadStats();
    loadHistory();
});

// ************************************************************
// 3. LÓGICA DE CARGA DE ARCHIVOS (SUBIDA)
// ************************************************************

document.getElementById('upload-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('excel_file_input');
    const batchName = document.getElementById('batch_name_input').value.trim();
    const file = fileInput.files[0];
    
    if (!file || !batchName) {
        showFeedback("Debe seleccionar un archivo y un nombre de lote.", false);
        return;
    }

    const submitBtn = document.getElementById('submit-btn');
    const progressBarContainer = document.getElementById('progress-bar-container');
    const progressBar = document.getElementById('progress-bar');
    submitBtn.disabled = true;
    progressBarContainer.style.display = 'block';
    
    // Simulación de barra de progreso
    let progress = 0;
    const interval = setInterval(() => {
        progress += 2;
        if (progress < 95) {
            progressBar.style.width = progress + '%';
            progressBar.textContent = progress + '%';
        }
    }, 100);

    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        let insertedCount = 0;
        let duplicatedCount = 0;
        const uploadDate = firebase.firestore.Timestamp.now();
        const batchId = uploadDate.toDate().getTime().toString(); 

        const batch = db.batch();
        const phoneNumbers = new Set();
        
        // Asumiendo que las columnas son: [Teléfono, Nombre, Compañía, Estado, Agente]
        for (let i = 1; i < rows.length; i++) { // Empezar desde la segunda fila (datos)
            const row = rows[i];
            const phoneNumber = String(row[0]).trim(); 
            
            if (!phoneNumber || phoneNumbers.has(phoneNumber)) {
                if (phoneNumber) duplicatedCount++;
                continue;
            }
            phoneNumbers.add(phoneNumber);
            
            // Verifica si el lead ya existe por número de teléfono
            const existingLead = await leadsCollection.where('phone', '==', phoneNumber).limit(1).get();
            
            if (existingLead.empty) {
                const leadData = {
                    phone: phoneNumber,
                    firstName: row[1] || '',
                    company: row[2] || '',
                    state: row[3] || '',
                    agenteLeads: row[4] || '',
                    isSale: false,
                    saleDate: null,
                    saleType: null,
                    saleAmount: 0,
                    sellerName: null,
                    uploadDate: uploadDate,
                    batchName: batchName,
                    batchId: batchId
                };
                
                // Añadir a la operación por lotes (batch)
                const newDocRef = leadsCollection.doc();
                batch.set(newDocRef, leadData);
                insertedCount++;
            } else {
                duplicatedCount++;
            }
        }
        
        // Ejecutar el batch de inserción
        await batch.commit();

        clearInterval(interval);
        progressBar.style.width = '100%';
        progressBar.textContent = '100% (Completado)';

        showFeedback(`🎉 ¡Subida Exitosa! Se insertaron ${insertedCount} registros. ${duplicatedCount > 0 ? `Se omitieron ${duplicatedCount} duplicados.` : ''}`);
        
    } catch (error) {
        clearInterval(interval);
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        showFeedback(`Error al procesar el archivo: ${error.message}`, false);
    } finally {
        submitBtn.disabled = false;
        progressBarContainer.style.display = 'none';
        loadStats(); // Recargar stats después de la subida
        loadHistory();
        fileInput.value = '';
    }
});

// ************************************************************
// 4. LÓGICA DE BÚSQUEDA Y REGISTRO DE VENTA
// ************************************************************

document.getElementById('sale-search-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    const phone = document.getElementById('search_phone').value.trim();
    const sellerName = document.getElementById('register_seller_name').value.trim();
    const saleType = document.getElementById('sale_type_select').value; 
    const saleAmount = parseFloat(document.getElementById('sale_amount_input').value);
    const container = document.getElementById('lead-info-container');
    container.style.display = 'none';

    if (!sellerName || isNaN(saleAmount) || saleAmount <= 0) {
        showFeedback("Por favor, complete el vendedor y el monto de la venta.", false);
        return;
    }

    try {
        const querySnapshot = await leadsCollection.where('phone', '==', phone).limit(1).get();
        
        if (querySnapshot.empty) {
            container.innerHTML = `<p style="color: orange; font-weight: bold;">El número ${phone} no se encontró en la base de datos.</p>`;
        } else {
            const doc = querySnapshot.docs[0];
            const lead = doc.data();
            const docId = doc.id;
            
            const saleStatus = lead.isSale 
                ? `✅ **VENDIDO (${lead.saleType}, $${lead.saleAmount.toFixed(2)})** el ${lead.saleDate ? new Date(lead.saleDate.seconds * 1000).toLocaleDateString() : 'N/A'}`
                : "❌ **Pendiente**";
            
            const buttonText = `Registrar Venta (${saleType}) por **$${saleAmount.toFixed(2)}** por **${sellerName}**`;
            
            let html = `<h4><i class='fas fa-user-check'></i> Información del Lead Encontrado:</h4>
                <ul>
                    <li>**Número:** ${lead.phone}</li>
                    <li>**Nombre:** ${lead.firstName}</li>
                    <li>**Agente Leads:** ${lead.agenteLeads}</li>
                    <li>**Vendedor (Última Venta):** ${lead.sellerName || 'N/A'}</li>
                    <li>**Estado de Venta:** <span style='font-weight: bold; color: ${lead.isSale ? 'green' : 'red'}'>${saleStatus}</span></li>
                </ul>`;

            if (!lead.isSale || saleType === 'CHARGE') { // Permitir CHARGE incluso si ya está vendido
                html += `<button id='register-sale-btn' data-doc-id='${docId}' 
                        data-phone='${lead.phone}' 
                        data-seller='${sellerName}' 
                        data-type='${saleType}' 
                        data-amount='${saleAmount}' 
                        style='padding: 10px 20px; background-color: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 15px;'>
                        <i class='fas fa-check-circle'></i> ${buttonText}
                    </button>`;
            } else {
                html += `<p style='color: green; margin-top: 15px; font-weight: bold;'><i class='fas fa-info-circle'></i> Este lead ya está marcado como venta NEW.</p>`;
            }
            container.innerHTML = html;
        }
        container.style.display = 'block';
    } catch (error) {
        showFeedback(`Error al buscar el lead: ${error.message}`, false);
    }
});

document.getElementById('lead-info-container').addEventListener('click', async function(e) {
    if (e.target.id === 'register-sale-btn') {
        const docId = e.target.getAttribute('data-doc-id');
        const phone = e.target.getAttribute('data-phone');
        const sellerName = e.target.getAttribute('data-seller');
        const saleType = e.target.getAttribute('data-type');
        const saleAmount = parseFloat(e.target.getAttribute('data-amount'));

        try {
            // 1. Registrar/Obtener ID del Vendedor (Firestore no necesita tabla sellers, solo registro)
            // Aquí podríamos omitir la colección 'sellers' y solo guardar el nombre en el lead.
            // Para mantener la lógica anterior, guardaremos una referencia, pero simplificado.

            // 2. Actualizar el Lead
            await leadsCollection.doc(docId).update({
                isSale: true,
                saleDate: firebase.firestore.Timestamp.now(),
                saleType: saleType,
                saleAmount: saleAmount,
                sellerName: sellerName,
            });

            showFeedback(`💰 Venta Registrada! El número ${phone} se ha marcado como vendido.`, true);
            document.getElementById('lead-info-container').style.display = 'none';
            document.getElementById('search_phone').value = '';
            
            // Recargar todas las vistas
            loadStats();
            loadHistory();

        } catch (error) {
            showFeedback(`Error al registrar la venta: ${error.message}`, false);
        }
    }
});

// ************************************************************
// 5. LÓGICA DE ESTADÍSTICAS Y HISTORIAL (CARGA DE DATOS)
// ************************************************************

/** Carga las estadísticas globales y genera las opciones del filtro */
async function loadStats() {
    try {
        const filterMonth = document.getElementById('filter_month').value;
        let query = leadsCollection.orderBy('uploadDate', 'desc');

        if (filterMonth) {
            // Firestore no soporta wildcards de texto, por lo que filtramos por rango de fecha
            const [year, month] = filterMonth.split('-');
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0, 23, 59, 59); // Final del mes

            query = leadsCollection
                .where('uploadDate', '>=', startDate)
                .where('uploadDate', '<=', endDate);
        }

        const snapshot = await query.get();
        let totalLeads = snapshot.size;
        let totalSales = 0;
        let totalAmount = 0;
        
        const monthOptions = new Map();

        snapshot.forEach(doc => {
            const lead = doc.data();
            
            // Generar opciones de meses (solo una vez)
            const uploadMonth = lead.uploadDate.toDate().toISOString().substring(0, 7);
            if (!monthOptions.has(uploadMonth)) {
                monthOptions.set(uploadMonth, new Date(uploadMonth).toLocaleDateString('es-ES', { year: 'numeric', month: 'long' }));
            }
            
            if (lead.isSale) {
                totalSales++;
                totalAmount += lead.saleAmount || 0;
            }
        });

        const conversionRate = totalLeads > 0 ? ((totalSales / totalLeads) * 100).toFixed(2) : 0;

        // Actualizar el DOM
        document.getElementById('total-leads').textContent = totalLeads.toLocaleString();
        document.getElementById('total-sales').textContent = totalSales.toLocaleString();
        document.getElementById('total-amount').textContent = `$${totalAmount.toFixed(2)}`;
        document.getElementById('conversion-rate').textContent = `${conversionRate}%`;
        
        // Generar filtro de meses
        const filterSelect = document.getElementById('filter_month');
        const currentFilter = filterSelect.value;
        filterSelect.innerHTML = '<option value="">-- Todos los Meses --</option>';
        monthOptions.forEach((name, value) => {
            const selected = value === currentFilter ? 'selected' : '';
            filterSelect.innerHTML += `<option value="${value}" ${selected}>${name}</option>`;
        });

    } catch (error) {
        showFeedback(`Error al cargar estadísticas: ${error.message}`, false);
    }
}

/** Carga el historial de subidas */
async function loadHistory() {
    try {
        // Consultar los lotes (agrupando por batchId)
        // Nota: Firestore no tiene GROUP BY. Hay que simularlo con la lógica de consulta.
        const historySnapshot = await leadsCollection
            .orderBy('uploadDate', 'desc')
            .get();
        
        const batches = new Map();

        historySnapshot.forEach(doc => {
            const lead = doc.data();
            if (!lead.batchId) return;

            if (!batches.has(lead.batchId)) {
                batches.set(lead.batchId, {
                    id: lead.batchId,
                    name: lead.batchName,
                    date: lead.uploadDate.toDate().toLocaleDateString(),
                    totalLeads: 0,
                    totalSales: 0
                });
            }
            
            const batch = batches.get(lead.batchId);
            batch.totalLeads++;
            if (lead.isSale) {
                batch.totalSales++;
            }
        });

        const container = document.getElementById('history-container');
        let html = '<ul class="history-list">';

        batches.forEach(batch => {
            const conversionRate = batch.totalLeads > 0 ? ((batch.totalSales / batch.totalLeads) * 100).toFixed(2) : 0;
            
            html += `<li class='history-item'>
                <div style='display: flex; justify-content: space-between; align-items: center;'>
                    <span style='flex-grow: 1; margin-right: 10px;'>
                        <i class='fas fa-folder-open'></i> **${batch.name}** (Subido el ${batch.date})
                        <small style="margin-left: 10px;">Leads: ${batch.totalLeads} | Ventas: ${batch.totalSales} | Tasa: ${conversionRate}%</small>
                    </span>
                    
                    <a href='#' class='download-btn' data-batch-id='${batch.id}' data-batch-name='${batch.name}'
                        style='padding: 8px 12px; background-color: #007bff; color: white; border-radius: 5px; text-decoration: none; font-size: 0.9em;' title='Descargar Leads de ${batch.name}'>
                        <i class='fas fa-download'></i> Excel
                    </a>
                </div>
            </li>`;
        });
        
        html += '</ul>';
        container.innerHTML = html;

    } catch (error) {
        showFeedback(`Error al cargar el historial: ${error.message}`, false);
    }
}


// ************************************************************
// 6. LÓGICA DE DESCARGA (GENERACIÓN DE EXCEL EN EL CLIENTE)
// ************************************************************

document.getElementById('history-container').addEventListener('click', async function(e) {
    if (e.target.classList.contains('download-btn') || e.target.closest('.download-btn')) {
        e.preventDefault();
        const btn = e.target.closest('.download-btn');
        const batchId = btn.getAttribute('data-batch-id');
        const batchName = btn.getAttribute('data-batch-name');
        
        showFeedback(`Preparando descarga para el lote ${batchName}...`, true);

        try {
            const snapshot = await leadsCollection.where('batchId', '==', batchId).get();

            if (snapshot.empty) {
                showFeedback("No se encontraron leads para el lote seleccionado.", false);
                return;
            }

            const data = [
                ['PHONE NUMBER', 'FIRST NAME', 'COMPANY', 'STATE', 'AGENTE LEADS', 'IS SALE', 'SALE DATE', 'SALE TYPE', 'SALE AMOUNT', 'SELLER NAME', 'UPLOAD DATE']
            ];

            snapshot.forEach(doc => {
                const lead = doc.data();
                data.push([
                    lead.phone,
                    lead.firstName,
                    lead.company,
                    lead.state,
                    lead.agenteLeads,
                    lead.isSale ? 'VENDIDO' : 'PENDIENTE',
                    lead.saleDate ? lead.saleDate.toDate().toLocaleDateString() : '',
                    lead.saleType || '',
                    lead.saleAmount || 0,
                    lead.sellerName || '',
                    lead.uploadDate.toDate().toLocaleDateString()
                ]);
            });

            // Generar el archivo Excel (SheetJS)
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, batchName.substring(0, 31));

            const fileName = batchName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s/g, '_') + "_" + new Date().toISOString().substring(0, 10) + ".xlsx";

            XLSX.writeFile(wb, fileName);
            showFeedback(`Descarga completa de ${fileName}.`, true);

        } catch (error) {
            showFeedback(`Error al generar la descarga: ${error.message}`, false);
        }
    }
});


// ************************************************************
// 7. RELOJ
// ************************************************************

function updateClock() {
    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    
    const dateStr = now.toLocaleDateString('es-ES', dateOptions);
    const timeStr = now.toLocaleTimeString('es-ES', timeOptions);
    
    document.getElementById('current-datetime').innerHTML = `
        ${dateStr.charAt(0).toUpperCase() + dateStr.slice(1)} <br> ${timeStr}
    `;
}
