FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/nginx.conf
COPY docker-entrypoint-certs.sh /docker-entrypoint.d/00-certs.sh
RUN chmod +x /docker-entrypoint.d/00-certs.sh
