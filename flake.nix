{
  description = "Personal DeepSeek Harness plugins";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      lib = nixpkgs.lib;
    in
    {
      packages = forAllSystems (pkgs: {
        dsh-serial-agent = pkgs.callPackage ./serial-agent/nix/package.nix { };
        default = self.packages.${pkgs.stdenv.hostPlatform.system}.dsh-serial-agent;
      });

      overlays.default = final: prev: {
        dsh-serial-agent = final.callPackage ./serial-agent/nix/package.nix { };
      };

      nixosModules = {
        dsh-serial-agent = import ./serial-agent/nix/nixos-module.nix self;
        default = self.nixosModules.dsh-serial-agent;
      };

      darwinModules = {
        dsh-serial-agent = import ./serial-agent/nix/darwin-module.nix self;
        default = self.darwinModules.dsh-serial-agent;
      };

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.git
            pkgs.go
            pkgs.socat
          ];
        };
      });

      checks = forAllSystems (
        pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
        in
        {
          dsh-serial-agent = self.packages.${system}.dsh-serial-agent;
        }
        // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          nixos-module =
            let
              evaluated = nixpkgs.lib.nixosSystem {
                inherit system;
                modules = [
                  self.nixosModules.dsh-serial-agent
                  {
                    services.dsh-serial-agent.enable = true;
                    services.dsh-serial-agent.settings.server = "ws://127.0.0.1:8080/remote-serial/agent";
                    system.stateVersion = "25.05";
                  }
                ];
              };
              service = evaluated.config.systemd.services.dsh-serial-agent;
              bootModules = evaluated.config.boot.kernelModules;
              requiredModules = [
                "usbserial"
                "cdc_acm"
              ];
              missingModules = builtins.filter (m: !builtins.elem m bootModules) requiredModules;
              modulesLoadUnit = "systemd-modules-load.service";
            in
            assert lib.assertMsg (missingModules == [ ])
              "services.dsh-serial-agent: boot.kernelModules is missing ${builtins.toString missingModules}";
            assert lib.assertMsg (builtins.elem modulesLoadUnit service.after)
              "services.dsh-serial-agent: the unit is not ordered after ${modulesLoadUnit}";
            pkgs.writeText "dsh-serial-agent-nixos-module-check.json" (builtins.toJSON {
              execStart = service.serviceConfig.ExecStart;
              deviceAllow = service.serviceConfig.DeviceAllow;
              kernelModules = bootModules;
              after = service.after;
            });
        }
      );
    };
}
