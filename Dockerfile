# Używamy oficjalnego obrazu Python w wersji slim
FROM python:3.11-slim

# Ustawiamy katalog roboczy w kontenerze
WORKDIR /app

# Kopiujemy plik z zależnościami
COPY backend/requirements.txt .

# Instalujemy zależności
RUN pip install --no-cache-dir -r requirements.txt

# Kopiujemy kod backendu
COPY backend/ .

# Kopiujemy frontend (aby FastAPI mógł go serwować jako pliki statyczne)
COPY frontend/ ./static

# Otwieramy port 8000
EXPOSE 8000

# Uruchamiamy serwer (z opcją reload dla trybu deweloperskiego)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]