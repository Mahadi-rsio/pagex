# TLS certificates for Caddy

Caddy mounts:

- `cert.pem` → `/etc/caddy/certs/cert.pem`
- `key.pem` → `/etc/caddy/certs/key.pem`

## Local / repo default

The committed `cert.pem` / `key.pem` are a **dummy self-signed** cert (SANs for `*.cloudisy.com`, `api.cloudisy.com`, `*.localhost`, etc.). Browsers will warn; fine for local Docker.

Regenerate:

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 825 \
  -subj "/CN=*.cloudisy.com" \
  -addext "subjectAltName=DNS:*.cloudisy.com,DNS:api.cloudisy.com,DNS:cloudisy.com,DNS:*.localhost,DNS:api.localhost,DNS:localhost"
chmod 600 certs/key.pem
```

## Production (Cloudflare Origin Certificate)

1. Cloudflare → SSL/TLS → Origin Server → Create Certificate  
   Hostnames: `*.cloudisy.com`, `api.cloudisy.com`
2. Overwrite `certs/cert.pem` and `certs/key.pem` on the VPS
3. Cloudflare DNS `*` → VPS IP, **Proxied**
4. SSL/TLS mode → **Full (strict)**
5. `docker compose up -d --force-recreate caddy`
