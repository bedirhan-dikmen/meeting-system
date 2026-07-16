from sqlalchemy.orm import Session
from app.models.user import User
from app.schemas.users import UserCreate
from app.core.security import hash_password

def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

def get_user_by_registration_number(db: Session, reg_num: str):
    return db.query(User).filter(User.registration_number == reg_num).first()

def create_user(db: Session, user_in: UserCreate):
    # Şifreyi hash'le
    hashed_pw = hash_password(user_in.password)
    
    # SQLAlchemy model nesnesi oluştur
    db_user = User(
        company_name=user_in.company_name,
        title=user_in.title,
        email=user_in.email,
        registration_number=user_in.registration_number,
        hashed_password=hashed_pw,
        role=user_in.role
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user