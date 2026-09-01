import { execFileSync } from "node:child_process";

const output = execFileSync("git", ["ls-files", "--eol", "-z"], { encoding: "utf8" });
const violations = [];
let checked = 0;

for (const record of output.split("\0")) {
  if (record.length === 0) {
    continue;
  }
  const separator = record.indexOf("\t");
  if (separator < 0) {
    throw new Error(`Unexpected git ls-files --eol record: ${JSON.stringify(record)}`);
  }
  const metadata = record.slice(0, separator).trim().split(/\s+/);
  const path = record.slice(separator + 1);
  const [indexEol, worktreeEol] = metadata;
  const expectedEol = metadata.find((field) => field.startsWith("eol="))?.slice("eol=".length);
  if (expectedEol !== "lf" && expectedEol !== "crlf") {
    continue;
  }
  checked += 1;
  if (indexEol !== "i/lf" && indexEol !== "i/none") {
    violations.push(`${path}: ${indexEol}; the Git index must normalize text to LF`);
  }
  if (worktreeEol !== `w/${expectedEol}` && worktreeEol !== "w/none") {
    violations.push(`${path}: ${worktreeEol}; .gitattributes requires w/${expectedEol}`);
  }
}

if (violations.length > 0) {
  console.error("Tracked text files violate the repository line-ending policy:");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`Verified line endings for ${checked} tracked text files.`);
