{
  pkgs ? import ./pkgs.nix,
  nodeVersion ? "8_x",
}:
  with pkgs;
  let
    drv = import ./default.nix { inherit pkgs nodeVersion; };
  in
    drv.overrideAttrs (attrs: {
      src = null;
      buildInputs = [ dos2unix flow nodePackages_6_x.node2nix ] ++ attrs.buildInputs;
      shellHook = ''
        echo 'Entering ${attrs.name}'
        set -v

        export PATH="$(pwd)/dist/bin:$(npm bin):$PATH"

        flow server 2>/dev/null &

        set +v
      '';
    })
