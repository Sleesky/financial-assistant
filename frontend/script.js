let myChart = null;
let fileStore = []; // Tu trzymamy wszystkie dodane pliki

// --- 1. WYKRES (Bez zmian, poza odświeżaniem) ---
async function loadChart() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        if (data.error) return;

        const ctxElement = document.getElementById('expensesChart');
        if (!ctxElement) return;
        const ctx = ctxElement.getContext('2d');

        if (myChart) myChart.destroy();

        myChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.labels,
                datasets: [{
                    label: 'Wydatki (PLN)',
                    data: data.values,
                    backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'],
                    hoverOffset: 4
                }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
        });
    } catch (error) { console.error(error); }
}

// --- 2. ZARZĄDZANIE PLIKAMI (Nowość) ---

function handleFiles(newFiles) {
    // Dodajemy nowe pliki do naszej tablicy
    fileStore = [...fileStore, ...Array.from(newFiles)];
    renderFileList();
}

function removeFile(index) {
    // Usuwamy plik z tablicy
    fileStore.splice(index, 1);
    renderFileList();
}

function renderFileList() {
    const listContainer = document.getElementById('file-list');
    const countSpan = document.getElementById('queue-count');
    listContainer.innerHTML = '';

    countSpan.innerText = fileStore.length;

    fileStore.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'file-item';

        // Tworzymy miniaturkę
        const img = document.createElement('img');
        const reader = new FileReader();
        reader.onload = e => img.src = e.target.result;
        reader.readAsDataURL(file);

        // Przycisk usuwania
        const btn = document.createElement('button');
        btn.className = 'remove-btn';
        btn.innerText = '✕';
        btn.onclick = () => removeFile(index);

        // Nazwa
        const name = document.createElement('div');
        name.className = 'file-name';
        name.innerText = file.name;

        div.appendChild(img);
        div.appendChild(btn);
        div.appendChild(name);
        listContainer.appendChild(div);
    });

    // Zmieniamy wygląd obszaru uploadu
    const uploadArea = document.getElementById('upload-area');
    if (fileStore.length > 0) {
        uploadArea.style.borderColor = '#27ae60';
        uploadArea.style.backgroundColor = '#e8f8f5';
    } else {
        uploadArea.style.borderColor = '#3498db';
        uploadArea.style.backgroundColor = '#f0f8ff';
    }
}

// --- 3. PROCESOWANIE KOLEJKI (Wysyłanie paragonów) ---

async function processQueue() {
    if (fileStore.length === 0) {
        alert("Dodaj najpierw paragony!");
        return;
    }

    const loader = document.getElementById('loader');
    const progressSpan = document.getElementById('current-progress');
    const resultsContainer = document.getElementById('results-container');

    loader.style.display = 'block';
    resultsContainer.innerHTML = ''; // Czyścimy stare wyniki (opcjonalne)

    let processedCount = 0;
    const total = fileStore.length;

    // Wysyłamy paragony jeden po drugim (pętla)
    for (const file of fileStore) {
        processedCount++;
        progressSpan.innerText = `${processedCount}/${total}`;

        await uploadSingleReceipt(file, resultsContainer);
    }

    loader.style.display = 'none';
    fileStore = []; // Czyścimy kolejkę po wysłaniu
    renderFileList();
    loadChart(); // Odświeżamy wykres na koniec
}

async function uploadSingleReceipt(file, container) {
    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch('/api/scan-receipt', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        // Tworzymy kartę paragonu dynamicznie (HTML w JS)
        const card = document.createElement('div');
        card.className = 'receipt-card';
        card.style.display = 'block'; // Od razu widoczny

        // Budowanie HTML karty
        if (data.error) {
            card.innerHTML = `<div style="color:red; padding:10px;">Błąd pliku ${file.name}: ${data.error}</div>`;
        } else {
            const itemsRows = (data.items || []).map(item => `
                <tr>
                    <td style="padding: 5px; border-bottom: 1px solid #eee;">${item.name}</td>
                    <td style="text-align: right; border-bottom: 1px solid #eee;">${item.price.toFixed(2)} zł</td>
                </tr>
            `).join('');

            card.innerHTML = `
                <div class="receipt-header">
                    <h3>${data.store_name || "Nieznany"}</h3>
                    <div class="receipt-info">Data: ${data.date || "--"} | Kat: ${data.category}</div>
                </div>
                <table class="receipt-table">
                    <thead><tr><th>Produkt</th><th style="text-align: right;">Cena</th></tr></thead>
                    <tbody>${itemsRows}</tbody>
                </table>
                <div class="receipt-total">SUMA: <span class="total-price">${data.total_amount?.toFixed(2)}</span> PLN</div>
                <div class="receipt-footer">
                    ${data.status === 'saved' ? '<span style="color:green">✅ Zapisano (ID: '+data.db_id+')</span>' : '<span style="color:orange">⚠️ Błąd bazy</span>'}
                </div>
            `;
        }

        // Dodajemy nowy paragon na górę listy wyników
        container.prepend(card);

    } catch (e) {
        container.innerHTML += `<div style="color:red">Błąd połączenia dla pliku ${file.name}</div>`;
    }
}

// --- 4. EVENT LISTENERS ---

window.addEventListener('paste', e => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    const files = [];
    for (let item of items) {
        if (item.kind === 'file' && item.type.includes('image')) {
            files.push(item.getAsFile());
        }
    }
    if (files.length > 0) handleFiles(files);
});

document.getElementById('receiptInput').addEventListener('change', function() {
    if (this.files.length > 0) handleFiles(this.files);
    // Resetujemy input, żeby można było dodać ten sam plik ponownie jeśli usuniemy
    this.value = '';
});

// Chat
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const chatWindow = document.getElementById('chatWindow');
    if (!input.value) return;

    chatWindow.innerHTML += `<p><strong>Ty:</strong> ${input.value}</p>`;
    const msg = input.value;
    input.value = '';

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: msg})
        });
        const data = await res.json();
        chatWindow.innerHTML += `<p><strong>AI:</strong> ${data.reply}</p>`;
        chatWindow.scrollTop = chatWindow.scrollHeight;
    } catch(e) { chatWindow.innerHTML += '<p style="color:red">Błąd chatu</p>'; }
}

document.getElementById('chatInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') sendMessage();
});

document.addEventListener("DOMContentLoaded", loadChart);

// --- OBSŁUGA DRAG & DROP ---

const dropArea = document.getElementById('upload-area');

// 1. Zapobiegamy domyślnemu zachowaniu przeglądarki (otwieraniu pliku w nowej karcie)
;['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// 2. Podświetlanie obszaru, gdy plik jest nad nim
;['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
});

// 3. Usuwanie podświetlenia, gdy kursor wyjdzie lub upuścimy plik
;['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
});

// 4. Obsługa upuszczenia (DROP)
dropArea.addEventListener('drop', handleDrop, false);

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    // Przekazujemy pliki do istniejącej funkcji handleFiles (tej samej, co przy Ctrl+V)
    handleFiles(files);
}