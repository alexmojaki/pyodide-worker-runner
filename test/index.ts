import {
  asyncSleep,
  Channel,
  makeAtomicsChannel,
  makeServiceWorkerChannel,
  ServiceWorkerError,
  writeMessage,
} from "sync-message";
import {PyodideClient} from "../lib";
import * as Comlink from "comlink";
import {isEqual} from "lodash";

const Worker = require("worker-loader!./worker").default;

async function runTests() {
  await navigator.serviceWorker.register("./sw.js");
  const serviceWorkerChannel = makeServiceWorkerChannel({timeout: 1000});
  try {
    await writeMessage(serviceWorkerChannel, "test", "foo");
  } catch (e) {
    if (e instanceof ServiceWorkerError) {
      window.location.reload();
    } else {
      throw e;
    }
  }

  const channels: Channel[] = [serviceWorkerChannel];
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  if (hasSAB) {
    channels.push(makeAtomicsChannel());
  }

  const client = new PyodideClient(() => new Worker());
  const testResults: any[] = [];

  for (const channel of channels) {
    const channelType = channel.type;
    client.channel = channel;
    let resultPromise: Promise<any>;
    let output = "";
    let prompt = "";

    function runTask(...args: any[]) {
      prompt = "none";
      output = "";
      resultPromise = client.runTask(client.workerProxy.test, ...args);
    }

    async function expect(expected: any) {
      const result = await resultPromise;
      const actual = {result, output, prompt};
      const passed = isEqual(actual, expected);
      testResults.push({
        test,
        actual,
        expected,
        passed,
        channelType,
      });
    }

    function outputCallback(parts: any[]) {
      for (const part of parts) {
        output += `${part.type}:${part.text};`
      }
    }

    function inputCallback(p: string) {
      prompt = p;
    }

    let test = "test_print";
    runTask(
      "print(123)",
      Comlink.proxy(inputCallback),
      Comlink.proxy(outputCallback),
    );

    await expect({
      result: "success",
      prompt: "none",
      output: "stdout:123\n;",
    });

    test = "test_input";
    runTask(
      "print(int(input('hi')))",
      Comlink.proxy(inputCallback),
      Comlink.proxy(outputCallback),
    );
    await asyncSleep(100);
    await client.writeMessage("456");
    await expect({
      result: "success",
      prompt: "hi",
      output: "input_prompt:hi;" +
        "input:456\n;" +
        "stdout:456;" +
        "stdout:\n;",
    });

    test = "test_interrupt_input";
    runTask(
`
try:
  input('interrupt me')
except BaseException as e:
  print(type(e).__name__)
else:
  print('not!')
`,
      Comlink.proxy(inputCallback),
      Comlink.proxy(outputCallback),
    );
    await asyncSleep(100);
    await client.interrupt();
    await expect({
      result: "success",
      prompt: "interrupt me",
      output: "input_prompt:interrupt me;" +
        "stdout:KeyboardInterrupt\n;",
    });
  }

  (window as any).testResults = testResults;
  console.log(testResults);

  let numPassed = testResults.filter((t) => t.passed).length;
  let numTotal = testResults.length;
  let finalResult = numPassed === numTotal ? "PASSED" : "FAILED";
  const body = document.getElementsByTagName("body")[0];
  body.innerHTML = `<div id=result>${numPassed} / ${numTotal} : ${finalResult}!</div>`;
}

runTests();
