# app/modules/auth/routes.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.models.all_models import User
from app.models.auth.schemas import LoginRequest, ExternalLoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])

@router.post("/login", response_model=TokenResponse)
def login(
    # Payload şeması yerine FastAPI'ın kendi Form formunu dependency olarak alıyoruz
    payload: OAuth2PasswordRequestForm = Depends(), 
    db: Session = Depends(get_db)
):
    """
    Form Data ile standart kullanıcı girişi ucu.
    OAuth2PasswordRequestForm kullanıldığı için payload.username e-posta yerine geçer.
    """
    user = db.query(User).filter(User.email == payload.username).first()
    
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hatalı e-posta veya şifre girdiniz."
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hesabınız pasif durumdadır."
        )
        
    token = create_access_token(subject=user.id, role=user.role)
    return TokenResponse(access_token=token, role=user.role)


@router.post("/login-external", response_model=TokenResponse)
def login_external(payload: ExternalLoginRequest, db: Session = Depends(get_db)):
    """
    Kullanıcı Kodu (User Code) ve Şifre ile harici sistemlerden gelen personel girişi ucu.
    """
    # Veritabanında kullanıcı koduna göre ara
    user = db.query(User).filter(User.user_code == payload.user_code).first()
    
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hatalı kullanıcı kodu veya şifre girdiniz."
        )
        
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Hesabınız aktif değil."
        )
        
    token = create_access_token(subject=user.id, role=user.role)
    return TokenResponse(access_token=token, role=user.role)