from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os

# Używamy SQLite, bo nie wymaga serwera
SQLALCHEMY_DATABASE_URL = "sqlite:///./finance.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()