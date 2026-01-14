# Używamy lekkiej wersji Pythona (Linux Alpine lub Slim)
FROM python:3.11-slim

# Ustawiamy katalog roboczy wewnątrz kontenera
WORKDIR /app

# Kopiujemy listę bibliotek i instalujemy je
# (Robimy to przed skopiowaniem kodu, żeby Docker użył cache'a, gdy zmienisz tylko kod)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopiujemy resztę plików aplikacji do kontenera
COPY . .

# Informujemy, że aplikacja używa portu 8000
EXPOSE 8000

# Komenda startowa (nasłuchujemy na 0.0.0.0, żeby Docker widział ruch z zewnątrz)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]