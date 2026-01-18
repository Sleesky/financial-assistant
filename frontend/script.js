let myChart = null;
let globalReceipts = [];
let filesToUpload = [];
let currentErrorFilename = null;
let receiptIdToDelete = null; // ID pojedynczego usuwania
let isBatchDelete = false;    // Flaga czy usuwamy grupowo
let isSelectionMode = false;
let selectedReceiptsIds = new Set();
let chatHistory = []; // Pamięć podręczna rozmowy

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
    loadData();
    switchView('dashboard');

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }

    initDatePickers();

    const chatInput = document.getElementById('chatInput');
    if(chatInput) {
        chatInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                sendMessage();
            }
        });
    }
});

function initDatePickers() {
    const config = {
        locale: "pl",
        dateFormat: "Y-m-d",
        disableMobile: "true",
        theme: "light"
    };

    flatpickr("#date-from", { ...config, onChange: function() { renderFullHistoryPage(); } });
    flatpickr("#date-to", { ...config, onChange: function() { renderFullHistoryPage(); } });
    flatpickr("#modal-date", config);
}

function clearSingleDate(inputId) {
    const picker = document.querySelector(`#${inputId}`)._flatpickr;
    if (picker) {
        picker.clear();
        renderFullHistoryPage();
    }
}

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
    if(globalReceipts.length > 0) loadDashboard(globalReceipts);
}

// --- CSV ---
function exportToCSV() {
    let dataToExport = [];
    if (isSelectionMode && selectedReceiptsIds.size > 0) {
        dataToExport = globalReceipts.filter(r => selectedReceiptsIds.has(r.id));
    } else {
        dataToExport = [...globalReceipts];
    }

    if (dataToExport.length === 0) {
        alert("Brak danych do wyeksportowania.");
        return;
    }

    dataToExport.sort((a, b) => new Date(a.date) - new Date(b.date));

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "\uFEFF";
    csvContent += "Data;Sklep;Kategoria;Kwota (PLN);Produkty\n";

    dataToExport.forEach(r => {
        const itemsStr = r.items ? r.items.map(i => `${i.name} (${i.price})`).join(", ") : "";
        const row = [
            `"${r.date || ''}"`,
            `"${r.store_name || ''}"`,
            `"${r.category || ''}"`,
            r.total_amount.toFixed(2).replace('.', ','),
            `"${itemsStr}"`
        ].join(";");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const dateStr = new Date().toISOString().slice(0,10);
    const fileName = (isSelectionMode && selectedReceiptsIds.size > 0)
        ? `wybrane_wydatki_${selectedReceiptsIds.size}_szt_${dateStr}.csv`
        : `wszystkie_wydatki_chronologicznie_${dateStr}.csv`;

    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- DELETE ---
function askDeleteReceipt(event, id) {
    if(event) event.stopPropagation();
    receiptIdToDelete = id;
    isBatchDelete = false;
    document.querySelector('#delete-confirmation-modal h3').innerText = "Usunąć ten paragon?";
    document.querySelector('#delete-confirmation-modal p').innerText = "Tej operacji nie można cofnąć.";
    document.getElementById('delete-confirmation-modal').style.display = 'flex';
}

function deleteSelectedReceipts() {
    if (selectedReceiptsIds.size === 0) return;
    isBatchDelete = true;
    receiptIdToDelete = null;
    const count = selectedReceiptsIds.size;
    document.querySelector('#delete-confirmation-modal h3').innerText = `Usunąć ${count} paragonów?`;
    document.querySelector('#delete-confirmation-modal p').innerText = "Zostaną trwale usunięte z historii.";
    document.getElementById('delete-confirmation-modal').style.display = 'flex';
}

async function confirmDelete() {
    closeModal('delete-confirmation-modal');
    if (isBatchDelete) {
        try {
            const response = await fetch('/api/receipts/batch-delete', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ids: Array.from(selectedReceiptsIds)})
            });
            if (response.ok) {
                toggleSelectionMode();
                loadData();
            } else { alert("Błąd podczas usuwania."); }
        } catch (e) { console.error(e); alert("Błąd połączenia."); }
        return;
    }
    if (receiptIdToDelete) {
        try {
            const response = await fetch(`/api/receipts/${receiptIdToDelete}`, { method: 'DELETE' });
            if (response.ok) loadData();
            else alert("Błąd serwera.");
        } catch (e) { console.error(e); alert("Błąd połączenia."); }
        finally { receiptIdToDelete = null; }
    }
}

