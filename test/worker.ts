/* eslint-disable */
// Otherwise webpack fails silently
// https://github.com/facebook/create-react-app/issues/8014

import {
  loadPyodideAndPackage,
  makeRunnerCallback,
  pyodideExpose,
  RunnerCallbacks,
  defaultPyodideLoader,
} from "../lib";
import * as Comlink from "comlink";
import {PyodideInterface} from "pyodide";

const packageUrl = require("url-loader!./package.tar").default;

let attempt = 0;

async function loader(): Promise<PyodideInterface> {
  console.log("pyodide load attempt " + attempt);
  if (attempt < 2) {
    attempt++;
    return await defaultPyodideLoader("badversion");
  } else {
    return await defaultPyodideLoader();
  }
}

const pyodidePromise = loadPyodideAndPackage({url: packageUrl, format: "tar"}, loader);
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
          outputCallback([
            {
              type: typ,
              text: JSON.stringify(
                data.toJs({dict_converter: Object.fromEntries}),
              ),
            },
          ]),
        );
      if (extras.interruptBuffer) {
        pyodide.setInterruptBuffer(extras.interruptBuffer);
      }
      runner.run(code);
      return "success";
    },
  ),
});
