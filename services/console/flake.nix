{ description = "PageX Console - Next.js web interface";

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
            openssl
            git
          ];

          shellHook = ''
            echo "🚀 PageX Console Development Shell"
            echo "==================================="
            
            # Set default environment variables
            export NODE_ENV="development"
            export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/pagex_dev"
            export REDIS_URL="redis://localhost:6379/0"
            export PUBLIC_URL="http://localhost:3080"
            export BETTER_AUTH_URL="http://localhost:3080"
            export BETTER_AUTH_TRUSTED_ORIGINS="http://localhost:3080"
            export BETTER_AUTH_SECRET="development-secret-change-me"
            export ENABLE_EMAIL_PASSWORD="true"
            export NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD="true"
            
            # Aliases
            alias dev="pnpm run dev"
            alias build="pnpm run build"
            alias lint="pnpm run lint"
            alias db:generate="pnpm run db:generate"
            alias db:migrate="pnpm run db:migrate"
            alias db:push="pnpm run db:push"
            alias db:studio="pnpm run db:studio"
            
            echo "📦 Available commands: dev, build, lint, db:*"
            echo "🔌 Required services: PostgreSQL, Redis"
          '';
        };

        packages.default = pkgs.mkDerivation {
          name = "pagex-console";
          src = ./.;
          
          nativeBuildInputs = with pkgs; [ nodejs_20 pnpm ];
          
          buildPhase = ''
            echo "Installing dependencies..."
            pnpm install --frozen-lockfile
            
            echo "Building Next.js application..."
            export NODE_ENV=production
            export BUILD_MODE=standalone
            pnpm run build
          '';

          installPhase = ''
            mkdir -p $out/lib
            mkdir -p $out/bin
            
            # Copy built files
            cp -r .next $out/lib/
            cp -r public $out/lib/
            cp -r node_modules $out/lib/
            cp package.json $out/lib/
            
            # Create executable
            cat > $out/bin/pagex-console <<EOF
#!/bin/bash
cd $out/lib
exec node .next/standalone/server.js
EOF
            chmod +x $out/bin/pagex-console
          '';
        };

        # Docker image
        packages.docker = pkgs.dockerTools.buildImage {
          name = "pagex-console";
          tag = "latest";
          
          contents = [
            self.packages.${system}.default
            pkgs.nodejs_20
          ];
          
          config = {
            Cmd = [ "${self.packages.${system}.default}/bin/pagex-console" ];
            ExposedPorts = { "3000" = {}; };
            Env = [
              "NODE_ENV=production"
              "DATABASE_URL=postgresql://postgres:postgres@db:5432/pagex"
              "REDIS_URL=redis://redis:6379/0"
              "PUBLIC_URL=http://localhost:3080"
              "BETTER_AUTH_URL=http://localhost:3080"
              "BETTER_AUTH_SECRET"
            ];
          };
        };
      }
    );
}