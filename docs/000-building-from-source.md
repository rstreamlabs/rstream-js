# Build the JavaScript SDKs from source

Use Git, Node.js 24, the npm version declared in the root package manifest,
and a shell with Bash and standard Unix utilities. The source build runs on
Linux and macOS. On Windows, use a Linux environment such as WSL for
these build commands. The workspace builds packages and the browser demo.

```sh
git clone https://github.com/rstreamlabs/rstream-js.git
cd rstream-js
npm ci
```

To build every package and the browser demo, run the full workspace build.

```sh
npm run build
```

Each SDK's JavaScript and type declarations are written to its `dist/` directory.
For the Node runtime and its package dependencies alone, use this build instead.

```sh
npm run build -- --filter='@rstreamlabs/runtime...'
```

Use the checkout's [HTTP and WebSocket programs](runtime/000-http-and-websocket.md#run-the-checkout-programs)
to run that build. If you are adding one package to an application, use
the [package selector](../README.md#choose-a-package) and install its published version.

[Contributing](../CONTRIBUTING.md) lists type, lint, package and browser
checks. Those checks use local fixtures. A tunnel requires an authorized
rstream project or direct Engine when the application actually runs.
