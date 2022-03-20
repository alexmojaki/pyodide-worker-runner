import pRetry from "p-retry";
import {syncExpose, SyncExtras, SyncClient} from "comsync";
import * as Comlink from "comlink";

const pyodide_worker_runner_contents = require("!!raw-loader!./pyodide_worker_runner.py")
  .default;

declare interface Pyodide {
  unpackArchive: (
    buffer: ArrayBuffer,
    format: string,
    extract_dir?: string,
  ) => void;
  pyimport: (name: string) => any;
  registerComlink: any;
  setInterruptBuffer: (buffer: Int32Array) => void;
}
declare function loadPyodide(options: {indexURL: string}): Promise<Pyodide>;

export type PyodideLoader = () => Promise<Pyodide>;
export interface PackageOptions {
  format: string;
  url: string;
  extract_dir?: string;
}

function defaultPyodideLoader() {
  const indexURL = "https://cdn.jsdelivr.net/pyodide/v0.19.0/full/";
  importScripts(indexURL + "pyodide.js");
  return loadPyodide({indexURL});
}

export async function loadPyodideAndPackage(
  packageOptions: PackageOptions,
  pyodideLoader: PyodideLoader = defaultPyodideLoader,
) {
  const {format, extract_dir, url} = packageOptions;

  let pyodide: Pyodide;
  let packageBuffer: ArrayBuffer;
  [pyodide, packageBuffer] = await Promise.all([
    pyodideLoader(),
    pRetry(() => getPackageBuffer(url), {retries: 3}),
  ]);

  pyodide.unpackArchive(packageBuffer, format, extract_dir);
  const sys = pyodide.pyimport("sys");

  if (extract_dir) {
    sys.path.append(extract_dir);
  }

  initPyodide(pyodide);

  return pyodide;
}

export function initPyodide(pyodide: Pyodide) {
  pyodide.registerComlink(Comlink);

  const sys = pyodide.pyimport("sys");
  const pathlib = pyodide.pyimport("pathlib");

  const dirPath = "/tmp/pyodide_worker_runner/";
  sys.path.append(dirPath);
  pathlib.Path(dirPath).mkdir();
  pathlib
    .Path(dirPath + "pyodide_worker_runner.py")
    .write_text(pyodide_worker_runner_contents);
  pyodide.pyimport("pyodide_worker_runner");
}

async function getPackageBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Request for package failed with status ${response.status}: ${response.statusText}`,
    );
  }
  return await response.arrayBuffer();
}

export interface OutputPart {
  type: string;
  text: string;
  [key: string]: unknown;
}

export interface RunnerCallbacks {
  input?: (prompt: string) => string;
  output: (parts: OutputPart[]) => unknown;
  [key: string]: (data: unknown) => unknown;
}

export function makeRunnerCallback(
  comsyncExtras: SyncExtras,
  callbacks: RunnerCallbacks,
) {
  return function (type: string, data: any) {
    if (data.toJs) {
      data = data.toJs({dict_converter: Object.fromEntries});
    }

    if (type === "input") {
      callbacks.input && callbacks.input(data.prompt);
      return comsyncExtras.readMessage() + "\n";
    } else if (type === "sleep") {
      comsyncExtras.syncSleep(data.seconds * 1000);
    } else if (type === "output") {
      return callbacks.output(data.parts);
    } else {
      return callbacks[type](data);
    }
  };
}

export function pyodideExpose<T extends any[], R>(
  pyodidePromise: Promise<Pyodide>,
  func: (extras: SyncExtras, pyodide: Pyodide, ...args: T) => R,
) {
  return syncExpose(async function (
    comsyncExtras: SyncExtras,
    interruptBuffer: Int32Array | null,
    ...args: T
  ): Promise<R> {
    const pyodide = await pyodidePromise;

    if (interruptBuffer) {
      pyodide.setInterruptBuffer(interruptBuffer);
    }

    return func(comsyncExtras, pyodide, ...args);
  });
}

export class PyodideClient<T> extends SyncClient<T> {
  async call(proxyMethod: any, ...args: any[]) {
    let interruptBuffer: Int32Array | null = null;
    if (typeof SharedArrayBuffer !== "undefined") {
      interruptBuffer = new Int32Array(
        new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 1),
      );
      this.interrupter = () => {
        interruptBuffer[0] = 2;
      };
    }

    return super.call(proxyMethod, interruptBuffer, ...args);
  }
}
