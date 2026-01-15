FROM python:3.11-slim

WORKDIR /app

# Skoro kontekst to folder backend, kopiujemy plik bezpośrednio:
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Upewnij się, że startuje z 0.0.0.0, inaczej Docker go nie zobaczy
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]