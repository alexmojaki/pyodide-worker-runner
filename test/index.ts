import {Channel, makeAtomicsChannel, makeServiceWorkerChannel, ServiceWorkerError, writeMessage} from "sync-message";
import {PyodideClient} from "../lib";
import * as Comlink from 'comlink';

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

  const client = new PyodideClient<any>(() => new Worker());
  const testResults: any[] = [];

  for (const channel of channels) {
    const channelType = channel.type;
    client.channel = channel;
    let resultPromise: Promise<any>;

    function runTask(...args: any[]) {
      resultPromise = client.runTask(client.workerProxy[test], ...args);
    }

    async function expect(expected: any) {
      const result = await resultPromise;
      const passed = result === result;
      testResults.push({
        test,
        result,
        expected,
        passed,
        channelType,
      });
    }

    const output: any[] = [];
    function outputCallback(data: any) {
      output.push(data);
    }

    let test = "test";
    runTask("print(123)", null, Comlink.proxy(outputCallback));
    await expect("success");
    console.log(output);  // TODO assert equal
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
