from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import google.generativeai as genai
import os
import json
import time
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from database import SessionLocal, engine
import models

# Ładowanie zmiennych środowiskowych
load_dotenv()

GENAI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GENAI_API_KEY:
    raise ValueError("Brak klucza GENAI_API_KEY w pliku .env")

genai.configure(api_key=GENAI_API_KEY)

generation_config = {
    "temperature": 0.4,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 8192,
    "response_mime_type": "application/json",
}

model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
    generation_config=generation_config,
)

chat_model = genai.GenerativeModel(
    model_name="gemini-1.5-flash",
)

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.mount("/static", StaticFiles(directory="../frontend"), name="static")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- FUNKCJA CZEKAJĄCA (Bezpieczna) ---
def call_gemini_safe(func, *args, **kwargs):
    """Próbuje wywołać Gemini, przy błędzie 429 czeka i ponawia."""
    max_retries = 3
    wait_time = 20  # Zmniejszyłem do 20s

    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                print(f"⚠️ Limit API (429). Czekam {wait_time}s... (Próba {attempt + 1})")
                time.sleep(wait_time)  # Teraz to jest bezpieczne w funkcji 'def'
            else:
                raise e

    raise HTTPException(status_code=429, detail="Serwer AI jest przeciążony. Spróbuj za minutę.")


# -------------------------------------------------------

class ChatRequest(BaseModel):
    message: str


class ReceiptUpdate(BaseModel):
    store_name: Optional[str] = None
    date: Optional[str] = None
    total_amount: Optional[float] = None
    category: Optional[str] = None
    items: Optional[List[dict]] = None


@app.get("/")
def read_root():
    return JSONResponse(content={"message": "iFinAI API Ready"})


# ZMIANA: Usunięto 'async', używamy 'def' aby FastAPI użyło wątków
@app.post("/api/scan-receipt")
def scan_receipt(files: List[UploadFile] = File(...)):
    results = []
    db = SessionLocal()

    for file in files:
        try:
            # ZMIANA: Czytanie synchroniczne
            content = file.file.read()

            prompt = """
            Przeanalizuj to zdjęcie paragonu. Wyciągnij dane JSON:
            - store_name (nazwa sklepu)
            - date (YYYY-MM-DD)
            - total_amount (float)
            - category (Spożywcze, Paliwo, Restauracja, Elektronika, Farmaceutyki, Inne)
            - items (lista obiektów: name, price)
            Jeśli to nie paragon, zwróć {"error": "Not a receipt"}.
            """

            response = call_gemini_safe(
                model.generate_content,
                [prompt, {"mime_type": file.content_type, "data": content}]
            )

            # Czyszczenie odpowiedzi z markdown (czasem Gemini dodaje ```json)
            text_response = response.text.replace("```json", "").replace("```", "").strip()
            extracted_data = json.loads(text_response)

            if "error" in extracted_data:
                results.append({"filename": file.filename, "status": "rejected_not_a_receipt"})
                continue

            db_receipt = models.Receipt(
                store_name=extracted_data.get("store_name", "Nieznany"),
                date=extracted_data.get("date"),
                total_amount=extracted_data.get("total_amount", 0.0),
                category=extracted_data.get("category", "Inne")
            )
            db.add(db_receipt)
            db.commit()
            db.refresh(db_receipt)

            items = extracted_data.get("items", [])
            for item in items:
                db_item = models.Item(
                    name=item.get("name", "Produkt"),
                    price=item.get("price", 0.0),
                    receipt_id=db_receipt.id
                )
                db.add(db_item)

            db.commit()
            results.append({"filename": file.filename, "status": "saved"})

        except Exception as e:
            print(f"Błąd: {e}")
            results.append({"filename": file.filename, "status": "error", "message": str(e)})

    db.close()
    return JSONResponse(content=results)


@app.get("/api/receipts")
def get_receipts():
    db = SessionLocal()
    receipts = db.query(models.Receipt).all()

    data = []
    for r in receipts:
        items = db.query(models.Item).filter(models.Item.receipt_id == r.id).all()
        data.append({
            "id": r.id,
            "store_name": r.store_name,
            "date": r.date,
            "total_amount": r.total_amount,
            "category": r.category,
            "items": [{"name": i.name, "price": i.price} for i in items]
        })

    db.close()
    return JSONResponse(content=data)


@app.delete("/api/receipts/{receipt_id}")
def delete_receipt(receipt_id: int):
    db = SessionLocal()
    receipt = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if receipt:
        db.query(models.Item).filter(models.Item.receipt_id == receipt_id).delete()
        db.delete(receipt)
        db.commit()
    db.close()
    return {"status": "deleted"}


@app.put("/api/receipts/{receipt_id}")
def update_receipt(receipt_id: int, update_data: ReceiptUpdate):
    db = SessionLocal()
    receipt = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if not receipt:
        db.close()
        raise HTTPException(status_code=404, detail="Paragon nie znaleziony")

    if update_data.store_name is not None: receipt.store_name = update_data.store_name
    if update_data.date is not None: receipt.date = update_data.date
    if update_data.total_amount is not None: receipt.total_amount = update_data.total_amount
    if update_data.category is not None: receipt.category = update_data.category

    if update_data.items is not None:
        db.query(models.Item).filter(models.Item.receipt_id == receipt_id).delete()
        for item in update_data.items:
            db.add(models.Item(name=item['name'], price=item['price'], receipt_id=receipt_id))

    db.commit()
    db.close()
    return {"status": "updated"}


# ZMIANA: Usunięto 'async', używamy 'def'
@app.post("/api/chat")
def chat_with_assistant(request: ChatRequest):
    user_message = request.message
    db = SessionLocal()

    receipts = db.query(models.Receipt).order_by(models.Receipt.date.desc()).limit(10).all()
    history_text = "\n".join([f"- {r.date}: {r.store_name}, {r.total_amount} zł" for r in receipts])
    db.close()

    full_prompt = f"""
    Kontekst (ostatnie zakupy):
    {history_text}
    Użytkownik: {user_message}
    Odpowiedz krótko, używając Markdown (pogrubienia, listy). Styl Apple/Fintech.
    """

    try:
        response = call_gemini_safe(chat_model.generate_content, full_prompt)
        return JSONResponse(content={"reply": response.text})
    except Exception as e:
        return JSONResponse(content={"reply": "Serwer AI odpoczywa (limit zapytań). Spróbuj za chwilę."})