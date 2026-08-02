#!/bin/sh

CERT_DIR="/etc/letsencrypt/live/meeting.yebsoft.com"
FALLBACK_DIR="/etc/nginx/ssl"

mkdir -p "$CERT_DIR" "$FALLBACK_DIR" 2>/dev/null || true

if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    echo "[Nginx Init] Creating self-signed SSL certificate..."
    apk add --no-cache openssl 2>/dev/null || true
    
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/privkey.pem" \
        -out "$CERT_DIR/fullchain.pem" \
        -subj "/CN=meeting.yebsoft.com" 2>/dev/null || true
        
    if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$FALLBACK_DIR/privkey.pem" \
            -out "$FALLBACK_DIR/fullchain.pem" \
            -subj "/CN=localhost" 2>/dev/null || true
    fi
fi

echo "[Nginx Init] Starting Nginx web server..."
exec nginx -g 'daemon off;'
