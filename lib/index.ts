import pRetry from "p-retry";
import {SyncClient, syncExpose, SyncExtras} from "comsync";
import * as Comlink from "comlink";
import {loadPyodide, PyodideInterface} from "pyodide";

const pyodide_worker_runner_contents = require("!!raw-loader!./pyodide_worker_runner.py")
  .default;

export type PyodideLoader = () => Promise<PyodideInterface>;
export interface PackageOptions {
  format: string;
  url: string;
  extractDir?: string;
}

export async function defaultPyodideLoader(version: string = "0.21.2") {
  const indexURL = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
  const result = await loadPyodide({indexURL});
  if (result.version !== version) {
    throw new Error(
      `loadPyodide loaded version ${result.version} instead of ${version}`,
    );
  }
  return result;
}

export function versionInfo(version: string) {
  return version.split(".").map(Number);
}

export async function loadPyodideAndPackage(
  packageOptions: PackageOptions,
  pyodideLoader: PyodideLoader = defaultPyodideLoader,
) {
  let {format, extractDir, url} = packageOptions;
  extractDir = extractDir || "/tmp/";

  let pyodide: PyodideInterface;
  let packageBuffer: ArrayBuffer;
  [pyodide, packageBuffer] = await Promise.all([
    pRetry(pyodideLoader, {retries: 3}),
    pRetry(() => getPackageBuffer(url), {retries: 3}),
  ]);

  const vInfo = versionInfo(pyodide.version);
  pyodide.unpackArchive(
    packageBuffer,
    format,
    vInfo[0] === 0 && vInfo[1] <= 19 ? (extractDir as any) : {extractDir},
  );

  const sys = pyodide.pyimport("sys");
  sys.path.append(extractDir);

  initPyodide(pyodide);

  return pyodide;
}

export function initPyodide(pyodide: PyodideInterface) {
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

const packageCache = new Map<string, ArrayBuffer>();

async function getPackageBuffer(url: string) {
  if (packageCache.has(url)) {
    console.log("Loaded package from cache");
    return packageCache.get(url);
  }
  console.log("Fetching package from " + url.slice(0, 100) + "...");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Request for package failed with status ${response.status}: ${response.statusText}`,
    );
  }
  const result = await response.arrayBuffer();
  console.log("Fetched package");
  packageCache.set(url, result);
  return result;
}

export interface OutputPart {
  type: string;
  text: string;
  [key: string]: unknown;
}

export interface RunnerCallbacks {
  input?: (prompt: string) => void;
  output: (parts: OutputPart[]) => unknown;
  other?: (type: string, data: unknown) => unknown;
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
      return callbacks.other(type, data);
    }
  };
}

export interface PyodideExtras extends SyncExtras {
  interruptBuffer: Int32Array | null;
}

export function pyodideExpose<T extends any[], R>(
  func: (extras: PyodideExtras, ...args: T) => R,
) {
  return syncExpose(async function (
    comsyncExtras: SyncExtras,
    interruptBuffer: Int32Array | null,
    ...args: T
  ): Promise<R> {
    return func({...comsyncExtras, interruptBuffer}, ...args);
  });
}

export class PyodideClient<T = any> extends SyncClient<T> {
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

export class PyodideFatalErrorReloader {
  private pyodidePromise: Promise<PyodideInterface>;

  constructor(private readonly loader: PyodideLoader) {
    this.pyodidePromise = loader();
  }

  public async withPyodide<T>(
    fn: (pyodide: PyodideInterface) => Promise<T>,
  ): Promise<T> {
    const pyodide = await this.pyodidePromise;
    try {
      return await fn(pyodide);
    } catch (e) {
      if (e.pyodide_fatal_error) {
        this.pyodidePromise = this.loader();
      }
      throw e;
    }
  }
}
