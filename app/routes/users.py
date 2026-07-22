import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, get_current_admin_user, verify_password, get_password_hash
from app.models.user import User
from app.schemas.users import UserOut, UserCreate, UserUpdate, UserProfileUpdate
from app.services.users import (
    create_new_user, 
    get_user_by_email, 
    get_users_list, 
    get_user_by_id, 
    update_existing_user
)

router = APIRouter()

@router.get("/me", response_model=UserOut)
def read_current_user_profile(
    current_user: User = Depends(get_current_user)
):
    """Giriş yapmış aktif kullanıcının kendi profil detaylarını getirir."""
    return current_user

@router.put("/me", response_model=UserOut)
def update_current_user_profile(
    payload: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Giriş yapmış kullanıcının ad, soyad, e-posta, kullanıcı kodu ve şifre bilgilerini günceller."""
    if payload.email and payload.email != current_user.email:
        existing = get_user_by_email(db, email=payload.email)
        if existing and existing.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bu e-posta adresi başka bir kullanıcı tarafından kullanılıyor."
            )
        current_user.email = payload.email

    if payload.first_name:
        current_user.first_name = payload.first_name

    if payload.last_name:
        current_user.last_name = payload.last_name

    if payload.user_code:
        current_user.user_code = payload.user_code

    if payload.new_password:
        if not payload.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mevcut şifrenizi girmeniz gerekmektedir."
            )
        if not verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Mevcut şifreniz hatalı."
            )
        current_user.password_hash = get_password_hash(payload.new_password)

    db.commit()
    db.refresh(current_user)
    return current_user

@router.post("/me/avatar", response_model=UserOut)
async def upload_user_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Profil fotoğrafı yükleme ve static klasör altında saklama ucu."""
    allowed_extensions = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Geçersiz dosya formatı. Yalnızca JPG, PNG, WEBP ve GIF yükleyebilirsiniz."
        )

    # Avatars dizini kontrol et
    avatar_dir = os.path.join(os.getcwd(), settings.AVATAR_UPLOAD_DIR)
    os.makedirs(avatar_dir, exist_ok=True)

    filename = f"{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(avatar_dir, filename)

    contents = await file.read()
    if len(contents) > settings.MAX_AVATAR_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Dosya boyutu {settings.MAX_AVATAR_SIZE_MB}MB'dan büyük olamaz."
        )

    with open(file_path, "wb") as f:
        f.write(contents)

    avatar_url = f"/static/avatars/{filename}"
    current_user.avatar_url = avatar_url
    db.commit()
    db.refresh(current_user)

    return current_user

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