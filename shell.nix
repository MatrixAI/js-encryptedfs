{ pkgs ? import ./pkgs.nix {} }:

with pkgs;
pkgs.mkShell {
  nativeBuildInputs = [
    nodejs
    nodePackages.node2nix
  ];
  shellHook = ''
    echo 'Entering js-encryptedfs'
    set -o allexport
    . ./.env
    set +o allexport
    set -v

    mkdir --parents "$(pwd)/tmp"

    # Built executables and NPM executables
    export PATH="$(pwd)/dist/bin:$(npm bin):$PATH"

    # Enables npm link
    export npm_config_prefix=~/.npm

    npm install

    set +v
  '';
}
