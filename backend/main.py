from sqlalchemy import func
import os
import json
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google import genai
from google.genai import types
from dotenv import load_dotenv

# --- IMPORTS BAZY DANYCH ---
from sqlalchemy.orm import Session
import models
from database import SessionLocal, engine

# Ładowanie zmiennych środowiskowych
load_dotenv()

# --- INICJALIZACJA BAZY ---
# To stworzy plik finance.db i tabele, jeśli ich nie ma
models.Base.metadata.create_all(bind=engine)
app = FastAPI()

# Funkcja pomocnicza do pobierania sesji bazy (Dependency)
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

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
async def scan_receipt(file: UploadFile = File(...), db: Session = Depends(get_db)):
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

        # --- ZAPIS DO BAZY DANYCH ---
        try:
            # 1. Tworzymy paragon
            db_receipt = models.Receipt(
                store_name=data.get("store_name", "Nieznany"),
                date=data.get("date"),
                total_amount=data.get("total_amount", 0.0),
                category=data.get("category", "Inne")
            )
            db.add(db_receipt)
            db.commit()  # Zatwierdzamy, żeby dostać ID
            db.refresh(db_receipt)

            # 2. Tworzymy produkty
            for item in data.get("items", []):
                db_item = models.Item(
                    name=item.get("name", "Produkt"),
                    price=item.get("price", 0.0),
                    receipt_id=db_receipt.id
                )
                db.add(db_item)

            db.commit()  # Zapisujemy produkty

            # Dodajemy ID do zwracanego JSONa, żeby frontend wiedział, że zapisano
            data["db_id"] = db_receipt.id
            data["status"] = "saved"
            print(f"✅ Zapisano paragon w bazie ID: {db_receipt.id}")

        except Exception as db_err:
            print(f"⚠️ Błąd zapisu do bazy: {db_err}")
            data["status"] = "ai_only_db_error"

        return data

    except Exception as e:
        print(f"Błąd API: {e}")
        return {"error": str(e)}

@app.get("/api/receipts")
def get_receipts(db: Session = Depends(get_db)):
    # 1. Pobieramy obiekty z bazy
    receipts = db.query(models.Receipt).all()

    # 2. Ręcznie przerabiamy na JSON (żeby uniknąć pętli i błędów 500)
    results = []
    for r in receipts:
        results.append({
            "id": r.id,
            "store_name": r.store_name,
            "date": r.date,
            "total_amount": r.total_amount,
            "category": r.category,
            "items": [{"name": i.name, "price": i.price} for i in r.items]
        })

    return results

# Endpoint do usuwania paragonu
@app.delete("/api/receipts/{receipt_id}")
def delete_receipt(receipt_id: int, db: Session = Depends(get_db)):
    # Szukamy paragonu po ID
    receipt = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()

    if not receipt:
        raise HTTPException(status_code=404, detail="Paragon nie istnieje")

    # Usuwamy
    db.delete(receipt)
    db.commit()

    return {"message": "Paragon usunięty pomyślnie"}

# --- NOWY ENDPOINT DO WYKRESU ---
@app.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    try:
        # Zapytanie SQL: SELECT category, SUM(total_amount) FROM receipts GROUP BY category
        stats = db.query(
            models.Receipt.category,
            func.sum(models.Receipt.total_amount)
        ).group_by(models.Receipt.category).all()

        # Formatowanie wyniku dla Chart.js: {labels: [], data: []}
        labels = [row[0] for row in stats]
        values = [row[1] for row in stats]

        return {"labels": labels, "values": values}
    except Exception as e:
        return {"error": str(e)}

# 3. Asystent Finansowy (Chatbot)
@app.post("/api/chat")
async def chat_with_assistant(query: dict, db: Session = Depends(get_db)):
    if not client:
        return {"reply": "Błąd konfiguracji API (brak klucza)"}

    user_message = query.get("message")

    # 1. POBIERZ KONTEKST Z BAZY (RAG - Retrieval Augmented Generation)
    # Pobieramy 5 ostatnich paragonów, żeby nie zapchać AI za dużą ilością tekstu
    try:
        receipts = db.query(models.Receipt).order_by(models.Receipt.id.desc()).limit(5).all()

        # Budujemy "ściągę" dla AI
        history_text = "Oto ostatnie zakupy użytkownika (Baza Danych):\n"
        if not receipts:
            history_text += "(Brak zapisanych paragonów w bazie)\n"
        else:
            for r in receipts:
                # Wyciągamy też listę produktów do każdego paragonu
                items_list = ", ".join([f"{i.name} ({i.price}zł)" for i in r.items])
                history_text += f"- Data: {r.date}, Sklep: {r.store_name}, Suma: {r.total_amount} zł, Kategoria: {r.category}\n"
                history_text += f"  Produkty: {items_list}\n"
    except Exception as e:
        history_text = f"(Błąd pobierania z bazy: {str(e)})"

    # 2. SKLEJAMY PROMPT (Instrukcja + Dane + Pytanie)
    full_prompt = f"""
    Jesteś inteligentnym asystentem finansowym. Masz wgląd w historię zakupów użytkownika.

    {history_text}

    Pytanie użytkownika: {user_message}

    Odpowiedz krótko i konkretnie, opierając się na powyższych danych. Jeśli pytają o coś, czego nie ma w bazie, powiedz o tym wprost.
    """

    # 3. WYŚLIJ DO GEMINI
    try:
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=full_prompt
        )
        return {"reply": response.text}
    except Exception as e:
        return {"reply": f"Błąd AI: {str(e)}"}

# Serwowanie plików statycznych
app.mount("/static", StaticFiles(directory="static"), name="static")