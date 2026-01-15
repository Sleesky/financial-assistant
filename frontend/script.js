let myChart = null;
let globalReceipts = [];
let filesToUpload = [];

// --- SPA ROUTER ---
function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${viewName}`).classList.add('active');

    const navLink = document.getElementById(`nav-${viewName}`);
    if (navLink) navLink.classList.add('active');

    if (viewName === 'history') {
        renderFullHistoryPage();
    }
}

// --- DANE I INIT ---
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

document.addEventListener("DOMContentLoaded", () => {
    loadData();
    switchView('dashboard');
    if (localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');
});

// --- DASHBOARD LOGIC ---
function renderRecentTransactions(receipts) {
    const list = document.getElementById('recent-list');
    list.innerHTML = '';

    if (receipts.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding:20px; color:var(--text-muted)">Brak danych.</p>';
        return;
    }

    // Ostatnie 6 transakcji
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
                <div class="history-icon-wrapper ${bg}"><i class="fa-light ${icon}"></i></div>
                <div class="history-info">
                    <strong>${r.store_name}</strong>
                    <span class="history-sub">${r.date}</span>
                </div>
            </div>
            <div class="item-right">
                <span class="history-amount">${r.total_amount.toFixed(2)} zł</span>
            </div>
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
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: textColor, font: {family: "'Inter', sans-serif"}, usePointStyle: true, padding: 15 } }
            },
            cutout: '75%',
            layout: { padding: 10 }
        }
    });
}

// --- HISTORY TIMELINE ---
function renderFullHistoryPage() {
    const container = document.getElementById('full-history-list');
    container.innerHTML = '';

    const search = document.getElementById('search-input').value.toLowerCase();
    const dFrom = document.getElementById('date-from').value;
    const dTo = document.getElementById('date-to').value;

    let filtered = globalReceipts.filter(r => {
        const textMatch = (r.store_name||"").toLowerCase().includes(search) || (r.category||"").toLowerCase().includes(search);
        let dateMatch = true;
        if(dFrom && r.date < dFrom) dateMatch = false;
        if(dTo && r.date > dTo) dateMatch = false;
        return textMatch && dateMatch;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div style="text-align:center; margin-top:50px; color:var(--text-muted);">Brak wyników</div>';
        return;
    }

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date));

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
        const dateStr = isNaN(dateObj) ? date : dateObj.toLocaleDateString('pl-PL', { month: 'long', day: 'numeric' });
        const yearStr = isNaN(dateObj) ? "" : dateObj.getFullYear();

        groupDiv.innerHTML = `<div class="timeline-header">${dateStr} <small>${yearStr}</small></div><div class="timeline-list"></div>`;
        const listDiv = groupDiv.querySelector('.timeline-list');

        items.forEach(r => {
            const el = document.createElement('div');
            el.className = 'timeline-item';
            el.onclick = () => openModal(r.id);

            let icon='fa-receipt'; let bg='bg-blue';
            const cat=(r.category||"").toLowerCase();
            if(cat.includes('spoż')) { icon='fa-carrot'; bg='bg-green'; }
            else if(cat.includes('paliwo')) { icon='fa-gas-pump'; bg='bg-orange'; }
            else if(cat.includes('elektr')) { icon='fa-plug'; bg='bg-purple'; }

            el.innerHTML = `
                <div class="t-left">
                    <div class="t-icon ${bg}"><i class="fa-light ${icon}"></i></div>
                    <div class="t-info"><strong>${r.store_name}</strong><span>${r.category}</span></div>
                </div>
                <div class="t-right">
                    <div class="t-price">${r.total_amount.toFixed(2)} zł</div>
                    <div class="t-actions">
                        <i class="fa-light fa-trash-can" style="color:var(--danger)" onclick="askDeleteReceipt(event, ${r.id})"></i>
                    </div>
                </div>
            `;
            listDiv.appendChild(el);
        });
        container.appendChild(groupDiv);
    }
}

// --- UPLOAD (NAPRAWIONE) ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('receiptInput');

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); fileInput.value = ""; });
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });

// --- TUTAJ BYŁ BŁĄD (NAPRAWIONO): ---
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

function handleFiles(newFiles) {
    if (!newFiles || newFiles.length === 0) return;
    for (let file of newFiles) { filesToUpload.push(file); addPreview(file); }
    updateUploadButton();
}

function updateUploadButton() {
    const btn = document.getElementById('upload-btn');
    if (filesToUpload.length > 0) {
        btn.style.display = 'block';
        btn.innerHTML = `Analizuj (${filesToUpload.length})`;
    } else {
        btn.style.display = 'none';
    }
}

async function addPreview(file) {
    const container = document.getElementById('preview-container');
    const wrapper = document.createElement('div'); wrapper.className = 'preview-item';

    const removeBtn = document.createElement('button'); removeBtn.className = 'preview-remove';
    removeBtn.innerHTML = '<i class="fa-light fa-xmark"></i>';
    removeBtn.onclick = (e) => { e.stopPropagation(); removeFile(file, wrapper); };

    const img = document.createElement('img'); img.alt = "Ładowanie...";
    const reader = new FileReader(); reader.onload = (e) => img.src = e.target.result; reader.readAsDataURL(file);

    wrapper.appendChild(img); wrapper.appendChild(removeBtn); container.appendChild(wrapper);
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
    loader.style.display = 'flex'; statusMsg.innerText = "";
    document.getElementById('upload-btn').style.display = 'none';

    const formData = new FormData();
    filesToUpload.forEach(file => formData.append("files", file));

    try {
        const response = await fetch('/api/scan-receipt', { method: 'POST', body: formData });
        const results = await response.json();

        loader.style.display = 'none';
        filesToUpload = [];
        document.getElementById('preview-container').innerHTML = '';
        updateUploadButton();

        const savedCount = results.filter(r => r.status === 'saved').length;
        statusMsg.innerHTML = `<span style="color:var(--success)"><i class="fa-light fa-check-circle"></i> Zapisano: ${savedCount}</span>`;

        loadData();
    } catch (error) {
        loader.style.display = 'none';
        updateUploadButton();
        alert("Błąd: " + error.message);
    }
}

// --- MODALS ---
let receiptToDeleteId = null;
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
window.onclick = (e) => { if(e.target.classList.contains('modal')) e.target.style.display = 'none'; };

function askDeleteReceipt(event, id) {
    event.stopPropagation();
    receiptToDeleteId = id;
    document.getElementById('confirmation-modal').style.display = 'flex';
}

document.getElementById('confirm-yes-btn').onclick = async () => {
    if (!receiptToDeleteId) return;
    await fetch(`/api/receipts/${receiptToDeleteId}`, { method: 'DELETE' });
    closeModal('confirmation-modal');
    loadData();
};

function openModal(receiptId) {
    const receipt = globalReceipts.find(r => r.id === receiptId);
    if (!receipt) return;

    document.getElementById('modal-receipt-id').value = receipt.id;
    document.getElementById('modal-store').value = receipt.store_name;
    document.getElementById('modal-date').value = receipt.date;
    document.getElementById('modal-category').value = receipt.category;
    document.getElementById('modal-total').value = receipt.total_amount.toFixed(2);

    const tbody = document.getElementById('modal-items'); tbody.innerHTML = '';
    (receipt.items || []).forEach(i => addItemRow(i.name, i.price));

    document.getElementById('details-modal').style.display = 'flex';
}

function addItemRow(name="", price=0) {
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" class="modern-input pill w-full" value="${name}"></td>
        <td class="text-right"><input type="number" step="0.01" class="modern-input pill text-right" style="width:90px" value="${price.toFixed(2)}" onchange="this.value=parseFloat(this.value||0).toFixed(2)"></td>
        <td><button onclick="this.closest('tr').remove()" class="btn-icon-mini delete-row-btn"><i class="fa-light fa-xmark"></i></button></td>
    `;
    document.getElementById('modal-items').appendChild(row);
}
function addNewItemRow() { addItemRow("", 0.00); }

