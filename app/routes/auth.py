# app/routes/auth.py
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.auth import LoginRequest, ExternalLoginRequest, TokenResponse
from app.services.auth import (
    authenticate_user, 
    authenticate_external_user, 
    generate_user_token,
    login_access_token
)

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
def login(
    payload: OAuth2PasswordRequestForm = Depends(),  # Swagger asma kilit formunu karşılar
    db: Session = Depends(get_db)
):
    """
    Form Data ile standart kullanıcı girişi ucu.
    OAuth2PasswordRequestForm kullanıldığı için payload.username e-posta yerine geçer.
    """
    return login_access_token(db=db, form_data=payload)


@router.post("/login-external", response_model=TokenResponse)
def login_external(payload: ExternalLoginRequest, db: Session = Depends(get_db)):
    """
    Kullanıcı Kodu (User Code) ve Şifre ile harici sistemlerden gelen personel girişi ucu.
    """
    user = authenticate_external_user(db, user_code=payload.user_code, password=payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Hatalı kullanıcı kodu veya şifre girdiniz."
        )
    return generate_user_token(user)