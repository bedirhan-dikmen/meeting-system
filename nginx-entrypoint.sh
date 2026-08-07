#!/bin/sh

# V1 TESLİM FIX: Domain artık kod dosyalarına değil .env'deki DOMAIN
# değişkenine bağlı — bu sayede repo'yu devralan başka bir sunucuya
# kod dosyasını (bu dosyayı/nginx.conf'u) değiştirmeden deploy edilebiliyor.
DOMAIN="${DOMAIN:-localhost}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
FALLBACK_DIR="/etc/nginx/ssl"

mkdir -p "$CERT_DIR" "$FALLBACK_DIR" 2>/dev/null || true

if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
    echo "[Nginx Init] Creating self-signed SSL certificate for ${DOMAIN}..."
    apk add --no-cache openssl 2>/dev/null || true

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$CERT_DIR/privkey.pem" \
        -out "$CERT_DIR/fullchain.pem" \
        -subj "/CN=${DOMAIN}" 2>/dev/null || true

    if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$FALLBACK_DIR/privkey.pem" \
            -out "$FALLBACK_DIR/fullchain.pem" \
            -subj "/CN=localhost" 2>/dev/null || true
    fi
fi

# V1 TESLİM FIX: nginx.conf artık bir ŞABLON (nginx.conf.template, DOMAIN
# dışında nginx'in KENDİ runtime değişkenlerini de -- $remote_addr,
# $http_upgrade, $host, $scheme vb. -- içeriyor). envsubst'e SADECE $DOMAIN
# adını vermek, diğer $-işaretli nginx değişkenlerinin yanlışlıkla boş
# string'e dönüştürülüp config'i bozmasını engelliyor (resmi nginx Docker
# image'ının docker-entrypoint.d/20-envsubst-on-templates.sh'ının kullandığı
# aynı güvenli desen).
echo "[Nginx Init] Rendering nginx.conf for DOMAIN=${DOMAIN}..."
apk add --no-cache gettext 2>/dev/null || true
DOMAIN="$DOMAIN" envsubst '$DOMAIN' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "[Nginx Init] Starting Nginx web server..."
exec nginx -g 'daemon off;'
