import { runDaemon } from "@lode/daemon";

try {
  await runDaemon(process.argv.slice(2));
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
