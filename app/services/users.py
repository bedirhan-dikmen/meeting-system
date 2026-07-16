# app/services/users.py
from sqlalchemy.orm import Session
from app.models.user import User  # Merkezi models altından import
from app.schemas.users import UserCreate, UserUpdate
from app.core.security import get_password_hash

def get_user_by_email(db: Session, email: str):
    """E-postaya göre kullanıcı arar."""
    return db.query(User).filter(User.email == email).first()

def get_users_list(db: Session, skip: int = 0, limit: int = 100):
    """ID'ye göre kullanıcı arar."""
    return db.query(User).offset(skip).limit(limit).all()

def get_user_by_id(db: Session, user_id: int):
    """Kullanıcıları listeler (Sayfalama destekli)."""
    return db.query(User).filter(User.id == user_id).first()

def create_new_user(db: Session, user_data: UserCreate):
    """Yeni kullanıcı oluşturur."""
    hashed_pass = get_password_hash(user_data.password)
    db_user = User(
        email=user_data.email,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        user_code=user_data.user_code,
        role=user_data.role,
        department_id=user_data.department_id,
        password_hash=hashed_pass
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_existing_user(db: Session, db_user: User, update_data: UserUpdate) -> User:
    """Mevcut bir kullanıcının bilgilerini günceller."""
    # update_data içindeki None olmayan (gönderilmiş olan) alanları ayıklıyoruz
    dump_data = update_data.model_dump(exclude_unset=True)
    
    # Eğer şifre güncellenmek isteniyorsa hash'leyip modele yazıyoruz
    if "password" in dump_data and dump_data["password"]:
        hashed_pass = get_password_hash(dump_data["password"])
        setattr(db_user, "password_hash", hashed_pass)
        del dump_data["password"]

    # Diğer tüm alanları setattr ile dinamik olarak güncelliyoruz
    for key, value in dump_data.items():
        setattr(db_user, key, value)
        
    db.commit()
    db.refresh(db_user)
    return db_user