// --- MODALS ---
function openModal(id) {
    // 1. Znajdź paragon
    const r = globalReceipts.find(item => item.id == id);
    if (!r) return;

    // 2. Ustaw ID, Sklep, Datę i Kategorię
    document.getElementById('modal-receipt-id').value = r.id;
    document.getElementById('modal-store').value = r.store_name;

    const datePicker = document.querySelector("#modal-date")._flatpickr;
    if(datePicker) datePicker.setDate(r.date);

    document.getElementById('modal-category').value = r.category;

    // 3. Ustaw Sumę Całkowitą
    const totalInput = document.getElementById('modal-total');
    totalInput.value = r.total_amount.toFixed(2);

    // --- NOWA BLOKADA DLA SUMY GŁÓWNEJ ---
    // Nadpisujemy zdarzenie oninput, żeby blokowało wpisywanie 3 cyfr po przecinku
    totalInput.oninput = function() {
        if(this.value.includes('.')) {
            let parts = this.value.split('.');
            if(parts[1].length > 2) {
                this.value = parts[0] + '.' + parts[1].slice(0, 2);
            }
        }
    };

    // 4. Wyczyść listę produktów i zbuduj ją na nowo
    const tbody = document.getElementById('modal-items');
    tbody.innerHTML = "";

    if (r.items && r.items.length > 0) {
        r.items.forEach(item => {
            // Bezpieczne wyświetlanie
            let safePrice = "";
            if (item.price !== undefined && item.price !== null) {
                safePrice = parseFloat(item.price).toFixed(2);
            }
            addNewItemRow(item.name, safePrice);
        });
    } else {
        addNewItemRow();
    }

    // 5. Pokaż okno
    document.getElementById('details-modal').style.display = 'flex';
}

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewName}`).classList.add('active');
    const navLink = document.getElementById(`nav-${viewName}`);
    if (navLink) navLink.classList.add('active');
    if (viewName === 'history') { renderFullHistoryPage(); }
}

async function loadData() {
    try {
        const response = await fetch('/api/receipts');
        globalReceipts = await response.json();
        updateStats(globalReceipts);
        loadDashboard(globalReceipts);
        renderRecentTransactions(globalReceipts);
        renderFullHistoryPage();
    } catch (error) { console.error(error); }
}

function renderRecentTransactions(receipts) {
    const list = document.getElementById('recent-list');
    list.innerHTML = '';
    if (receipts.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-muted)">Brak danych.</p>';
        return;
    }
    const recent = receipts.slice().sort((a,b) => b.id - a.id).slice(0, 6);
    recent.forEach(r => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.onclick = () => openModal(r.id);
        let icon='fa-receipt'; let bg='bg-blue';
        const cat=(r.category||"").toLowerCase();
        if(cat.includes('spoż')) { icon='fa-carrot'; bg='bg-green'; }
        else if(cat.includes('paliwo')) { icon='fa-gas-pump'; bg='bg-orange'; }
        else if(cat.includes('elektr')) { icon='fa-plug'; bg='bg-purple'; }
        else if(cat.includes('rest')) { icon='fa-utensils'; bg='bg-red'; }
        else if(cat.includes('farma')) { icon='fa-pills'; bg='bg-blue'; }
        item.innerHTML = `
            <div class="history-left">
                <div class="history-icon-wrapper ${bg}"><i class="fa-solid ${icon}"></i></div>
                <div class="history-info"><strong>${r.store_name}</strong><span class="history-sub">${r.date}</span></div>
            </div>
            <div class="item-right"><span class="history-amount">${r.total_amount.toFixed(2)} zł</span></div>
        `;
        list.appendChild(item);
    });
}

function updateStats(receipts) {
    if (!receipts) receipts = [];
    const total = receipts.reduce((sum, r) => sum + (r.total_amount || 0), 0);
    document.getElementById('stat-total').innerText = total.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + " zł";
    document.getElementById('stat-count').innerText = receipts.length;
    const catCounts = {};
    receipts.forEach(r => { const cat = r.category || "Inne"; catCounts[cat] = (catCounts[cat] || 0) + r.total_amount; });
    let topCat = "---"; let maxVal = 0;
    for (const [cat, val] of Object.entries(catCounts)) { if (val > maxVal) { maxVal = val; topCat = cat; } }
    document.getElementById('stat-top-cat').innerText = topCat;
}

function loadDashboard(receipts) {
    if (!receipts) return;
    const catTotals = {};
    receipts.forEach(r => catTotals[r.category] = (catTotals[r.category] || 0) + r.total_amount);
    const ctx = document.getElementById('expensesChart').getContext('2d');
    if (myChart) myChart.destroy();
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    myChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(catTotals),
            datasets: [{
                data: Object.values(catTotals),
                backgroundColor: ['#0071e3', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { color: textColor, font: {family: "'Inter', sans-serif"}, usePointStyle: true, padding: 15 } } },
            cutout: '75%', layout: { padding: 10 }
        }
    });
}

function renderFullHistoryPage() {
    const container = document.getElementById('full-history-list');
    container.innerHTML = '';
    const search = document.getElementById('search-input').value.toLowerCase();
    const dFrom = document.getElementById('date-from').value;
    const dTo = document.getElementById('date-to').value;

    let filtered = globalReceipts.filter(r => {
        const textMatch = (r.store_name || "").toLowerCase().includes(search) || (r.category || "").toLowerCase().includes(search);
        let dateMatch = true;
        if (dFrom && r.date < dFrom) dateMatch = false;
        if (dTo && r.date > dTo) dateMatch = false;
        return textMatch && dateMatch;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; margin-top:50px; color:var(--text-muted);">Brak wyników</div>';
        return;
    }

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    const groups = {};
    filtered.forEach(r => {
        const dateKey = r.date || "Bez daty";
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(r);
    });

    for (const [date, items] of Object.entries(groups)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'timeline-group';
        const dateObj = new Date(date);
        const dateStr = isNaN(dateObj) ? date : dateObj.toLocaleDateString('pl-PL', {month: 'long', day: 'numeric'});
        const yearStr = isNaN(dateObj) ? "" : dateObj.getFullYear();
        groupDiv.innerHTML = `<div class="timeline-header">${dateStr} <small>${yearStr}</small></div><div class="timeline-list"></div>`;
        const listDiv = groupDiv.querySelector('.timeline-list');

        items.forEach(r => {
            const el = document.createElement('div');
            el.className = 'timeline-item';
            el.dataset.id = r.id;
            el.onclick = () => {
                if (isSelectionMode) toggleReceiptSelection(r.id, el);
                else openModal(r.id);
            };
            let icon = 'fa-receipt'; let bg = 'bg-blue';
            const cat = (r.category || "").toLowerCase();
            if (cat.includes('spoż')) { icon = 'fa-carrot'; bg = 'bg-green'; }
            else if (cat.includes('paliwo')) { icon = 'fa-gas-pump'; bg = 'bg-orange'; }
            else if (cat.includes('elektr')) { icon = 'fa-plug'; bg = 'bg-purple'; }
            else if(cat.includes('rest')) { icon='fa-utensils'; bg='bg-red'; }
            else if(cat.includes('farma')) { icon='fa-pills'; bg='bg-blue'; }

            const checkDisplay = isSelectionMode ? 'flex' : 'none';
            const isSelected = selectedReceiptsIds.has(r.id);
            if (isSelected) el.classList.add('selected');

            el.innerHTML = `
                <div class="select-mode-wrapper" style="display: ${checkDisplay}">
                    <div class="custom-checkbox"><i class="fa-solid fa-check"></i></div>
                </div>
                <div class="t-left">
                    <div class="t-icon ${bg}"><i class="fa-solid ${icon}"></i></div>
                    <div class="t-info"><strong>${r.store_name}</strong><span>${r.category}</span></div>
                </div>
                <div class="t-right">
                    <div class="t-price">${r.total_amount.toFixed(2)} zł</div>
                    <div class="t-actions">
                        <i class="fa-regular fa-trash-can" style="color:var(--danger)" onclick="askDeleteReceipt(event, ${r.id})"></i>
                    </div>
                </div>
            `;
            listDiv.appendChild(el);
        });
        container.appendChild(groupDiv);
    }
}

function toggleSelectionMode() {
    isSelectionMode = !isSelectionMode;
    selectedReceiptsIds.clear();
    document.getElementById('history-normal-actions').style.display = isSelectionMode ? 'none' : 'flex';
    document.getElementById('history-select-actions').style.display = isSelectionMode ? 'flex' : 'none';
    updateSelectionCount();
    const listContainer = document.getElementById('full-history-list');
    if (isSelectionMode) listContainer.classList.add('selection-active');
    else listContainer.classList.remove('selection-active');
    document.querySelectorAll('.select-mode-wrapper').forEach(el => {
        el.style.display = isSelectionMode ? 'flex' : 'none';
    });
    document.querySelectorAll('.timeline-item').forEach(el => el.classList.remove('selected'));
}

function toggleReceiptSelection(id, rowElement) {
    if (selectedReceiptsIds.has(id)) {
        selectedReceiptsIds.delete(id);
        rowElement.classList.remove('selected');
    } else {
        selectedReceiptsIds.add(id);
        rowElement.classList.add('selected');
    }
    updateSelectionCount();
}

function toggleSelectAll() {
    const visibleItems = document.querySelectorAll('.timeline-item');
    if(visibleItems.length === 0) return;
    const allSelected = Array.from(visibleItems).every(el => el.classList.contains('selected'));
    if (allSelected) {
        selectedReceiptsIds.clear();
        visibleItems.forEach(el => el.classList.remove('selected'));
    } else {
        visibleItems.forEach(el => {
            const id = parseInt(el.dataset.id);
            if(id) {
                selectedReceiptsIds.add(id);
                el.classList.add('selected');
            }
        });
    }
    updateSelectionCount();
}

function updateSelectionCount() {
    const count = selectedReceiptsIds.size;
    const label = document.getElementById('selected-count-label');
    label.innerText = count === 1 ? '1 zaznaczony' : `${count} zaznaczonych`;
}

// --- UPLOAD ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('receiptInput');

if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); fileInput.value = ""; });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
}

// --- PASTE SUPPORT ---
document.addEventListener('paste', (event) => {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    const filesToProcess = [];
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.includes('image/')) {
            const blob = item.getAsFile();
            const pastedFile = new File([blob], `wklejony_paragon_${Date.now()}.png`, { type: blob.type });
            filesToProcess.push(pastedFile);
        }
    }
    if (filesToProcess.length > 0) {
        const dz = document.getElementById('drop-zone');
        if(dz) {
            dz.style.borderColor = 'var(--primary)';
            setTimeout(() => dz.style.borderColor = '', 200);
        }
        handleFiles(filesToProcess);
    }
});

function handleFiles(newFiles) {
    if (!newFiles || newFiles.length === 0) return;
    for (let file of newFiles) {
        filesToUpload.push(file);
        addPreview(file);
    }
    updateUploadButton();
}

function updateUploadButton() {
    const btn = document.getElementById('upload-btn');
    if (!btn) return;
    if (filesToUpload.length > 0) {
        btn.style.display = 'block';
        btn.innerHTML = `Analizuj (${filesToUpload.length})`;
    } else {
        btn.style.display = 'none';
    }
}

async function addPreview(file) {
    const container = document.getElementById('preview-container');
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-item';
    wrapper.dataset.filename = file.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'preview-remove';
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    removeBtn.onclick = (e) => { e.stopPropagation(); removeFile(file, wrapper); };
    const img = document.createElement('img');
    img.alt = "Ładowanie...";
    const reader = new FileReader();
    reader.onload = (e) => img.src = e.target.result;
    reader.readAsDataURL(file);
    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    container.appendChild(wrapper);
}

function removeFile(file, div) {
    filesToUpload = filesToUpload.filter(f => f !== file);
    div.remove();
    updateUploadButton();
}

async function uploadReceipts() {
    if (filesToUpload.length === 0) return;
    const loader = document.getElementById('loader');
    const statusMsg = document.getElementById('status-message');
    const uploadBtn = document.getElementById('upload-btn');
    loader.style.display = 'flex';
    statusMsg.innerText = "";
    uploadBtn.style.display = 'none';
    document.querySelectorAll('.preview-item').forEach(item => item.classList.add('processing'));
    const formData = new FormData();
    filesToUpload.forEach(file => formData.append("files", file));
    try {
        const response = await fetch('/api/scan-receipt', { method: 'POST', body: formData });
        const results = await response.json();
        loader.style.display = 'none';
        let savedCount = 0; let rejectedCount = 0;
        results.forEach(res => {
            if (res.status === 'saved') {
                savedCount++;
                removeFileByFilename(res.filename, true);
            } else {
                rejectedCount++;
                markFileAsError(res.filename, res.message || "Błąd");
            }
        });
        updateUploadButton();
        refreshStatusUI(savedCount);
        if (savedCount > 0) loadData();
    } catch (error) {
        loader.style.display = 'none';
        updateUploadButton();
        alert("Błąd krytyczny: " + error.message);
    } finally {
        document.querySelectorAll('.preview-item').forEach(item => item.classList.remove('processing'));
    }
}

function removeFileByFilename(filename, forceRemove) {
    const fileIndex = filesToUpload.findIndex(f => f.name === filename);
    if (fileIndex > -1) filesToUpload.splice(fileIndex, 1);
    const previewItems = document.querySelectorAll('.preview-item');
    previewItems.forEach(item => {
        if (item.dataset.filename === filename) {
            if (forceRemove) {
                item.style.transform = "scale(0)";
                setTimeout(() => { item.remove(); refreshStatusUI(); }, 300);
            }
        }
    });
    updateUploadButton();
}

// Zmieniamy definicję, aby przyjmowała parametr 'additionalSaved'
function refreshStatusUI(additionalSaved = 0) {
    const statusMsg = document.getElementById('status-message');
    const errorItems = document.querySelectorAll('.preview-item.error');

    // Zaczynamy od liczby, którą właśnie przekazaliśmy (np. z uploadu)
    let savedCount = additionalSaved;

    // Próbujemy odczytać, czy już wcześniej coś było zapisane (żeby nie tracić starego licznika przy odświeżaniu)
    if (statusMsg) {
        const match = statusMsg.innerText.match(/Zapisano:\s*(\d+)/);
        if (match && match[1]) {
            savedCount += parseInt(match[1]); // Dodajemy istniejącą liczbę do nowej
        }
    }

    const rejectedCount = errorItems.length;
    let summaryHtml = "";

    // Teraz savedCount będzie > 0 po udanym uploadzie
    if (savedCount > 0) summaryHtml += `<span style="color:var(--success)"><i class="fa-solid fa-check-circle"></i> Zapisano: ${savedCount}</span>`;

    if (rejectedCount > 0) {
        summaryHtml += ` <span style="color:var(--danger); margin-left:10px;"><i class="fa-solid fa-circle-exclamation"></i> Odrzucono: ${rejectedCount}</span>`;
        summaryHtml += `<br><small style="color:var(--text-muted)">Najedź na czerwone kafelki, aby ponowić.</small>`;
    }

    if (statusMsg) {
        statusMsg.innerHTML = summaryHtml;
        statusMsg.className = "status-summary";
    }
    updateUploadButton();
}

function markFileAsError(filename, reason) {
    const previewItems = document.querySelectorAll('.preview-item');
    previewItems.forEach(item => {
        if (item.dataset.filename === filename) {
            item.classList.add('error');
            item.title = "Kliknij, aby naprawić: " + reason;
            item.onclick = (e) => { e.stopPropagation(); openErrorResolver(filename); };
        }
    });
}

function openManualAddModal() {
    document.getElementById('modal-receipt-id').value = "NEW";
    document.getElementById('modal-store').value = "";
    const datePicker = document.querySelector("#modal-date")._flatpickr;
    if(datePicker) datePicker.setDate(new Date());
    document.getElementById('modal-category').value = "Inne";
    document.getElementById('modal-total').value = "0.00";
    document.getElementById('modal-items').innerHTML = "";
    addNewItemRow();
    document.getElementById('details-modal').style.display = 'flex';
}

function addNewItemRow(name = "", price = "") {
    const tbody = document.getElementById('modal-items');
    const tr = document.createElement('tr');

    tr.innerHTML = `
        <td><input type="text" class="modern-input" placeholder="Nazwa produktu" value="${name}"></td>
        <td>
            <input type="number" step="0.01" class="modern-input text-right" placeholder="0.00" value="${price}" 
            oninput="
                /* LOGIKA BLOKADY: */
                if(this.value.includes('.')) {
                    let parts = this.value.split('.');
                    if(parts[1].length > 2) {
                        /* Jeśli są więcej niż 2 cyfry po kropce, utnij nadmiar */
                        this.value = parts[0] + '.' + parts[1].slice(0, 2);
                    }
                }
                calculateItemsSum();
            ">
        </td>
        <td style="width: 40px; text-align: center;">
            <button class="btn-icon-mini delete-row-btn" onclick="this.closest('tr').remove(); calculateItemsSum()">
                <i class="fa-solid fa-minus"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

