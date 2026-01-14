from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()

class Receipt(Base):
    __tablename__ = "receipts"

    id = Column(Integer, primary_key=True, index=True)
    shop_name = Column(String) # [cite: 13]
    total_amount = Column(Float) # [cite: 16]
    category = Column(String) # [cite: 17]
    date_of_purchase = Column(DateTime, default=datetime.utcnow) # [cite: 14]
    raw_json = Column(String)  # Tu zapiszecie pełną odpowiedź z AI na wszelki wypadek