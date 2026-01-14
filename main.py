from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import models
from database import engine

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
async def scan_receipt(file: UploadFile = File(...)):
    # Cel: Wysyłka do AI i zwrot JSON [cite: 12, 39]
    return {"message": "Plik odebrany, AI jeszcze nie podpięte"}

# Miejsce dla osoby od CZATU (Moduł D)
@app.post("/chat")
async def chat_with_ai(query: str):
    # Cel: Odpowiedzi na pytania o wydatki [cite: 23, 52]
    return {"answer": f"Zapytałeś o: {query}. Implementacja RAG wkrótce."}