function calculateItemsSum() {
    let sum = 0;
    document.querySelectorAll('#modal-items tr').forEach(row => {
        const val = parseFloat(row.querySelectorAll('input')[1].value) || 0;
        sum += val;
    });
    return sum;
}

async function saveReceiptChanges() {
    const id = document.getElementById('modal-receipt-id').value;
    const totalInput = document.getElementById('modal-total');

    // 1. Czyścimy sumę całkowitą
    let totalVal = parseFloat(totalInput.value) || 0;
    totalVal = Math.round(totalVal * 100) / 100;
    totalInput.value = totalVal.toFixed(2);

    // 2. Budujemy obiekt danych
    const dataPayload = {
        store_name: document.getElementById('modal-store').value || "Sklep",
        date: document.getElementById('modal-date').value,
        category: document.getElementById('modal-category').value,
        total_amount: totalVal,
        items: []
    };

    // 3. PĘTLA GŁÓWNA: Pobieramy produkty i od razu je zaokrąglamy
    document.querySelectorAll('#modal-items tr').forEach(row => {
        const inputs = row.querySelectorAll('input');
        const name = inputs[0].value;

        if (name) {
            let rawPrice = parseFloat(inputs[1].value) || 0;
            // TU JEST KLUCZ: Zaokrąglamy przed dodaniem do listy
            let roundedPrice = Math.round(rawPrice * 100) / 100;

            dataPayload.items.push({
                name: name,
                price: roundedPrice
            });
        }
    });

    // 4. Definicja funkcji wysyłającej
    const sendData = async () => {
        let response;
        try {
            const options = {
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(dataPayload)
            };

            if (id === "NEW") {
                response = await fetch('/api/receipts/manual', { ...options, method: 'POST' });
            } else {
                response = await fetch(`/api/receipts/${id}`, { ...options, method: 'PUT' });
            }

            if (response.ok) {
                closeModal('mismatch-modal');
                closeModal('details-modal');
                loadData();
            } else {
                alert("Błąd zapisu danych.");
            }
        } catch (e) {
            console.error(e);
            alert("Błąd połączenia z serwerem.");
        }
    };

    // 5. Sprawdzenie sum (Mismatch Check)
    const calcSum = calculateItemsSum();
    if (Math.abs(calcSum - totalVal) > 0.01) {
        document.getElementById('mismatch-new-sum').innerText = calcSum.toFixed(2);

        document.getElementById('mismatch-fix-btn').onclick = () => {
            // Naprawiamy dane i wysyłamy
            const fixedSum = parseFloat(calcSum.toFixed(2));
            totalInput.value = fixedSum.toFixed(2);
            dataPayload.total_amount = fixedSum;
            sendData();
        };

        document.getElementById('mismatch-save-btn').onclick = sendData;
        document.getElementById('mismatch-modal').style.display = 'flex';
        return;
    }

    // Wyślij, jeśli wszystko gra
    sendData();
}

