import random
from datetime import datetime, timedelta
from database import SessionLocal, engine
import models

# Upewnij się, że tabele istnieją
models.Base.metadata.create_all(bind=engine)


def seed_data(n=20):
    db = SessionLocal()

    print(f"🌱 Generowanie {n} losowych paragonów...")

    # Dane do losowania
    CATEGORIES = {
        "Spożywcze": ["Biedronka", "Lidl", "Żabka", "Auchan", "Carrefour"],
        "Paliwo": ["Orlen", "BP", "Shell", "Circle K"],
        "Elektronika": ["Media Markt", "RTV Euro AGD", "X-Kom"],
        "Farmaceutyki": ["Apteka DOZ", "Super-Pharm", "Apteka Gemini"],
        "Restauracja": ["McDonald's", "KFC", "Pizza Hut", "Starbucks"],
        "Inne": ["Kiosk Ruch", "Poczta Polska", "Rossmann"]
    }

    PRODUCTS = {
        "Spożywcze": [("Mleko", 3.50), ("Chleb", 4.20), ("Masło", 7.99), ("Ser żółty", 12.50), ("Woda 1.5L", 2.10),
                      ("Pomidory", 15.00), ("Chipsy", 6.50)],
        "Paliwo": [("Paliwo 95", 250.00), ("Hot Dog", 9.99), ("Kawa czarna", 11.00), ("Płyn do spryskiwaczy", 29.99)],
        "Elektronika": [("Kabel USB-C", 39.00), ("Baterie AA", 15.00), ("Słuchawki", 120.00), ("Pendrive 64GB", 45.00)],
        "Farmaceutyki": [("Ibuprom", 18.50), ("Witamina C", 12.00), ("Syrop na kaszel", 25.00), ("Plastry", 8.00)],
        "Restauracja": [("Zestaw Big Mac", 35.00), ("Pizza Pepperoni", 42.00), ("Kawa Latte", 16.00),
                        ("Kubełek skrzydełek", 55.00)],
        "Inne": [("Gazeta", 5.50), ("Znaczki pocztowe", 12.00), ("Szampon", 18.00)]
    }

    for _ in range(n):
        # 1. Losuj kategorię i sklep
        category = random.choice(list(CATEGORIES.keys()))
        store = random.choice(CATEGORIES[category])

        # 2. Losuj datę (ostatnie 60 dni)
        days_back = random.randint(0, 60)
        date_obj = datetime.now() - timedelta(days=days_back)
        date_str = date_obj.strftime("%Y-%m-%d")

        # 3. Generuj produkty
        num_items = random.randint(1, 5)
        items_to_add = []
        total_amount = 0.0

        for _ in range(num_items):
            prod_name, base_price = random.choice(PRODUCTS[category])
            # Lekka wariacja ceny +/- 10%
            price = round(base_price * random.uniform(0.9, 1.1), 2)
            items_to_add.append({"name": prod_name, "price": price})
            total_amount += price

        # 4. Zapisz Paragon
        db_receipt = models.Receipt(
            store_name=store,
            date=date_str,
            total_amount=round(total_amount, 2),
            category=category
        )
        db.add(db_receipt)
        db.commit()
        db.refresh(db_receipt)

        # 5. Zapisz Produkty przypisane do paragonu
        for item in items_to_add:
            db_item = models.Item(
                name=item["name"],
                price=item["price"],
                receipt_id=db_receipt.id
            )
            db.add(db_item)

    db.commit()
    db.close()
    print("✅ Gotowe! Baza została zasilona.")


if __name__ == "__main__":
    seed_data(30)  # Dodaj 30 paragonów