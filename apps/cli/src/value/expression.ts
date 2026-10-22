import { CliError } from "../outcome/index.js";

/**
 * The CLI-owned Search / View Filter expression language: parse, render, and
 * identity-planning. Membership evaluation stays in the Engine; this module
 * only compiles user text into identity-bearing expression trees, reusing
 * stable identities for unchanged subtrees on edit.
 */

export type ExpressionAst =
  | Readonly<{ kind: "and" | "or"; operands: readonly ExpressionAst[] }>
  | Readonly<{ kind: "not"; operand: ExpressionAst }>
  | Readonly<{ kind: "supertag"; target: string }>
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "field-defined"; target: string; defined: boolean }>
  | Readonly<{ kind: "field-value"; target: string; scalar: string }>
  | Readonly<{ kind: "date-compare"; target: string; operator: "lt" | "gt"; date: string }>
  | Readonly<{ kind: "child-of" | "descendant-of"; target: string }>
  | Readonly<{ kind: "links-to"; target: string }>;

/** Parses the README grammar; `not` > `and` > `or`, parentheses group. */
export function parseExpression(input: string): ExpressionAst {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  const ast = parser.parseOr();
  if (parser.position !== tokens.length) {
    throw new CliError("invalid-value", `Unexpected token in expression: ${describeToken(tokens.at(parser.position))}`);
  }
  return ast;
}

type Token = Readonly<
  { kind: "word"; value: string } | { kind: "quoted"; value: string } | { kind: "symbol"; value: string }
>;

function tokenize(input: string): readonly Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < input.length) {
    const character = input[position];
    if (/\s/u.test(character ?? "")) {
      position += 1;
      continue;
    }
    if (character === '"') {
      const end = input.indexOf('"', position + 1);
      if (end < 0) {
        throw new CliError("invalid-value", "Unterminated quoted string in expression.");
      }
      tokens.push({ kind: "quoted", value: input.slice(position + 1, end) });
      position = end + 1;
      continue;
    }
    if (character === "(" || character === ")" || character === "=" || character === "<" || character === ">") {
      tokens.push({ kind: "symbol", value: character });
      position += 1;
      continue;
    }
    const rest = input.slice(position);
    const word = /^[\p{L}\p{N}_.:/-]+/u.exec(rest);
    if (word === null) {
      throw new CliError("invalid-value", `Unexpected character in expression: ${character}`);
    }
    tokens.push({ kind: "word", value: word[0] });
    position += word[0].length;
  }
  return tokens;
}

class Parser {
  position = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private takeWord(): string {
    const token = this.peek();
    if (token === undefined || token.kind === "symbol") {
      throw new CliError("invalid-value", "Expression ended where a term was expected.");
    }
    this.position += 1;
    return token.value;
  }

  private takeSymbol(value: string): void {
    const token = this.peek();
    if (token === undefined || token.kind !== "symbol" || token.value !== value) {
      throw new CliError("invalid-value", `Expected “${value}” in expression.`);
    }
    this.position += 1;
  }

  parseOr(): ExpressionAst {
    let left = this.parseAnd();
    while (this.peek()?.kind === "word" && this.peek()?.value === "or") {
      this.position += 1;
      const right = this.parseAnd();
      left = { kind: "or", operands: [...(left.kind === "or" ? left.operands : [left]), right] };
    }
    return left;
  }

  parseAnd(): ExpressionAst {
    let left = this.parseNot();
    while (this.peek()?.kind === "word" && this.peek()?.value === "and") {
      this.position += 1;
      const right = this.parseNot();
      left = { kind: "and", operands: [...(left.kind === "and" ? left.operands : [left]), right] };
    }
    return left;
  }

  parseNot(): ExpressionAst {
    if (this.peek()?.kind === "word" && this.peek()?.value === "not") {
      this.position += 1;
      return { kind: "not", operand: this.parseNot() };
    }
    return this.parseAtom();
  }

  parseAtom(): ExpressionAst {
    const token = this.peek();
    if (token?.kind === "symbol" && token.value === "(") {
      this.position += 1;
      const inner = this.parseOr();
      this.takeSymbol(")");
      return inner;
    }
    const name = this.takeWord();
    if (name === "not" || name === "and" || name === "or") {
      throw new CliError("invalid-value", `“${name}” needs an operand.`);
    }
    this.takeSymbol("(");
    const closing = this.tokens[this.position];
    const argument = closing?.kind === "symbol" && closing.value === ")" ? "" : this.takeWord();
    this.takeSymbol(")");
    switch (name) {
      case "tag":
        return { kind: "supertag", target: argument };
      case "text":
        return { kind: "text", text: argument };
      case "defined":
        return { kind: "field-defined", target: argument, defined: true };
      case "undefined":
        return { kind: "field-defined", target: argument, defined: false };
      case "field":
        this.takeSymbol("=");
        return { kind: "field-value", target: argument, scalar: this.takeWord() };
      case "date":
      case "links-to": {
        if (name === "links-to") {
          return { kind: "links-to", target: argument };
        }
        const operator = this.peek();
        if (operator?.kind === "symbol" && (operator.value === "<" || operator.value === ">")) {
          this.position += 1;
          return {
            kind: "date-compare",
            target: argument,
            operator: operator.value === "<" ? "lt" : "gt",
            date: this.takeWord(),
          };
        }
        throw new CliError("invalid-value", "date(...) needs < or > followed by YYYY-MM-DD.");
      }
      case "child-of":
      case "descendant-of":
        if (argument === "parent" || argument === "grandparent") {
          return { kind: name === "child-of" ? "child-of" : "descendant-of", target: argument };
        }
        return { kind: name === "child-of" ? "child-of" : "descendant-of", target: argument };
      default:
        throw new CliError("invalid-value", `Unknown predicate “${name}(...)”.`);
    }
  }
}

function describeToken(token: Token | undefined): string {
  if (token === undefined) {
    return "end of expression";
  }
  return token.kind === "symbol" ? token.value : token.value;
}
