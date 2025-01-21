{
  inputs = {
    nixpkgs-matrix = {
      type = "indirect";
      id = "nixpkgs-matrix";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs-matrix, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs-matrix.legacyPackages.${system};
        shell = { ci ? false }:
          with pkgs;
          pkgs.mkShell {
            nativeBuildInputs = [ nodejs_20 shellcheck gitAndTools.gh ];
            PKG_IGNORE_TAG = 1;
            shellHook = ''
              echo "Entering $(npm pkg get name)"
              set -o allexport
              . <(polykey secrets env js-timer)
              set +o allexport
              set -v
              ${lib.optionalString ci ''
                set -o errexit
                set -o nounset
                set -o pipefail
                shopt -s inherit_errexit
              ''}
              mkdir --parents "$(pwd)/tmp"

              export PATH="$(pwd)/dist/bin:$(npm root)/.bin:$PATH"

              npm install --ignore-scripts

              set +v
            '';
          };
      in {
        devShells = {
          default = shell { ci = false; };
          ci = shell { ci = true; };
        };
      });
}
