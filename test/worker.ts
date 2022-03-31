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
const pyodide = loadPyodideAndPackage({url: packageUrl, format: "tar"});
Comlink.expose({
  test: pyodideExpose(
    pyodide,
    async (
      extras,
      code: string,
      inputCallback: RunnerCallbacks["input"],
      outputCallback: RunnerCallbacks["output"],
    ) => {
      const callback = makeRunnerCallback(extras, {
        input: inputCallback,
        output: outputCallback,
      });
      const runner = (await pyodide).pyimport("python_runner").PyodideRunner();
      runner.set_callback(callback);
      runner.run(code);
      return "success";
    },
  ),
});
