from fastapi import APIRouter, Depends, HTTPException, status, Query  # Query mutlaka fastapi'den gelmeli!
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.database import get_db
from app.core.security import get_current_admin_user
from app.models.user import User
from app.schemas.users import UserOut, UserCreate, UserUpdate
from app.services.users import (
    create_new_user, 
    get_user_by_email, 
    get_users_list, 
    get_user_by_id, 
    update_existing_user
)

router = APIRouter()

@router.post("/", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    """Sistem yöneticileri (admin) tarafından yeni kullanıcı ekleme ucu."""
    existing_user = get_user_by_email(db, email=payload.email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bu e-posta adresi zaten kayıtlı."
        )
    return create_new_user(db, user_data=payload)

@router.get("/", response_model=List[UserOut])
def get_users(
    department_id: Optional[int] = Query(None, description="Filtrelemek istediğiniz departmanın tamsayı ID'si."),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    query = db.query(User)
    
    # Eğer istek atarken bir departman ID'si girilmişse filtrele, girilmemişse hepsini getir
    if department_id is not None:
        query = query.filter(User.department_id == department_id)
        
    users = query.all()
    return users

@router.get("/{user_id}", response_model=UserOut)
def read_user_by_id(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    """UUID ile tekil bir kullanıcının detaylarını getirir (Sadece Admin)."""
    user = get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Kullanıcı bulunamadı."
        )
    return user

@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    """Kullanıcı bilgilerini günceller (Sadece Admin)."""
    user = get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Güncellenmek istenen kullanıcı bulunamadı."
        )
        
    # E-posta değiştirilmek isteniyorsa benzersizlik kontrolü
    if payload.email is not None and payload.email != user.email:
        existing_email = get_user_by_email(db, email=payload.email)
        if existing_email is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor."
            )
            
    return update_existing_user(db, db_user=user, update_data=payload)

@router.delete("/{user_id}", response_model=UserOut)
def delete_user(
    user_id: UUID,
    soft_delete: bool = True,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user)
):
    """Kullanıcı silme veya pasife alma ucu (Sadece Admin)."""
    user = get_user_by_id(db, user_id=user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Kullanıcı bulunamadı."
        )
        
    # Admin kendi kendini silemez/pasife alamaz kontrolü
    if user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bir admin kendi hesabını silemez."
        )
        
    if soft_delete:
        user.is_active = False
        db.commit()
        db.refresh(user)
    else:
        db.delete(user)
        db.commit()
        
    return user