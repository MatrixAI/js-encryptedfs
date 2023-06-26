import (
  let rev = "f294325aed382b66c7a188482101b0f336d1d7db"; in
  builtins.fetchTarball "https://github.com/NixOS/nixpkgs/archive/${rev}.tar.gz"
)
# import (
#   let rev = "ce6aa13369b667ac2542593170993504932eb836"; in
#   builtins.fetchTarball "https://github.com/NixOS/nixpkgs/archive/${rev}.tar.gz"
# )
