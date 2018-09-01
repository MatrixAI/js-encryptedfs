# JavaScript Demo

This is an example JavaScript project using Nix to setup a development environment.

This uses Nix and NPM. However similar to the Go situation, Node packages are not packaged in Nixpkgs. They still are pulled directly from NPM.

The JavaScript is written with Flow type checker. This means we are using Flow as a type checker, and Babel to transpile the JavaScript to several target platforms. Finally Rollup is used as teh build system to run Babel and bundle up the source code into consumable libraries. Thes final libraires are put into the `./dist` directory which is also what gets used when downstream projects depend on this project.

To enter into the development environment, enter `nix-shell`. This will give you `flow` and all of the development dependencies in the `PATH` environment. See the `shellHook` attribute in the `./shell.nix`.

The Flow type checker has its own language. To run the Flow type checker, we just need to run `flow`, which will start the type checker server. We embedded this already as an asynchronous shell job in the `shellHook`. Just remember that before you exit the `nix-shell`, you need to also kill your Flow server by using `kill %1`.

These are the sorts of commands you will be using:

```sh
# enter into the nix-shell
nix-shell
# check the types
flow
# run the tests via the ava unit testter
npm test
# to run the rollup bundler to produce the target dist (do this before each release)
npm run rollup
# run the flow type checker, tests and rollup
npm run build
```

To manage JavaScript dependencies use `package.json`. If you need non-JavaScript dependencies, use the `./default.nix` and `./shell.nix`. Note that `./shell.nix` should contain development dependencies. This means JavaScript dependencies are not directly listed in the Nix expressions.
