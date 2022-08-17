/* eslint-disable */
// Otherwise webpack fails silently
// https://github.com/facebook/create-react-app/issues/8014

import {
  loadPyodideAndPackage,
  makeRunnerCallback,
  pyodideExpose,
  RunnerCallbacks,
} from "../lib";
import * as Comlink from "comlink";

const packageUrl = require("url-loader!./package.tar").default;
const pyodidePromise = loadPyodideAndPackage({url: packageUrl, format: "tar"});
Comlink.expose({
  test: pyodideExpose(
    async (
      extras,
      code: string,
      inputCallback: RunnerCallbacks["input"],
      outputCallback: RunnerCallbacks["output"],
    ) => {
      const callback = makeRunnerCallback(extras, {
        input: inputCallback,
        output: outputCallback,
        other: (type, data) => type + "-" + JSON.stringify(data),
      });
      const pyodide = await pyodidePromise;
      const runner = pyodide.pyimport("python_runner").PyodideRunner();
      runner.set_callback(callback);
      pyodide.pyimport("builtins").runner = runner;
      await pyodide
        .pyimport("pyodide_worker_runner")
        .install_imports(code, (typ: string, data: any) =>
          outputCallback([{type: typ, text: JSON.stringify(data.toJs({dict_converter: Object.fromEntries}))}]),
        );
      if (extras.interruptBuffer) {
        pyodide.setInterruptBuffer(extras.interruptBuffer);
      }
      runner.run(code);
      return "success";
    },
  ),
});
