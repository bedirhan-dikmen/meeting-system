from sqlalchemy.orm import Session
from app.models.user import User
from app.schemas.users import UserCreate
from app.core.security import get_password_hash

def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

def get_user_by_code(db: Session, user_code: str):
    return db.query(User).filter(User.user_code == user_code).first()

def create_user(db: Session, user_in: UserCreate):
    # Şifreyi hash'le
    hashed_pw = get_password_hash(user_in.password)
    
    # SQLAlchemy model nesnesi oluştur
    db_user = User(
        first_name=user_in.first_name,
        last_name=user_in.last_name,
        email=user_in.email,
        user_code=user_in.user_code,
        password_hash=hashed_pw,
        role=user_in.role,
        department_id=user_in.department_id,
        is_active=True
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user