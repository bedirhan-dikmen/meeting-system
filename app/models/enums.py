import enum

class MeetingType(str, enum.Enum):
    DAILY = "DAILY"            # Günlük Toplantı
    WEEKLY = "WEEKLY"          # Haftalık Toplantı
    PROJECT = "PROJECT"        # Proje Toplantısı
    DEPARTMENT = "DEPARTMENT"  # Departman Toplantısı
    TRAINING = "TRAINING"      # Eğitim
    CUSTOMER = "CUSTOMER"      # Müşteri Toplantısı
    GENERAL = "GENERAL"        # Genel Toplantı
    OTHER = "OTHER"            # Diğer

class MeetingStatus(str, enum.Enum):
    DRAFT = "DRAFT"            # Taslak
    SCHEDULED = "SCHEDULED"    # Planlandı
    IN_PROGRESS = "IN_PROGRESS"# Başladı
    COMPLETED = "COMPLETED"    # Tamamlandı
    CANCELLED = "CANCELLED"    # İptal Edildi

class InvitationStatus(str, enum.Enum):
    PENDING = "PENDING"        # Bekliyor
    ACCEPTED = "ACCEPTED"      # Kabul Edildi
    DECLINED = "DECLINED"      # Reddedildi

class AttendanceStatus(str, enum.Enum):
    ATTENDED = "ATTENDED"      # Katıldı
    NOT_ATTENDED = "NOT_ATTENDED" # Katılmadı

class NoteType(str, enum.Enum):
    GENERAL = "GENERAL"        # Genel Toplantı Notu
    DECISION = "DECISION"      # Alınan Karar