function openErrorResolver(filename) {
    currentErrorFilename = filename;
    const modal = document.getElementById('error-resolver-modal');
    const imgPreview = document.getElementById('error-preview-img');
    const retryBtn = document.getElementById('resolve-retry-btn');
    const file = filesToUpload.find(f => f.name === filename);
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => imgPreview.src = e.target.result;
        reader.readAsDataURL(file);
        if (file.retryCount && file.retryCount >= 1) {
            retryBtn.style.display = 'none';
        } else {
            retryBtn.style.display = 'block';
            retryBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Spróbuj ponownie <span style="font-size:0.8em; opacity:0.8; font-weight:400;">(to może chwilę potrwać)</span>';
        }
    }
    retryBtn.onclick = () => { closeModal('error-resolver-modal'); retrySingleFile(currentErrorFilename); };
    document.getElementById('resolve-manual-btn').onclick = () => { closeModal('error-resolver-modal'); removeFileByFilename(currentErrorFilename, true); setTimeout(() => openManualAddModal(), 100); };
    document.getElementById('resolve-delete-btn').onclick = () => { closeModal('error-resolver-modal'); removeFileByFilename(currentErrorFilename, true); };
    modal.style.display = 'flex';
}

async function retrySingleFile(filename) {
    const file = filesToUpload.find(f => f.name === filename);
    if (!file) { alert("Błąd: Nie znaleziono pliku."); return; }
    if (!file.retryCount) file.retryCount = 0;
    file.retryCount++;
    const loader = document.getElementById('loader');
    const previewItem = document.querySelector(`.preview-item[data-filename="${filename}"]`);
    if (previewItem) previewItem.classList.add('processing');
    loader.style.display = 'flex';
    closeModal('error-resolver-modal');
    const formData = new FormData();
    formData.append("files", file);
    try {
        const response = await fetch('/api/scan-receipt', { method: 'POST', body: formData });
        const results = await response.json();
        const res = results[0];
        if (res.status === 'saved') {
            removeFileByFilename(filename, true);
            loadData();
            updateUploadButton();
        } else {
            let errorMsg = res.message || "Ponowna próba nieudana";
            if (file.retryCount >= 1) errorMsg = "AI się poddało. Dodaj ręcznie.";
            markFileAsError(filename, errorMsg);
            setTimeout(() => openErrorResolver(filename), 500);
        }
    } catch (e) {
        console.error("Błąd:", e);
        alert("Błąd połączenia.");
    } finally {
        loader.style.display = 'none';
        if (previewItem) previewItem.classList.remove('processing');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.querySelector('.modal-content').style.transform = 'scale(0.9)';
        modal.querySelector('.modal-content').style.opacity = '0';
        setTimeout(() => {
            modal.style.display = 'none';
            modal.querySelector('.modal-content').style.transform = '';
            modal.querySelector('.modal-content').style.opacity = '';
        }, 200);
    }
}

