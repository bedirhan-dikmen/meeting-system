#!/bin/sh
set -e

CERT_DIR="/etc/letsencrypt/live/meeting.yebsoft.com"

if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    echo "[Nginx Init] Let's Encrypt SSL sertifikası bulunamadı. Otomatik self-signed SSL sertifikası oluşturuluyor..."
    mkdir -p "$CERT_DIR"
    apk add --no-cache openssl >/dev/null 2>&1 || true
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/privkey.pem" \
        -out "$CERT_DIR/fullchain.pem" \
        -subj "/CN=meeting.yebsoft.com" >/dev/null 2>&1 || true
    echo "[Nginx Init] Geçici SSL sertifikası üretildi."
fi

exec nginx -g 'daemon off;'
