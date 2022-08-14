import {
  asyncSleep,
  Channel,
  makeAtomicsChannel,
  makeServiceWorkerChannel,
  ServiceWorkerError,
  writeMessage,
} from "sync-message";
import {PyodideClient, RunnerCallbacks} from "../lib";
import * as Comlink from "comlink";

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
  let test = "";
  let channelType = "";
  let resultPromise: Promise<"success">;
  let output = "";
  let prompt: string | undefined;
  let expectedPrompt: string | undefined;

  function runCode(code: string, exPrompt?: string) {
    expectedPrompt = exPrompt;
    prompt = undefined;
    output = "";
    resultPromise = client.call(
      client.workerProxy.test,
      code,
      exPrompt ? Comlink.proxy(inputCallback) : null,
      Comlink.proxy(outputCallback),
    );
  }

  async function expect(expectedOutput: string) {
    const result = await resultPromise;
    await asyncSleep(250);
    const actual = {result, output, prompt};
    let expected: typeof actual = {
      output: expectedOutput,
      result: "success",
      prompt: expectedPrompt,
    };
    const passed =
      actual.result === expected.result &&
      actual.output === expected.output &&
      actual.prompt === expected.prompt;
    log(output);
    testResults.push({
      test,
      actual,
      expected,
      passed,
      channelType,
    });
  }

  const outputCallback: RunnerCallbacks["output"] = (parts) => {
    for (const part of parts) {
      output += `${part.type}:${part.text};`;
    }
  };

  const inputCallback: RunnerCallbacks["input"] = (p) => {
    prompt = p;
  };

  for (const channel of channels) {
    channelType = channel.type;
    client.channel = channel;

    test = "test_print";
    runCode("print(123)");
    await expect("stdout:123\n;");

    test = "test_input";
    runCode("print(int(input('hi')))", "hi");
    await asyncSleep(250);
    await client.writeMessage("456");
    await expect(`input_prompt:hi;input:456
;stdout:456;stdout:
;`);

    test = "test_interrupt_input";
    runCode(
      `
try:
  input('interrupt me')
except BaseException as e:
  print(type(e).__name__)
else:
  print('not!')
`,
      "interrupt me",
    );
    await asyncSleep(250);
    await client.interrupt();
    await expect(
      `input_prompt:interrupt me;stdout:KeyboardInterrupt
;`,
    );

    test = "test_sleep";
    runCode(
      `
import time
start = time.time()
time.sleep(1)
end = time.time()
if end - start >= 1:
  print(True)
else:
  print(start, end, end - start)
`,
    );
    await expect("stdout:True;stdout:\n;");

    test = "test_interrupt_sleep";
    runCode(
      `
import time
start = time.time()
try:
  time.sleep(4)
except BaseException as e:
  print(type(e).__name__)
else:
  print('not!')
end = time.time()
if end - start <= 2:
  print(True)
else:
  print(start, end, end - start)
`,
    );
    await asyncSleep(250);
    await client.interrupt();
    await expect(
      `stdout:KeyboardInterrupt
True
;`,
    );

    test = "test_other_callback";
    runCode(
      `
print(runner.callback("foo", bar="spam"))
`,
    );
    await expect(
      `stdout:foo-{"bar":"spam"}
;`,
    );
  }

  test = "test_no_channel";
  client.channel = null;
  runCode(
    `
try:
  input('no channel')
except BaseException as e:
  print(e)
else:
  print('not!')
`,
  );
  await expect(
    "input_prompt:no channel;" +
      "stdout:This browser doesn't support reading input. " +
      "Try upgrading to the most recent version or switching to a different browser, " +
      "e.g. Chrome or Firefox.\n;",
  );

  test = "test_service_worker_error";
  client.channel = {...serviceWorkerChannel, baseUrl: window.location.href};
  runCode(
    `
try:
  input('no service worker')
except BaseException as e:
  print(e)
else:
  print('not!')
`,
  );
  await expect(
    "input_prompt:no service worker;" +
      "stdout:The service worker for reading input isn't working. " +
      "Try closing all this site's tabs, then reopening. " +
      "If that doesn't work, try using a different browser.;" +
      "stdout:\n;",
  );

  if (hasSAB) {
    test = "test_interrupt";
    runCode(
      `
try:
  while True:
    pass
except BaseException as e:
  print(type(e).__name__)
else:
  print('not!')
`,
    );
    await asyncSleep(250);
    await client.interrupt();
    await expect("stdout:KeyboardInterrupt\n;");
  }

  (window as any).testResults = testResults;
  console.log(testResults);
  log(JSON.stringify(testResults));

  let numPassed = testResults.filter((t) => t.passed).length;
  let numTotal = testResults.length;
  let finalResult = numPassed === numTotal ? "PASSED" : "FAILED";
  body.innerHTML = `<h1 id=result>${numPassed} / ${numTotal} : ${finalResult}!</h1>` + body.innerHTML;
}

const body = document.getElementsByTagName("body")[0];
function log(text: string) {
  console.log(text);
  const elem = document.createElement("pre");
  elem.textContent = text;
  body.appendChild(elem);
}

runTests().catch(log);
