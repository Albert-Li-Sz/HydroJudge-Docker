let
  # Pin the source revision rather than following a changing Nix channel.
  nixpkgs = builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/1f607aa79b6356ed45d3cd3c8079c196e79efa2c.tar.gz";
  };
  pkgs = import nixpkgs { system = "x86_64-linux"; };
  # JDK 21 creates JARs through a temporary file. Keep it on the working
  # filesystem so the final move does not need a cross-mount fast-copy syscall
  # rejected by the upstream sandbox filter. Contestant java options are intact.
  jarLauncher = pkgs.writeShellScriptBin "jar" ''
    exec ${pkgs.jdk21_headless}/bin/jar "-J-Djava.io.tmpdir=$(pwd -P)" "$@"
  '';
  identity = pkgs.runCommand "hydrojudge-identity" { } ''
    mkdir -p "$out/etc" "$out/include" "$out/lib" "$out/share"
    touch "$out/include/.keep" "$out/lib/.keep" "$out/share/.keep"
    printf '%s\n' \
      'root:x:0:0:root:/root:/bin/bash' \
      'judge:x:1536:1536:judge:/w:/bin/bash' > "$out/etc/passwd"
    printf '%s\n' 'root:x:0:' 'judge:x:1536:' > "$out/etc/group"
  '';
in
pkgs.buildEnv {
  name = "hydrojudge-rootfs";
  paths = with pkgs; [
    bashInteractive
    coreutils
    diffutils
    findutils
    gawk
    gcc
    gnugrep
    gnused
    patch
    python3
    pypy3
    jdk21_headless
    (lib.hiPrio jarLauncher)
    unzip
    zip
    cacert
    tini
    identity
  ];
  pathsToLink = [ "/bin" "/lib" "/include" "/share" "/etc" ];
  ignoreCollisions = true;
}