window.onclick = function (event) {
    if (event.target.classList.contains('modal')) closeModal(event.target.id);
};

// --- CHAT LOGIC ---
function toggleChat() {
    const widget = document.getElementById('chat-widget');
    if(widget.style.display === 'flex') widget.style.display = 'none';
    else widget.style.display = 'flex';
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if(!msg) return;

    appendMessage(msg, 'user');
    input.value = '';

    // Dodaj do historii
    chatHistory.push({role: 'user', content: msg});

    const loadingId = 'loading-' + Date.now();
    appendMessage("Myślę...", 'ai', loadingId);

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: msg, history: chatHistory.slice(-10)}) // Ślij ostatnie 10 msg
        });
        const data = await response.json();

        const loadingEl = document.getElementById(loadingId);
        if(loadingEl) loadingEl.remove();

        const reply = data.reply;
        const htmlReply = marked.parse(reply);
        appendMessage(htmlReply, 'ai', null, true);

        // Zapisz odpowiedź w historii
        chatHistory.push({role: 'model', content: reply});

    } catch (e) {
        console.error(e);
        appendMessage("Błąd połączenia.", 'ai');
    }
}

function appendMessage(text, sender, id = null, isHtml = false) {
    const chatWindow = document.getElementById('chatWindow');
    const div = document.createElement('div');
    div.className = sender === 'user' ? 'message-user' : 'message-ai';
    if(id) div.id = id;

    if(isHtml) div.innerHTML = text;
    else div.innerText = text;

    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
}