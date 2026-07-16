# app/routes/users.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.core.security import get_current_admin_user  # security.py'den artık hatasız çekilir
from app.models.user import User
from app.schemas.users import UserOut, UserCreate, UserUpdate
from app.services.users import create_new_user, get_user_by_email, get_users_list, get_user_by_id, update_existing_user

router = APIRouter()


@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: UserCreate, 
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    existing_user = get_user_by_email(db, email=payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bu e-posta adresi zaten kayıtlı."
        )
    return create_new_user(db, user_data=payload)


@router.get("/", response_model=List[UserOut])
def read_users(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    return get_users_list(db, skip=skip, limit=limit)

@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    """Kullanıcı bilgilerini günceller (Sadece Admin)."""
    user = get_user_by_id(db, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Güncellenmek istenen kullanıcı bulunamadı.")
    
    # E-posta değiştirilmek isteniyorsa benzersizlik kontrolü yapalım
    if payload.email is not None and payload.email != getattr(user, "email", None):
        existing_email = get_user_by_email(db, email=payload.email)
        if existing_email is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor."
            )

    return update_existing_user(db, db_user=user, update_data=payload)


@router.delete("/{user_id}", response_model=UserOut)
def delete_user(
    user_id: int,
    soft_delete: bool = True,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    # 'not user' yerine 'user is None' kullanmak analizciyi sakinleştirir
    user = get_user_by_id(db, user_id=user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    
    # HATA ÇÖZÜMÜ: getattr kullanarak tip analizcisinin Column engeline takılmasını tamamen aşırı bypass ediyoruz
    admin_id = getattr(current_admin, "id", None)
    target_user_id = getattr(user, "id", None)
    
    if admin_id is not None and target_user_id is not None:
        if int(admin_id) == int(target_user_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Bir admin kendi hesabını silemez."
            )

    if soft_delete:
        # Doğrudan setattr kullanımı en güvenli atama yöntemidir
        setattr(user, "is_active", False)
        db.commit()
        db.refresh(user)
    else:
        db.delete(user)
        db.commit()
        
    return user