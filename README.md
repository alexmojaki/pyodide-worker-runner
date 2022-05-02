# pyodide-worker-runner

[![GitHub license](https://img.shields.io/github/license/alexmojaki/pyodide-worker-runner?style=flat)](https://github.com/alexmojaki/pyodide-worker-runner/blob/master/LICENSE) [![Tests](https://github.com/alexmojaki/pyodide-worker-runner/workflows/CI/badge.svg)](https://github.com/alexmojaki/pyodide-worker-runner/actions)

[![NPM](https://nodei.co/npm/pyodide-worker-runner.png)](https://npmjs.org/package/pyodide-worker-runner)

Helpers for running Python code in a web worker with [Pyodide](https://pyodide.org/en/stable/).

## Loading Pyodide and your own Python code

The function `loadPyodideAndPackage` loads Pyodide in parallel to downloading an archive with your own code and dependencies, which it then unpacks into the virtual filesystem ready for you to import. This helps you to work with Python code normally with several `.py` files instead of a giant string passed to Pyodide's `runPython`. It also lets you start up more quickly instead of waiting for Pyodide to load before calling `loadPackage` or `micropip.install`.

There are two arguments:

1. Options for loading the package, an object with the following keys:
  - `url` (required): a string passed to `fetch` to download the archive file.
  - `format` (required) and `extract_dir` (optional): strings passed to [`pyodide.unpackArchive`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.unpackArchive).
2. An optional function which takes no arguments and returns the Pyodide module as returned by the [`loadPyodide`](https://pyodide.org/en/stable/usage/api/js-api.html#globalThis.loadPyodide) function. By default it uses the [official CDN](https://pyodide.org/en/stable/usage/quickstart.html#setup).

The archive should contain your own Python files and any Python dependencies. A simple way to gather Python dependencies into a folder is with `pip install -t <folder>`. The location where the archive is extracted will be added to `sys.path` so it can be imported immediately, e.g. with [`pyodide.pyimport`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.pyimport). There should be no top-level folder in the archive containing everything else, or that's what you'll have to import.

If you don't use `loadPyodideAndPackage` and just load Pyodide yourself, then we recommend passing the resulting module object to `initPyodide` for some other housekeeping.

## `comsync` integration

This library builds on [`comsync`](https://github.com/alexmojaki/comsync) to help with interrupting running code and synchronously sleeping and reading from stdin.

In the main thread, construct a `PyodideClient` instead of a `comsync.SyncClient`. If `SharedArrayBuffer` is available (see the guide to [enabling cross-origin isolation](https://web.dev/cross-origin-isolation-guide/#enable-cross-origin-isolation)) then it will create a buffer which can ultimately be passed to [`pyodide.setInterruptBuffer`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.setInterruptBuffer) in the worker, and set an `interrupter` function on the client. Then calling `PyodideClient.interrupt()` (see the `comsync` documentation) may use that which will raise a `KeyboardInterrupt` in Python.

In the worker, call `pyodideExpose(func)` where `func` is a function which will be passed to `comsync.syncExpose`. The first argument passed to this function will be a `SyncExtras` object with one extra property `interruptBuffer` which can be passed to [`pyodide.setInterruptBuffer`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.setInterruptBuffer). The other arguments will be the arguments passed to `PyodideClient.call`. Here's what this may look like in the worker:

```js
import {pyodideExpose} from "pyodide-worker-runner";
import * as Comlink from "comlink";

Comlink.expose({
  runCode: pyodideExpose((extras, code) => {
      if (extras.interruptBuffer) {  // i.e. if SharedArrayBuffer is available so this could be sent by the client
        pyodide.setInterruptBuffer(extras.interruptBuffer);
      }
      pyodide.runCode(code);
    },
  ),
});
```

## `python_runner` integration

The `comsync` integration is best used in combination with the `python_runner` Python library so that you don't have to call the methods on `SyncExtras` yourself.

1. Make sure `python_runner` is installed within Pyodide, ideally in advance by including it in the archive loaded by `loadPyodideAndPackage`.
2. Use the `python_runner.PyodideRunner` class, which has patches for `builtins.input`, `sys.stdin.readline`, and `time.sleep` specifically for use with this library and `comsync`. This will handle blocking synchronously, reading input, and raising `KeyboardInterrupt` when interrupted from the main thread without relying on `pyodide.setInterruptBuffer`.
3. Call the `makeRunnerCallback(syncExtras, callbacks)` function from this library. `callbacks` should be an object with a key for every event `type` produced by the runner, except `sleep` which is fully handled. The values of the object should be callback functions. In particular:
  - The `output` callback will receive an array of output parts
  - The `input` callback will receive a string containing the input prompt, and should return a string without any newlines.
  - Other callbacks (for custom event types) will receive the full `data` object passed to the main callback.
4. `makeRunnerCallback` returns a single callback function which can be passed to `runner.set_callback`.

## Automatically install imported packages with micropip

Pyodide provides [`loadPackagesFromImports`](https://pyodide.org/en/stable/usage/api/js-api.html#pyodide.loadPackagesFromImports) to automatically call `loadPackage` for any imported libraries detected in the given Python code. However this only applies to packages specifically supported by `pyodide.loadPackage`. You can use the similar function `install_imports` to try to install arbitrary packages from PyPI with [`micropip.install`](https://pyodide.org/en/stable/usage/api/micropip-api.html), although the usual caveats still apply. You can import it from the `pyodide_worker_runner` Python module which is automatically installed by `loadPyodideAndPackage` or `initPyodide`. To use it from JS:

```js
await pyodide.pyimport("pyodide_worker_runner").install_imports(python_source_code_string);
```
