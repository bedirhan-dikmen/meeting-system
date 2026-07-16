from sqlalchemy.orm import Session
from sqlalchemy import select
from uuid import UUID
from typing import List, Optional
from app.models.user import User
from app.schemas.users import UserCreate, UserUpdate
from app.core.security import get_password_hash

def get_user_by_id(db: Session, user_id: UUID) -> Optional[User]:
    """UUID ile tekil kullanıcı getirir."""
    return db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()

def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """E-posta ile tekil kullanıcı getirir."""
    return db.execute(select(User).where(User.email == email)).scalar_one_or_none()

def get_users_list(db: Session, skip: int = 0, limit: int = 100) -> List[User]:
    """Kullanıcı listesini sayfalayarak getirir."""
    query = select(User).offset(skip).limit(limit)
    return list(db.execute(query).scalars().all())

def create_new_user(db: Session, user_data: UserCreate) -> User:
    """Yeni bir kullanıcıyı şifresini hashleyerek güvenle kaydeder."""
    hashed_password = get_password_hash(user_data.password)
    
    db_user = User(
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        email=user_data.email,
        user_code=user_data.user_code,
        password_hash=hashed_password,
        role=user_data.role,
        department_id=user_data.department_id,
        is_active=True
    )
    
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_existing_user(db: Session, db_user: User, update_data: UserUpdate) -> User:
    """Mevcut bir kullanıcının bilgilerini günceller."""
    update_dict = update_data.model_dump(exclude_unset=True)
    
    # Şifre güncellemesi talep edilmişse, hash'leyip modele yazıyoruz
    if "password" in update_dict and update_dict["password"]:
        db_user.password_hash = get_password_hash(update_dict["password"])
        del update_dict["password"]
        
    for key, value in update_dict.items():
        setattr(db_user, key, value)
        
    db.commit()
    db.refresh(db_user)
    return db_user