#!/bin/sh
# Generate a self-signed certificate on first boot (dev/eval use).
set -eu

CERT_DIR=/etc/nginx/certs
mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/server.crt" ]; then
    openssl req -x509 -nodes -newkey rsa:4096 \
        -keyout "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.crt" \
        -days 365 \
        -subj "/C=JP/O=GungiOnline/CN=localhost"
    echo "Self-signed TLS certificate generated at $CERT_DIR"
fi
