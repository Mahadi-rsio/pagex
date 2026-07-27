{ description = "PageX - Multi-tenant static site hosting platform";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    
    # Service flakes
    api.url = "./services/api";
    blob-server.url = "./services/blob-server";
    console.url = "./services/console";
  };

  outputs = { self, nixpkgs, flake-utils, api, blob-server, console, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        # Development shells
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            pnpm
            go
            caddy
            docker
            postgresql
            redis
            openssl
            git
            curl
            jq
          ];

          shellHook = ''
            echo "🚀 PageX Development Environment"
            echo "================================"
            echo "Available services:"
            echo "  - api: Main Express backend"
            echo "  - blob-server: Caddy + static_s3 plugin"
            echo "  - console: Next.js web console"
            echo ""
            echo "Commands:"
            echo "  nix develop -c <service>  # Enter service-specific shell"
            echo "  nix build                 # Build all services"
            echo "  nix run .#api             # Run API service"
            echo ""
            echo "Service directories:"
            echo "  services/api/"
            echo "  services/blob-server/"
            echo "  services/console/"
          '';
        };

        # Service-specific development shells
        devShells.api = api.outputs.${system}.devShells.default;
        devShells.blob-server = blob-server.outputs.${system}.devShells.default;
        devShells.console = console.outputs.${system}.devShells.default;

        # Packages
        packages.api = api.outputs.${system}.packages.default;
        packages.blob-server = blob-server.outputs.${system}.packages.default;
        packages.console = console.outputs.${system}.packages.default;

        # Full system build
        packages.default = pkgs.mkDerivation {
          name = "pagex";
          buildInputs = [
            self.packages.${system}.api
            self.packages.${system}.blob-server
            self.packages.${system}.console
          ];
          installPhase = ''
            mkdir -p $out/bin
            cp ${self.packages.${system}.api}/bin/* $out/bin/ || true
            cp ${self.packages.${system}.blob-server}/bin/* $out/bin/ || true
            cp ${self.packages.${system}.console}/bin/* $out/bin/ || true
          '';
        };

        # Apps for direct execution
        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/pagex";
        };
      }
    );
}