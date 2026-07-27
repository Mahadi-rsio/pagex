{ description = "PageX API Service - Main Express backend";

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
            nodejs_20
            pnpm
            postgresql
            redis
            docker
            openssl
            git
          ];

          shellHook = ''
            echo "🚀 PageX API Service Development Shell"
            echo "========================================"
            
            # Set default environment variables
            export NODE_ENV="development"
            export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pagex_dev"
            export REDIS_URL="redis://localhost:6379/0"
            export MINIO_ENDPOINT="localhost:9000"
            export BASE_DOMAIN="localhost"
            export IN_DOCKER_COMPOSE="1"
            
            # Aliases
            alias dev="pnpm run dev"
            alias build="pnpm run build"
            alias migrate="pnpm run db:migrate"
            alias lint="pnpm run lint"
            alias gen="pnpm run db:generate"
            alias push="pnpm run db:push"
            alias studio="pnpm run db:studio"
            
            echo "📦 Available commands: dev, build, migrate, lint, gen, push, studio"
            echo "🔌 Required services: PostgreSQL, Redis, MinIO"
          '';
        };

        packages.default = pkgs.mkDerivation {
          name = "pagex-api";
          src = ./.;
          
          nativeBuildInputs = with pkgs; [ nodejs_20 pnpm ];
          
          buildPhase = ''
            echo "Installing dependencies..."
            pnpm install --frozen-lockfile
            
            echo "Building TypeScript..."
            pnpm run build
          '';

          installPhase = ''
            mkdir -p $out/bin
            mkdir -p $out/lib
            
            # Copy built files
            cp -r dist $out/lib/
            cp -r node_modules $out/lib/
            cp package.json $out/lib/
            
            # Create executable
            cat > $out/bin/pagex-api <<EOF
#!/bin/bash
cd $out/lib
exec node dist/src/server.js
EOF
            chmod +x $out/bin/pagex-api
          '';
        };

        # Docker image
        packages.docker = pkgs.dockerTools.buildImage {
          name = "pagex-api";
          tag = "latest";
          
          contents = [
            self.packages.${system}.default
            pkgs.nodejs_20
          ];
          
          config = {
            Cmd = [ "${self.packages.${system}.default}/bin/pagex-api" ];
            ExposedPorts = { "3000" = {}; };
            Env = [
              "NODE_ENV=production"
              "DATABASE_URL=postgresql://postgres:postgres@db:5432/pagex"
              "REDIS_URL=redis://redis:6379/0"
            ];
          };
        };
      }
    );
}