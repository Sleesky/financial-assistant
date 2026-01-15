async function uploadReceipt() {
    const input = document.getElementById('receiptInput');
    const loader = document.getElementById('loader');
    const card = document.getElementById('receipt-card');

    // Elementy do wypełnienia
    const uiStore = document.getElementById('ui-store');
    const uiDate = document.getElementById('ui-date');
    const uiCategory = document.getElementById('ui-category');
    const uiTotal = document.getElementById('ui-total');
    const uiItems = document.getElementById('ui-items');
    const uiStatus = document.getElementById('ui-status');
    const uiDbId = document.getElementById('ui-db-id');

    if (input.files.length === 0) {
        alert("Wybierz plik!");
        return;
    }

    const formData = new FormData();
    formData.append("file", input.files[0]);

    // Pokaż loader, ukryj stary wynik
    loader.style.display = 'block';
    card.style.display = 'none';

    try {
        const response = await fetch('/api/scan-receipt', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        loader.style.display = 'none'; // Ukryj loader

        if (data.error) {
            alert("Błąd serwera: " + data.error);
            return;
        }

        // --- WYPEŁNIANIE DANYCH ---

        // 1. Nagłówek
        uiStore.innerText = data.store_name || "Nieznany sklep";
        uiDate.innerText = data.date || "Brak daty";
        uiCategory.innerText = data.category || "Inne";
        uiTotal.innerText = data.total_amount ? data.total_amount.toFixed(2) : "0.00";

        // 2. Status Bazy Danych
        if (data.status === "saved") {
            uiStatus.innerText = "✅ Zapisano w bazie";
            uiStatus.style.color = "green";
            uiDbId.innerText = data.db_id;
        } else {
            uiStatus.innerText = "⚠️ Tylko AI (błąd bazy)";
            uiStatus.style.color = "orange";
        }

        // 3. Tabela produktów (Pętla)
        uiItems.innerHTML = ''; // Czyścimy stare produkty

        if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 5px; border-bottom: 1px solid #eee;">${item.name}</td>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; text-align: right;">${item.price.toFixed(2)} zł</td>
                `;
                uiItems.appendChild(row);
            });
        } else {
            uiItems.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:10px;">Brak produktów na liście</td></tr>';
        }

        // Pokaż gotową kartę
        card.style.display = 'block';

    } catch (error) {
        loader.style.display = 'none';
        alert("Błąd połączenia: " + error.message);
    }
}


// --- MODUŁ HISTORII ---
async function loadHistory() {
    const listContainer = document.getElementById('history-list');
    listContainer.innerHTML = '<p style="text-align:center; color:gray;">Ładowanie historii...</p>';

    try {
        const response = await fetch('/api/receipts');
        const receipts = await response.json();

        listContainer.innerHTML = ''; // Wyczyść loader

        if (receipts.length === 0) {
            listContainer.innerHTML = '<p style="text-align:center; color:#999;">Brak zapisanych paragonów.</p>';
            return;
        }

        // Sortujemy: najnowsze na górze (jeśli ID rośnie z czasem)
        receipts.reverse().forEach(r => {
            const item = document.createElement('div');
            item.className = 'history-item';

            // Formatujemy datę i kwotę
            const price = r.total_amount ? r.total_amount.toFixed(2) : "0.00";

            item.innerHTML = `
                <div class="history-info">
                    <strong>${r.store_name}</strong> <span style="color:#27ae60; font-weight:bold;">${price} zł</span><br>
                    <span class="history-date">${r.date || "Brak daty"} | ${r.category}</span>
                    <div style="font-size: 0.8em; color: #aaa; margin-top: 4px;">
                        ${r.items.length} produktów (ID: ${r.id})
                    </div>
                </div>
                <button class="btn-delete" onclick="deleteReceipt(${r.id})">🗑 Usuń</button>
            `;
            listContainer.appendChild(item);
        });

        // Przy okazji odświeżmy też wykres, żeby dane były spójne
        if (typeof loadDashboard === "function") {
            loadDashboard();
        }

    } catch (error) {
        console.error("Błąd historii:", error);
        listContainer.innerHTML = '<p style="color:red; text-align:center;">Błąd pobierania historii</p>';
    }
}

async function deleteReceipt(id) {
    if (!confirm("Czy na pewno chcesz usunąć ten paragon? Tej operacji nie da się cofnąć.")) {
        return;
    }

    try {
        const response = await fetch(`/api/receipts/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // Odśwież listę po udanym usunięciu
            loadHistory();
        } else {
            alert("Błąd usuwania paragonu.");
        }
    } catch (error) {
        alert("Błąd połączenia: " + error.message);
    }
}

// Dodajemy ładowanie historii do startu strony (razem z wykresem)
document.addEventListener("DOMContentLoaded", () => {
    loadHistory();
    // loadDashboard jest już wywoływany wewnątrz loadHistory (linia 40),
    // albo można zostawić oddzielnie - bez znaczenia.
});

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const chatWindow = document.getElementById('chatWindow');
    const message = input.value;

    chatWindow.innerHTML += `<p><strong>Ty:</strong> ${message}</p>`;
    input.value = '';

    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
    });

    const data = await response.json();
    chatWindow.innerHTML += `<p><strong>AI:</strong> ${data.reply}</p>`;
}

document.getElementById('chatInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});