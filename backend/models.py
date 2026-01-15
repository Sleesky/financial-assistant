from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from database import Base

class Receipt(Base):
    __tablename__ = "receipts"
    id = Column(Integer, primary_key=True, index=True)
    store_name = Column(String, default="Nieznany")
    date = Column(String, default="")
    total_amount = Column(Float, default=0.0)
    category = Column(String, default="Inne")
    items = relationship("Item", back_populates="receipt", cascade="all, delete-orphan")

class Item(Base):
    __tablename__ = "items"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    price = Column(Float)
    receipt_id = Column(Integer, ForeignKey("receipts.id"))
    receipt = relationship("Receipt", back_populates="items")