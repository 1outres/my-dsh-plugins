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

    logFile = lib.mkOption {
      type = lib.types.str;
      default = "/tmp/dsh-serial-agent.log";
      description = "File that receives the standard output and error of the agent.";
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
              "/dev/cu.usbserial*"
              "/dev/cu.usbmodem*"
              "/dev/cu.SLAB_USBtoUART*"
              "/dev/cu.wchusbserial*"
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
  };

  config = lib.mkIf cfg.enable {
    launchd.user.agents.dsh-serial-agent = {
      serviceConfig = {
        ProgramArguments = [
          "${cfg.package}/bin/dsh-serial-agent"
          "run"
          "--config"
          (toString configFile)
        ];
        RunAtLoad = true;
        KeepAlive = true;
        StandardOutPath = cfg.logFile;
        StandardErrorPath = cfg.logFile;
        ProcessType = "Background";
      };
    };
  };
}
