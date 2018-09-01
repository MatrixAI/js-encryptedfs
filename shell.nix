{
  pkgs ? import ./pkgs.nix,
  nodePath ? "nodejs-8_x"
}:
  with pkgs;
  let
    drv = import ./default.nix { inherit pkgs nodePath; };
  in
    drv.overrideAttrs (attrs: {
      src = null;
      buildInputs = [ dos2unix flow ] ++ attrs.buildInputs;
      shellHook = ''
        echo 'Entering ${attrs.name}'
        set -v

        export PATH="$(npm bin):$PATH"

        flow server 2>/dev/null &

        set +v
      '';
    })
