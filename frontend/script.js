async function uploadReceipt() {
    const input = document.getElementById('receiptInput');
    const resultDiv = document.getElementById('scanResult');

    if (input.files.length === 0) {
        alert("Wybierz plik!");
        return;
    }

    const formData = new FormData();
    formData.append("file", input.files[0]);

    resultDiv.innerHTML = "Analizowanie paragonu przez Gemini AI...";

    try {
        const response = await fetch('/api/scan-receipt', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        // Wyświetlenie wyniku (surowy JSON na razie)
        resultDiv.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } catch (error) {
        resultDiv.innerHTML = "Błąd: " + error.message;
    }
}

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