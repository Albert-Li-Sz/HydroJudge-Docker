let
  # Pin the source revision rather than following a changing Nix channel.
  nixpkgs = builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/1f607aa79b6356ed45d3cd3c8079c196e79efa2c.tar.gz";
  };
  pkgs = import nixpkgs { system = "x86_64-linux"; };
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
    unzip
    zip
    cacert
    tini
    identity
  ];
  pathsToLink = [ "/bin" "/lib" "/include" "/share" "/etc" ];
  ignoreCollisions = true;
}
