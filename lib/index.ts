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
  setInterruptBuffer: any;
}
declare function loadPyodide(options: {indexURL: string}): Promise<Pyodide>;

export async function loadPyodideAndPackage(packageOptions: any) {
  const {format, extract_dir, url} = packageOptions;

  const indexURL = "https://cdn.jsdelivr.net/pyodide/v0.19.0/full/";
  importScripts(indexURL + "pyodide.js");

  const [pyodide, packageBuffer] = await Promise.all([
    loadPyodide({indexURL}),
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

function initPyodide(pyodide: Pyodide) {
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
    throw new Error(`Request for package failed with status ${response.status}: ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

export function toObject(x: any): any {
  if (x?.toJs) {
    x = x.toJs();
  }
  if (x instanceof Map) {
    return Object.fromEntries(
      Array.from(x.entries(), ([k, v]) => [k, toObject(v)]),
    );
  } else if (x instanceof Array) {
    return x.map(toObject);
  } else {
    return x;
  }
}

export function makeRunnerCallback(comsyncExtras: SyncExtras, callbacks: any) {
  return function (type: string, data: any) {
    data = toObject(data);
    if (type === "input") {
      callbacks.input(data.prompt);
      try {
        return comsyncExtras.readMessage() + "\n";
      } catch (e) {
        if (e.type === "InterruptError") {
          return 1; // raise KeyboardInterrupt
        } else if (e.type === "ServiceWorkerError") {
          return 2; // suggesting closing all tabs and reopening
        } else if (e.type === "NoChannelError") {
          return 3; // browser not supported
        }
        throw e;
      }
    } else if (type === "sleep") {
      try {
        comsyncExtras.syncSleep(data.seconds * 1000);
      } catch (e) {
        console.error(e);
      }
    } else {
      callbacks[type](data);
    }
  };
}

export function pyodideExpose(pyodidePromise: Promise<Pyodide>, func: any) {
  return syncExpose(async function (comsyncExtras, interruptBuffer, ...args) {
    const pyodide = await pyodidePromise;

    if (interruptBuffer) {
      pyodide.setInterruptBuffer(interruptBuffer);
    }

    return func(comsyncExtras, pyodide, ...args);
  });
}

export class PyodideClient<T> extends SyncClient<T> {
  async runTask(proxyMethod: any, ...args: any[]) {
    let interruptBuffer = null;
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
