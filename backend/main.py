import os
import json
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import google.generativeai as genai
from dotenv import load_dotenv

# Ładowanie zmiennych środowiskowych
load_dotenv()

app = FastAPI()

# Konfiguracja Google Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("UWAGA: Brak klucza GEMINI_API_KEY w pliku .env")


# 1. Endpoint do serwowania strony głównej (Frontend)
@app.get("/")
async def read_index():
    return FileResponse('static/index.html')


# 2. Moduł Skanowania (Core Feature - Upload paragonu) [cite: 10, 11]
@app.post("/api/scan-receipt")
async def scan_receipt(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="Brak konfiguracji API Gemini")

    try:
        # Odczyt pliku
        content = await file.read()

        # Przygotowanie modelu (np. gemini-1.5-flash jest szybki i tani)
        model = genai.GenerativeModel('gemini-1.5-flash')

        # Prompt zgodny z dokumentacją [cite: 41]
        prompt = """
        Przeanalizuj to zdjęcie paragonu i zwróć tylko czysty JSON (bez markdown) z następującymi polami:
        - store_name (string)
        - date (string YYYY-MM-DD)
        - items (lista obiektów: {name: string, price: float})
        - total_amount (float)
        - category (string, np. 'Spożywcze', 'Paliwo', 'Inne')
        """

        # Wywołanie AI
        response = model.generate_content([
            {'mime_type': file.content_type, 'data': content},
            prompt
        ])

        # Proste czyszczenie odpowiedzi (czasem AI dodaje ```json ... ```)
        json_str = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(json_str)

        return data

    except Exception as e:
        return {"error": str(e)}


# 3. Asystent Finansowy (Chatbot) [cite: 22]
@app.post("/api/chat")
async def chat_with_assistant(query: dict):
    # Tutaj w przyszłości dodasz kontekst z bazy danych (RAG) [cite: 52]
    user_message = query.get("message")

    # Na razie prosty echo-bot z Gemini
    model = genai.GenerativeModel('gemini-1.5-flash')
    response = model.generate_content(f"Jesteś asystentem finansowym. Użytkownik pyta: {user_message}")

    return {"reply": response.text}


# Serwowanie plików statycznych (CSS, JS) - musi być na końcu
app.mount("/static", StaticFiles(directory="static"), name="static")