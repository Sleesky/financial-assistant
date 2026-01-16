from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
import google.generativeai as genai
import os
import json
import time
from dotenv import load_dotenv
from database import SessionLocal, engine
import models

# 1. Konfiguracja
load_dotenv()
GENAI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GENAI_API_KEY:
    raise ValueError("Brak klucza GEMINI_API_KEY w pliku .env")

genai.configure(api_key=GENAI_API_KEY)

generation_config = {
    "temperature": 0.2,
    "top_p": 0.95,
    "top_k": 40,
    "max_output_tokens": 8192,
    "response_mime_type": "application/json",
}

model = genai.GenerativeModel(model_name="gemini-2.5-flash", generation_config=generation_config)
chat_model = genai.GenerativeModel(model_name="gemini-2.5-flash")

models.Base.metadata.create_all(bind=engine)

app = FastAPI()
app.mount("/static", StaticFiles(directory="../frontend"), name="static")


# 2. Modele Danych
class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []  # Dodano historię rozmowy


class ReceiptUpdate(BaseModel):
    store_name: Optional[str] = None
    date: Optional[str] = None
    total_amount: Optional[float] = None
    category: Optional[str] = None
    items: Optional[List[dict]] = None


class ReceiptCreate(BaseModel):
    store_name: str
    date: str
    total_amount: float
    category: str
    items: List[dict]


class BatchDeleteRequest(BaseModel):
    ids: List[int]


# 3. Funkcje Pomocnicze
def call_gemini_safe(func, *args, **kwargs):
    max_retries = 3
    wait_time = 20
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                print(f"⚠️ Limit API (429). Czekam {wait_time}s... (Próba {attempt + 1})")
                time.sleep(wait_time)
            else:
                raise e
    raise HTTPException(status_code=429, detail="Serwer AI przeciążony.")


@app.get("/")
def read_root():
    return JSONResponse(content={"message": "iFinAI API Ready"})


# 4. Endpoints
@app.post("/api/scan-receipt")
def scan_receipt(files: List[UploadFile] = File(...)):
    results = []
    db = SessionLocal()
    for file in files:
        try:
            content = file.file.read()
            prompt = """
            Jesteś skanerem paragonów. Jeśli to NIE paragon (np. kot, krajobraz), zwróć {"error": "Not a receipt"}.
            Jeśli paragon, wyciągnij JSON:
            - store_name (string, "Nieznany" jeśli brak)
            - date (YYYY-MM-DD)
            - total_amount (float)
            - category (Spożywcze, Paliwo, Restauracja, Elektronika, Farmaceutyki, Inne)
            - items (lista obiektów: name, price)
            """

            response = call_gemini_safe(
                model.generate_content,
                [prompt, {"mime_type": file.content_type, "data": content}]
            )

            text_response = response.text.replace("```json", "").replace("```", "").strip()
            if not text_response: raise ValueError("Pusta odpowiedź AI")

            try:
                data = json.loads(text_response)
            except:
                results.append({"filename": file.filename, "status": "error", "message": "Zły format JSON"})
                continue

            if "error" in data:
                results.append({"filename": file.filename, "status": "rejected", "message": "To nie paragon"})
                continue

            store = data.get("store_name", "Nieznany")
            total = data.get("total_amount", 0.0)
            if (store == "Nieznany" and total == 0.0) or (store is None):
                results.append({"filename": file.filename, "status": "rejected", "message": "Nieczytelne dane"})
                continue

            db_receipt = models.Receipt(
                store_name=store, date=data.get("date"), total_amount=total, category=data.get("category", "Inne")
            )
            db.add(db_receipt)
            db.commit()
            db.refresh(db_receipt)

            for item in data.get("items", []):
                db.add(models.Item(name=item.get("name", "Produkt"), price=item.get("price", 0.0),
                                   receipt_id=db_receipt.id))

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
            "id": r.id, "store_name": r.store_name, "date": r.date, "total_amount": r.total_amount,
            "category": r.category, "items": [{"name": i.name, "price": i.price} for i in items]
        })
    db.close()
    return JSONResponse(content=data)


@app.delete("/api/receipts/{receipt_id}")
def delete_receipt(receipt_id: int):
    db = SessionLocal()
    r = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if r:
        db.query(models.Item).filter(models.Item.receipt_id == receipt_id).delete()
        db.delete(r)
        db.commit()
    db.close()
    return {"status": "deleted"}


