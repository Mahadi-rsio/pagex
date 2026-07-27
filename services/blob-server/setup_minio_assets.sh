#!/bin/bash
set -e

echo "=== Configuring MinIO Client (mc) ==="
mc alias set myminio http://localhost:9000 minioadmin minioadmin

echo "=== Creating bucket 'cloudisy-sites' ==="
mc mb --ignore-existing myminio/cloudisy-sites

echo "=== Creating test directories for seeded tenants ==="
# We create temporary index files locally first
mkdir -p /tmp/tenant-a /tmp/tenant-b

cat << 'EOF' > /tmp/tenant-a/index.html
<!DOCTYPE html>
<html>
<head><title>Tenant A</title></head>
<body><h1>Hello from Tenant A!</h1></body>
</html>
EOF

cat << 'EOF' > /tmp/tenant-b/index.html
<!DOCTYPE html>
<html>
<head><title>Tenant B</title></head>
<body><h1>Hello from Tenant B!</h1></body>
</html>
EOF

echo "=== Uploading files to S3 (MinIO) ==="
# Tenant A UUID: 550e8400-e29b-41d4-a716-446655440000
mc cp /tmp/tenant-a/index.html myminio/cloudisy-sites/550e8400-e29b-41d4-a716-446655440000/index.html

# Tenant B UUID: 6ba7b810-9dad-11d1-80b4-00c04fd430c8
mc cp /tmp/tenant-b/index.html myminio/cloudisy-sites/6ba7b810-9dad-11d1-80b4-00c04fd430c8/index.html

echo "=== Cleaning up local temporary files ==="
rm -rf /tmp/tenant-a /tmp/tenant-b

echo "=== S3 Setup Complete! ==="
mc ls -r myminio/cloudisy-sites
