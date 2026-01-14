import os
import json
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Ładowanie zmiennych środowiskowych
load_dotenv()

app = FastAPI()

# Konfiguracja klienta Google Gemini (Nowa biblioteka)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = None

if GEMINI_API_KEY:
    # Inicjalizacja klienta
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    print("UWAGA: Brak klucza GEMINI_API_KEY w pliku .env")


# --- DIAGNOSTYKA PRZY STARCIE ---
@app.on_event("startup")
async def startup_check():
    if not client:
        print("--- DIAGNOSTYKA: BRAK KLIENTA (Sprawdź klucz API) ---")
        return
    # Tylko logujemy informację, że startuje
    print("--- Aplikacja startuje. Klient Gemini skonfigurowany. ---")


# 1. Endpoint do serwowania strony głównej (Frontend)
@app.get("/")
async def read_index():
    return FileResponse('static/index.html')


# 2. Moduł Skanowania
@app.post("/api/scan-receipt")
async def scan_receipt(file: UploadFile = File(...)):
    if not client:
        raise HTTPException(status_code=500, detail="Brak konfiguracji API Gemini")

    try:
        # Odczyt pliku do pamięci
        file_content = await file.read()

        # Prompt
        prompt_text = """
        Przeanalizuj to zdjęcie paragonu i zwróć tylko czysty JSON (bez markdown) z następującymi polami:
        - store_name (string)
        - date (string YYYY-MM-DD)
        - items (lista obiektów: {name: string, price: float})
        - total_amount (float)
        - category (string, np. 'Spożywcze', 'Paliwo', 'Inne')
        """

        # ZMIANA: Używamy modelu dostępnego na Twojej liście
        model_name = "gemini-flash-latest"

        print(f"Analiza przy użyciu modelu: {model_name}")

        response = client.models.generate_content(
            model=model_name,
            contents=[
                types.Content(
                    parts=[
                        types.Part.from_bytes(
                            data=file_content,
                            mime_type=file.content_type
                        ),
                        types.Part.from_text(text=prompt_text),
                    ]
                )
            ]
        )

        if not response.text:
            raise ValueError("API zwróciło pustą odpowiedź.")

        # Czyszczenie odpowiedzi
        json_str = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(json_str)

        return data

    except Exception as e:
        print(f"Błąd API: {e}")
        return {"error": str(e)}


# 3. Asystent Finansowy (Chatbot)
@app.post("/api/chat")
async def chat_with_assistant(query: dict):
    if not client:
        return {"reply": "Błąd konfiguracji API"}

    user_message = query.get("message")

    try:
        # ZMIANA: Tutaj również używamy modelu z Twojej listy
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=f"Jesteś asystentem finansowym. Użytkownik pyta: {user_message}"
        )
        return {"reply": response.text}
    except Exception as e:
        return {"reply": f"Błąd chatu: {str(e)}"}


# Serwowanie plików statycznych
app.mount("/static", StaticFiles(directory="static"), name="static")