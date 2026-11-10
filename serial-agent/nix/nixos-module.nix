self:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.dsh-serial-agent;
  settingsFormat = pkgs.formats.json { };
  configFile = settingsFormat.generate "dsh-serial-agent.json" cfg.settings;
in
{
  options.services.dsh-serial-agent = {
    enable = lib.mkEnableOption "dsh-serial-agent, which serves serial ports to the Harness";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.dsh-serial-agent;
      defaultText = lib.literalExpression "self.packages.\${pkgs.stdenv.hostPlatform.system}.dsh-serial-agent";
      description = "The dsh-serial-agent package. Defaults to the package of this flake.";
    };

    settings = lib.mkOption {
      type = lib.types.submodule {
        freeformType = settingsFormat.type;
        options = {
          server = lib.mkOption {
            type = lib.types.str;
            description = "WebSocket URL of the Harness serial gateway.";
          };
          allow = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [
              "/dev/ttyUSB*"
              "/dev/ttyACM*"
              "/dev/serial/by-id/*"
            ];
            description = "Device patterns the agent may open.";
          };
          bufferBytes = lib.mkOption {
            type = lib.types.ints.between 4096 (64 * 1024 * 1024);
            default = 1024 * 1024;
            description = "Bytes of output kept for each port.";
          };
          orphanTimeout = lib.mkOption {
            type = lib.types.str;
            default = "1h";
            description = "Time without a subscriber before a port closes. 0s means never.";
          };
          logLevel = lib.mkOption {
            type = lib.types.enum [
              "debug"
              "info"
              "warn"
              "error"
            ];
            default = "info";
            description = "Log level of the agent.";
          };
        };
      };
      default = { };
      description = "Settings written to the JSON config file of the agent.";
    };

    deviceAllow = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [
        "char-ttyUSB rw"
        "char-ttyACM rw"
      ];
      description = "DeviceAllow entries for the systemd service.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.dialout = { };

    systemd.services.dsh-serial-agent = {
      description = "dsh-serial-agent serial console gateway";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [ "network-online.target" ];
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/dsh-serial-agent run --config ${configFile}";
        DynamicUser = true;
        StateDirectory = "dsh-serial-agent";
        SupplementaryGroups = [ "dialout" ];
        Restart = "always";
        RestartSec = 5;
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
          "AF_NETLINK"
        ];
        DevicePolicy = "closed";
        DeviceAllow = cfg.deviceAllow;
      };
    };
  };
}