function calculateItemsSum() {
    let sum = 0;
    document.querySelectorAll('#modal-items tr').forEach(row => {
        sum += parseFloat(row.querySelectorAll('input')[1].value) || 0;
    });
    return sum;
}

function autoFixSum() {
    document.getElementById('modal-total').value = calculateItemsSum().toFixed(2);
}

async function saveReceiptChanges() {
    const id = document.getElementById('modal-receipt-id').value;
    const totalInput = document.getElementById('modal-total');
    let totalVal = parseFloat(totalInput.value) || 0;
    totalInput.value = totalVal.toFixed(2);

    const calcSum = calculateItemsSum();
    const dataPayload = {
        store_name: document.getElementById('modal-store').value,
        date: document.getElementById('modal-date').value,
        category: document.getElementById('modal-category').value,
        total_amount: totalVal,
        items: []
    };

    document.querySelectorAll('#modal-items tr').forEach(row => {
        const inputs = row.querySelectorAll('input');
        if(inputs[0].value) dataPayload.items.push({ name: inputs[0].value, price: parseFloat(inputs[1].value)||0 });
    });

    const sendData = async () => {
        await fetch(`/api/receipts/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(dataPayload) });
        closeModal('mismatch-modal');
        closeModal('details-modal');
        loadData();
    };

    if (Math.abs(calcSum - totalVal) > 0.01) {
        document.getElementById('mismatch-new-sum').innerText = calcSum.toFixed(2);
        document.getElementById('mismatch-fix-btn').onclick = () => {
            totalInput.value = calcSum.toFixed(2);
            dataPayload.total_amount = calcSum;
            sendData();
        };
        document.getElementById('mismatch-save-btn').onclick = sendData;
        document.getElementById('mismatch-modal').style.display = 'flex';
        return;
    }
    sendData();
}

// --- UTILS ---

function toggleTheme() {
    const body = document.body;
    if (body.getAttribute('data-theme') === 'dark') {
        body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
    loadDashboard(globalReceipts);
}

function exportToCSV() {
    if (!globalReceipts.length) { alert("Brak danych!"); return; }
    let csvContent = "data:text/csv;charset=utf-8,ID;Data;Sklep;Kategoria;Kwota\n";
    globalReceipts.forEach(r => {
        const row = `${r.id};${r.date};${(r.store_name||"").replace(/;/g,",")};${r.category};${r.total_amount.toFixed(2).replace('.',',')}`;
        csvContent += row + "\n";
    });
    const link = document.createElement("a");
    link.href = encodeURI(csvContent);
    link.download = "wydatki_apple.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- CHAT ---
function toggleChat() {
    const w = document.getElementById('chat-widget');
    w.style.display = (w.style.display === 'flex') ? 'none' : 'flex';
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const btn = document.querySelector('.send-btn'); // Pobieramy przycisk
    const msg = input.value.trim();

    if(!msg) return;

    // 1. ZABLOKUJ UI (żeby nie klikać milion razy)
    input.disabled = true;
    btn.disabled = true;
    btn.style.opacity = "0.5"; // Wizualnie pokaż, że nieaktywne
    btn.style.cursor = "not-allowed";

    const win = document.getElementById('chatWindow');
    win.innerHTML += `<div class="message-user">${msg}</div>`;
    input.value = '';

    // Dodajmy dymek "Pisanie..."
    const loadingId = "loading-" + Date.now();
    win.innerHTML += `<div id="${loadingId}" class="message-ai" style="opacity:0.7">...</div>`;
    win.scrollTop = win.scrollHeight;

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({message: msg})
        });

        const data = await res.json();

        // Usuń dymek "..."
        document.getElementById(loadingId).remove();

        // Wstaw odpowiedź
        win.innerHTML += `<div class="message-ai">${marked.parse(data.reply)}</div>`;
        win.scrollTop = win.scrollHeight;

    } catch (e) {
        document.getElementById(loadingId).remove();
        win.innerHTML += `<div class="message-ai" style="color:var(--danger)">Błąd: Serwer zajęty. Odczekaj chwilę.</div>`;
    } finally {
        // 2. ODBLOKUJ UI (Niezależnie czy sukces, czy błąd)
        input.disabled = false;
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        input.focus(); // Przywróć kursor do pisania
    }
}