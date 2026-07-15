// Hidden-input prompts (passphrase / PIN). On a TTY, raw mode gives no per-char echo. On piped stdin
// (tests, scripts) there is no echo anyway — but EOF arrives with the input, so a naive second line
// read races the close; we read all of stdin once, cache the lines, and hand them out one per prompt.

let pipedLines: string[] | undefined;

function readPipedLine(): Promise<string> {
  if (pipedLines !== undefined) {
    return Promise.resolve((pipedLines.shift() ?? "").replace(/\r$/, ""));
  }
  return new Promise((resolve) => {
    let data = "";
    const stdin = process.stdin;
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      data += chunk;
    };
    const onEnd = () => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      pipedLines = data.split("\n");
      resolve((pipedLines.shift() ?? "").replace(/\r$/, ""));
    };
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.resume();
  });
}

/** Prompt for a secret (passphrase / PIN) with echo disabled. */
export async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (stdin.isTTY === true) {
    stdin.setRawMode?.(true);
    stdin.resume();
    return await new Promise<string>((resolve, reject) => {
      let value = "";
      const onData = (data: Buffer): void => {
        for (const byte of data) {
          if (byte === 0x0d || byte === 0x0a) {
            stdin.removeListener("data", onData);
            stdin.setRawMode?.(false);
            stdin.pause();
            process.stdout.write("\n");
            resolve(value);
            return;
          }
          if (byte === 0x03) {
            stdin.removeListener("data", onData);
            stdin.setRawMode?.(false);
            stdin.pause();
            reject(new Error("interrupted"));
            return;
          }
          if (byte === 0x7f || byte === 0x08) {
            value = value.slice(0, -1);
            continue;
          }
          if (byte >= 0x20) {
            value += String.fromCharCode(byte);
          }
        }
      };
      stdin.on("data", onData);
    });
  }
  return (await readPipedLine()).trim();
}

/** Prompt for a secret twice and require the two entries to match. */
export async function promptHiddenConfirmed(question: string, again: string): Promise<string> {
  const first = await promptHidden(question);
  const second = await promptHidden(again);
  if (first !== second) {
    throw new Error("Entries did not match.");
  }
  return first;
}
