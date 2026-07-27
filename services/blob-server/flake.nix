{ description = "PageX Blob Server - Caddy with static_s3 plugin";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            go
            caddy
            gcc
            pkg-config
            git
            openssl
          ];

          shellHook = ''
            echo "🚀 PageX Blob Server Development Shell"
            echo "========================================"
            
            # Set Go environment
            export GOPATH="$HOME/go"
            export PATH="$GOPATH/bin:$PATH"
            export GO111MODULE="on"
            
            # Environment variables for development
            export S3_ACCESS_KEY="minioadmin"
            export S3_SECRET_KEY="minioadmin"
            export MINIO_ENDPOINT_URL="http://localhost:9000"
            export MINIO_BUCKET="pagex-blobs"
            export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pagex_dev"
            export REDIS_URL="redis://localhost:6379/0"
            export BASE_DOMAIN="localhost"
            
            # Aliases
            alias build="go build -o caddy ."
            alias test="go test -v ./..."
            alias run="caddy run --config Caddyfile"
            alias xcaddy="xcaddy build --with github.com/Mahadi-rsio/pagex/services/blob-server=. --output ./caddy"
            
            echo "📦 Available commands: build, test, run, xcaddy"
            echo "🔌 Required services: MinIO, PostgreSQL, Redis"
          '';
        };

        packages.default = pkgs.mkDerivation {
          name = "pagex-blob-server";
          src = ./.;
          
          nativeBuildInputs = with pkgs; [ go gcc pkg-config ];
          
          buildPhase = ''
            echo "Downloading Go dependencies..."
            go mod download
            
            echo "Building Caddy with static_s3 plugin..."
            if command -v xcaddy &> /dev/null; then
              xcaddy build --with github.com/Mahadi-rsio/pagex/services/blob-server=. --output ./caddy
            else
              echo "xcaddy not found, using go build instead"
              go build -o caddy .
            fi
          '';

          installPhase = ''
            mkdir -p $out/bin
            mkdir -p $out/etc/caddy
            
            # Copy built Caddy binary
            cp caddy $out/bin/
            
            # Copy configuration
            cp Caddyfile $out/etc/caddy/
            
            # Create executable wrapper
            cat > $out/bin/pagex-blob-server <<EOF
#!/bin/bash
exec $out/bin/caddy run --config $out/etc/caddy/Caddyfile
EOF
            chmod +x $out/bin/pagex-blob-server
          '';
        };

        # Docker image
        packages.docker = pkgs.dockerTools.buildImage {
          name = "pagex-blob-server";
          tag = "latest";
          
          contents = [
            self.packages.${system}.default
            pkgs.caddy
          ];
          
          config = {
            Cmd = [ "${self.packages.${system}.default}/bin/pagex-blob-server" ];
            ExposedPorts = {
              "80" = {};
              "443" = {};
              "3080" = {};
            };
            Env = [
              "S3_ACCESS_KEY"
              "S3_SECRET_KEY"
              "DATABASE_URL=postgresql://postgres:postgres@db:5432/pagex"
              "REDIS_URL=redis://redis:6379/0"
              "MINIO_ENDPOINT_URL"
              "MINIO_BUCKET"
              "BASE_DOMAIN"
            ];
          };
        };
      }
    );
}