@app.put("/api/receipts/{receipt_id}")
def update_receipt(receipt_id: int, update_data: ReceiptUpdate):
    db = SessionLocal()
    r = db.query(models.Receipt).filter(models.Receipt.id == receipt_id).first()
    if not r:
        db.close()
        raise HTTPException(status_code=404, detail="Not found")

    if update_data.store_name is not None: r.store_name = update_data.store_name
    if update_data.date is not None: r.date = update_data.date
    if update_data.total_amount is not None: r.total_amount = update_data.total_amount
    if update_data.category is not None: r.category = update_data.category

    if update_data.items is not None:
        db.query(models.Item).filter(models.Item.receipt_id == receipt_id).delete()
        for item in update_data.items:
            db.add(models.Item(name=item['name'], price=item['price'], receipt_id=receipt_id))

    db.commit()
    db.close()
    return {"status": "updated"}


@app.post("/api/receipts/manual")
def create_manual(data: ReceiptCreate):
    db = SessionLocal()
    r = models.Receipt(store_name=data.store_name, date=data.date, total_amount=data.total_amount,
                       category=data.category)
    db.add(r)
    db.commit()
    db.refresh(r)
    for item in data.items:
        db.add(models.Item(name=item.get('name', 'Produkt'), price=item.get('price', 0), receipt_id=r.id))
    db.commit()
    db.close()
    return {"status": "created"}


@app.post("/api/receipts/batch-delete")
def batch_delete(payload: BatchDeleteRequest):
    db = SessionLocal()
    db.query(models.Item).filter(models.Item.receipt_id.in_(payload.ids)).delete(synchronize_session=False)
    db.query(models.Receipt).filter(models.Receipt.id.in_(payload.ids)).delete(synchronize_session=False)
    db.commit()
    db.close()
    return {"status": "deleted"}


# --- INTELLIGENT CHAT ---
@app.post("/api/chat")
def chat_with_assistant(request: ChatRequest):
    user_msg = request.message
    history = request.history

    db = SessionLocal()
    # Pobieramy paragony Z PRODUKTAMI
    receipts = db.query(models.Receipt).order_by(models.Receipt.date.desc()).limit(50).all()

    # Budujemy kontekst bazy danych (teraz z listą zakupów!)
    data_context = ""
    for r in receipts:
        items = db.query(models.Item).filter(models.Item.receipt_id == r.id).all()
        items_str = ", ".join([f"{i.name} ({i.price}zl)" for i in items])
        data_context += f"- ID:{r.id} | Data:{r.date} | Sklep:{r.store_name} | Suma:{r.total_amount}zl | Produkty: [{items_str}]\n"

    db.close()

    # Budujemy historię rozmowy
    conversation_context = ""
    for msg in history[-6:]:  # Ostatnie 6 wiadomości dla kontekstu
        role = "Użytkownik" if msg.role == "user" else "AI"
        conversation_context += f"{role}: {msg.content}\n"

    full_prompt = f"""
    Jesteś inteligentnym asystentem finansowym. Masz dostęp do historii ostatnich zakupów użytkownika.

    OSTATNIE ZAKUPY (Baza Danych):
    {data_context}

    HISTORIA ROZMOWY (Kontekst):
    {conversation_context}

    AKTUALNE PYTANIE UŻYTKOWNIKA: "{user_msg}"

    INSTRUKCJE:
    1. Używaj "HISTORII ROZMOWY", aby zrozumieć kontekst (np. "tam" oznacza sklep z poprzedniego pytania).
    2. Jeśli user pyta "co kupiłem w RTV?", sprawdź pole "Produkty" w bazie danych dla tego sklepu i wypisz je.
    3. Jeśli user pyta o sumę, policz ją precyzyjnie na podstawie danych.
    4. Odpowiadaj zwięźle, konkretnie i w stylu Apple/Fintech. Używaj pogrubień dla kwot i nazw.
    """

    try:
        response = call_gemini_safe(chat_model.generate_content, full_prompt)
        return JSONResponse(content={"reply": response.text})
    except Exception as e:
        print(f"Chat Error: {e}")
        return JSONResponse(content={"reply": "Przepraszam, mam problem z połączeniem."})