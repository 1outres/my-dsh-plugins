{
  lib,
  buildGoModule,
  version ? "0.1.0",
}:

buildGoModule {
  pname = "dsh-serial-agent";
  inherit version;

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../go.mod
      ../go.sum
      ../cmd
      ../internal
    ];
  };

  vendorHash = "sha256-cC976Gr6JN7YVHu7P4+A3RF3d4WP2PsmGMTg8e9Oh5k=";

  subPackages = [ "cmd/dsh-serial-agent" ];

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X"
    "main.version=${version}"
  ];

  doCheck = true;

  checkPhase = ''
    runHook preCheck
    go test ./...
    runHook postCheck
  '';

  meta = {
    description = "Serial console agent for the DeepSeek Harness remote plugin";
    homepage = "https://github.com/1outres/my-dsh-plugins";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
    mainProgram = "dsh-serial-agent";
  };
}
