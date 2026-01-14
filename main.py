import os
import json
from datetime import datetime
from typing import List

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from dotenv import load_dotenv
import google.generativeai as genai

import models
from database import engine, get_db

# Ładowanie zmiennych środowiskowych
load_dotenv()

# Konfiguracja Gemini (dodana sekcja)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    print("UWAGA: Brak klucza GOOGLE_API_KEY w pliku .env")
else:
    genai.configure(api_key=GOOGLE_API_KEY)

# Używamy modelu Flash - jest szybki i darmowy w ramach limitów
model = genai.GenerativeModel('gemini-1.5-flash')

# To stworzy plik finance.db i tabele przy starcie aplikacji
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Inteligentny Asystent Finansowy")

# Pozwól Reactowi (frontendowi) łączyć się z backendem
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {"status": "Backend działa. Czekam na dane!"}


# Miejsce dla osoby od SKANOWANIA (Moduł B)
@app.post("/upload-receipt")
async def scan_receipt(file: UploadFile = File(...), db: Session = Depends(get_db)):
    # Cel: Wysyłka do AI i zwrot JSON
    try:
        # 1. Odczyt pliku
        content = await file.read()

        # 2. Przygotowanie promptu dla Gemini
        prompt = """
        Przeanalizuj to zdjęcie paragonu. Wyciągnij z niego następujące informacje i zwróć TYLKO obiekt JSON (bez formatowania markdown):
        {
            "shop_name": "nazwa sklepu",
            "total_amount": 0.0,
            "category": "kategoria wydatku (np. spożywcze, paliwo, restauracja)",
            "date_of_purchase": "RRRR-MM-DD"
        }
        Jeśli daty nie ma, użyj dzisiejszej. Jeśli kwota jest niejasna, wpisz 0.
        """

        # 3. Wysłanie do AI
        response = model.generate_content([
            prompt,
            {"mime_type": file.content_type, "data": content}
        ])

        # 4. Czyszczenie odpowiedzi (AI czasem dodaje znaczniki kodu)
        text_response = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(text_response)

        # 5. Zapis do bazy danych
        try:
            parsed_date = datetime.strptime(data.get("date_of_purchase", ""), "%Y-%m-%d")
        except ValueError:
            parsed_date = datetime.utcnow()

        new_receipt = models.Receipt(
            shop_name=data.get("shop_name", "Nieznany"),
            total_amount=float(data.get("total_amount", 0.0)),
            category=data.get("category", "Inne"),
            date_of_purchase=parsed_date,
            raw_json=text_response
        )

        db.add(new_receipt)
        db.commit()
        db.refresh(new_receipt)

        return {"message": "Plik odebrany i przetworzony", "data": data, "id": new_receipt.id}

    except Exception as e:
        return {"message": f"Błąd przetwarzania: {str(e)}"}


# Miejsce dla osoby od CZATU (Moduł D)
@app.post("/chat")
async def chat_with_ai(query: str, db: Session = Depends(get_db)):
    # Cel: Odpowiedzi na pytania o wydatki

    # 1. Pobierz kontekst z bazy danych (ostatnie transakcje)
    receipts = db.query(models.Receipt).order_by(models.Receipt.date_of_purchase.desc()).limit(50).all()

    context_text = "Historia wydatków użytkownika:\n"
    for r in receipts:
        context_text += f"- {r.date_of_purchase.strftime('%Y-%m-%d')}: {r.shop_name} - {r.total_amount} PLN ({r.category})\n"

    # 2. Zapytaj Gemini
    prompt = f"""
    Jesteś asystentem finansowym. Oto dane o wydatkach użytkownika:
    {context_text}

    Pytanie użytkownika: {query}

    Odpowiedz krótko i konkretnie na podstawie powyższych danych.
    """

    response = model.generate_content(prompt)

    return {"answer": response.text}