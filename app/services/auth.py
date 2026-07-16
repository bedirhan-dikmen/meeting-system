# app/services/auth.py
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import verify_password, create_access_token
from app.schemas.auth import TokenResponse


def authenticate_user(db: Session, email: str, password: str):
    """E-posta ve şifreye göre kullanıcı doğrulaması yapar (İç Personel)."""
    user = db.query(User).filter(User.email == email, User.is_active == True).first()
    if user is None:
        return None
    
    db_password_hash = getattr(user, "password_hash", None)
    if db_password_hash is None:
        return None
        
    if not verify_password(password, str(db_password_hash)):
        return None
        
    return user


def authenticate_external_user(db: Session, user_code: str, password: str):
    """Kullanıcı koduna göre kimlik doğrulaması yapar (Dış Entegrasyon)."""
    user = db.query(User).filter(User.user_code == user_code, User.is_active == True).first()
    if user is None:
        return None
        
    db_password_hash = getattr(user, "password_hash", None)
    if db_password_hash is None:
        return None
        
    if not verify_password(password, str(db_password_hash)):
        return None
        
    return user


def login_access_token(db: Session, form_data) -> TokenResponse:
    """OAuth2 şeması (form_data) ile gelen standart oturum açma akışını yönetir."""
    user = db.query(User).filter(User.email == form_data.username).first()
    
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hatalı e-posta veya şifre girdiniz."
        )
        
    db_password_hash = getattr(user, "password_hash", None)
    if db_password_hash is None or not verify_password(form_data.password, str(db_password_hash)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hatalı e-posta veya şifre girdiniz."
        )
        
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hesabınız pasif durumdadır."
        )
    
    user_id = getattr(user, "id", None)
    user_role = getattr(user, "role", "user")
    
    access_token = create_access_token(subject=str(user_id), role=str(user_role))
    
    # ESKİ DÖNÜŞ YAPISININ BİREBİR AYNISI
    from app.schemas.auth import TokenResponse as SchemaTokenResponse
    return SchemaTokenResponse(access_token=access_token, role=str(user_role))


def generate_user_token(user: User):
    """Doğrulanmış bir kullanıcı nesnesi için standart JWT yanıt paketi üretir."""
    user_id = getattr(user, "id", None)
    user_role = getattr(user, "role", "user")
    
    access_token = create_access_token(subject=str(user_id), role=str(user_role))
    
    # ESKİ DÖNÜŞ YAPISININ BİREBİR AYNISI
    from app.schemas.auth import TokenResponse as SchemaTokenResponse
    return SchemaTokenResponse(access_token=access_token, role=str(user_role))