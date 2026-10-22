import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import ts from "typescript";

export async function buildImportGraph(repository) {
  const fileSet = new Set(repository.productionFiles.map(normalize));
  const graph = new Map();
  const nonStaticRuntimeLoads = [];
  const unresolvedWorkspaceImports = [];
  for (const file of repository.productionFiles) {
    const source = await readFile(file, "utf8");
    const dependencies = new Map();
    const parsed = parseImports(source, file, sourceModuleCondition(repository, file));
    nonStaticRuntimeLoads.push(
      ...parsed.nonStaticRuntimeLoads.map(
        (line) => `${displayPath(repository.repositoryRoot, file)}:${line}`,
      ),
    );
    for (const imported of parsed.imports) {
      const dependency = resolveImport(repository, fileSet, file, imported.specifier, imported.condition);
      if (dependency === undefined) {
        if (workspaceForSpecifier(repository, imported.specifier) !== undefined || imported.specifier.startsWith("#")) {
          unresolvedWorkspaceImports.push(
            `${displayPath(repository.repositoryRoot, file)}: ${imported.specifier} (${imported.condition})`,
          );
        }
        continue;
      }
      const existing = dependencies.get(dependency);
      dependencies.set(dependency, {
        runtime: imported.runtime || existing?.runtime === true,
        specifiers: [...(existing?.specifiers ?? []), imported.specifier],
      });
    }
    graph.set(normalize(file), dependencies);
  }
  const diagnostics = [];
  if (nonStaticRuntimeLoads.length > 0) {
    diagnostics.push({ category: "non-static runtime module load", details: nonStaticRuntimeLoads.sort() });
  }
  if (unresolvedWorkspaceImports.length > 0) {
    diagnostics.push({ category: "unresolved workspace import", details: unresolvedWorkspaceImports.sort() });
  }
  return { diagnostics, graph };
}

export async function collectPackageImports(files) {
  const imports = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    imports.set(file, parseImports(source, file).packageSpecifiers);
  }
  return imports;
}

export function stronglyConnectedComponents(graph, edgeIncluded = () => true) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const stacked = new Set();
  const components = [];

  function connect(file) {
    indices.set(file, nextIndex);
    lowLinks.set(file, nextIndex);
    nextIndex += 1;
    stack.push(file);
    stacked.add(file);

    for (const [dependency, edge] of graph.get(file) ?? []) {
      if (!edgeIncluded(edge)) {
        continue;
      }
      if (!indices.has(dependency)) {
        connect(dependency);
        lowLinks.set(file, Math.min(lowLinks.get(file), lowLinks.get(dependency)));
      } else if (stacked.has(dependency)) {
        lowLinks.set(file, Math.min(lowLinks.get(file), indices.get(dependency)));
      }
    }

    if (lowLinks.get(file) !== indices.get(file)) {
      return;
    }
    const component = [];
    let member;
    do {
      member = stack.pop();
      stacked.delete(member);
      component.push(member);
    } while (member !== file);
    const selfEdge = component.length === 1 ? graph.get(file)?.get(file) : undefined;
    const selfCycle = selfEdge !== undefined && edgeIncluded(selfEdge);
    if (component.length > 1 || selfCycle) {
      components.push(component);
    }
  }

  for (const file of graph.keys()) {
    if (!indices.has(file)) {
      connect(file);
    }
  }
  return components;
}

export function displayPath(repositoryRoot, path) {
  return relative(repositoryRoot, path).replaceAll("\\", "/");
}

export function resolveManifestTargets(workspace, target, files) {
  if (typeof target !== "string") {
    return [];
  }
  const sourcePattern = target.replace(/^\.\/dist\//, "src/");
  if (sourcePattern.includes("*")) {
    const patterns = sourceTargetCandidates(sourcePattern).map(
      (candidate) =>
        new RegExp(`^${escapeRegex(normalize(join(workspace.root, candidate))).replace("\\*", "[^/\\\\]+")}$`),
    );
    return files.filter((file) => patterns.some((pattern) => pattern.test(file)));
  }
  const candidates = sourceTargetCandidates(sourcePattern);
  const fileSet = new Set(files);
  return candidates.map((candidate) => normalize(join(workspace.root, candidate))).filter((file) => fileSet.has(file));
}

function sourceTargetCandidates(sourcePattern) {
  if (sourcePattern.endsWith(".d.ts")) {
    const stem = sourcePattern.slice(0, -".d.ts".length);
    return [`${stem}.ts`, `${stem}.tsx`];
  }
  const extension = extname(sourcePattern);
  const stem = extension === "" ? sourcePattern : sourcePattern.slice(0, -extension.length);
  return extension === ".js"
    ? [`${stem}.ts`, `${stem}.tsx`]
    : extension === ".mjs"
      ? [`${stem}.mts`, sourcePattern]
      : extension === ".cjs"
        ? [`${stem}.cts`]
        : [sourcePattern];
}

function parseImports(source, path, sourceCondition = extname(path) === ".cts" ? "require" : "import") {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const resolutionSpecifiers = [];
  const nonStaticRuntimeLoads = new Set();
  const commonJsLoaders = collectCommonJsLoaderAliases(sourceFile);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const runtime = importDeclarationIsRuntime(node);
      imports.push({
        condition: runtime ? sourceCondition : typeModuleCondition(sourceCondition),
        specifier: node.moduleSpecifier.text,
        runtime,
      });
      if (
        runtime &&
        (isRuntimeCodeCapabilityModule(node.moduleSpecifier.text) ||
          nodeModuleImportExposesUntrackedCapability(node) ||
          childProcessImportExposesUntrackedCapability(node))
      ) {
        nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push({
        condition: node.isTypeOnly ? typeModuleCondition(sourceCondition) : "require",
        specifier: node.moduleReference.expression.text,
        runtime: !node.isTypeOnly,
      });
      if (
        !node.isTypeOnly &&
        (isRuntimeCodeCapabilityModule(node.moduleReference.expression.text) ||
          isChildProcessSpecifier(node.moduleReference.expression.text))
      ) {
        nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const runtime = exportDeclarationIsRuntime(node);
      imports.push({
        condition: runtime ? sourceCondition : typeModuleCondition(sourceCondition),
        specifier: node.moduleSpecifier.text,
        runtime,
      });
      if (
        runtime &&
        (isRuntimeCodeCapabilityModule(node.moduleSpecifier.text) ||
          isNodeModuleSpecifier(node.moduleSpecifier.text) ||
          isChildProcessSpecifier(node.moduleSpecifier.text))
      ) {
        nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = moduleLiteral(node.arguments[0]);
      if (specifier === undefined) {
        nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      } else {
        imports.push({ condition: "import", specifier, runtime: true });
        if (
          isRuntimeCodeCapabilityModule(specifier) ||
          isChildProcessSpecifier(specifier) ||
          (isNodeModuleSpecifier(specifier) && !dynamicNodeModuleImportIsTracked(node))
        ) {
          nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const resolution = parseModuleResolution(node, commonJsLoaders);
      const resolvedSpecifier = resolution === undefined ? undefined : moduleLiteral(resolution.moduleArgument);
      if (resolvedSpecifier !== undefined) {
        resolutionSpecifiers.push(resolvedSpecifier);
      }
      if (
        isDynamicCodeInvocation(node, commonJsLoaders) ||
        (isCreateRequireInvocation(node, commonJsLoaders) &&
          !createRequireBaseIsImporterRelative(node, commonJsLoaders, sourceCondition)) ||
        isRebasedModuleRequireInvocation(node, commonJsLoaders) ||
        (isCreateRequireInvocation(node, commonJsLoaders) && createRequireResultEscapes(node))
      ) {
        nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
      } else {
        const builtinModuleLoad = parseGetBuiltinModuleInvocation(node, commonJsLoaders);
        const builtinSpecifier = builtinModuleLoad === undefined ? undefined : moduleLiteral(builtinModuleLoad.arguments?.[0]);
        if (builtinModuleLoad !== undefined && builtinSpecifier === undefined) {
          nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        } else if (
          isRuntimeCodeCapabilityModule(builtinSpecifier) ||
          isChildProcessSpecifier(builtinSpecifier) ||
          (isNodeModuleSpecifier(builtinSpecifier) && !nodeModuleNamespaceConsumerIsTracked(node))
        ) {
          nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        }
        const commonJsLoad = parseCommonJsLoad(node, commonJsLoaders);
        if (commonJsLoad === undefined) {
          ts.forEachChild(node, visit);
          return;
        }
        const specifier = moduleLiteral(commonJsLoad.moduleArgument);
        if (specifier === undefined) {
          nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
        } else {
          imports.push({ condition: "require", specifier, runtime: true });
          if (
            isRuntimeCodeCapabilityModule(specifier) ||
            isChildProcessSpecifier(specifier) ||
            (isNodeModuleSpecifier(specifier) && !nodeModuleNamespaceConsumerIsTracked(node))
          ) {
            nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
          }
        }
      }
    } else if (ts.isNewExpression(node) && isDynamicCodeInvocation(node, commonJsLoaders)) {
      nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      imports.push({
        condition: typeModuleCondition(sourceCondition),
        specifier: node.argument.literal.text,
        runtime: false,
      });
    } else if (
      isCommonJsLoaderReference(node, commonJsLoaders) &&
      commonJsLoaderEscapes(node, commonJsLoaders)
    ) {
      nonStaticRuntimeLoads.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    imports,
    nonStaticRuntimeLoads: [...nonStaticRuntimeLoads],
    packageSpecifiers: [...new Set([...imports.map(({ specifier }) => specifier), ...resolutionSpecifiers])],
  };
}

function commonJsLoaderEscapes(reference, aliases) {
  if (referenceOccursInType(reference)) {
    return false;
  }
  const parent = reference.parent;
  if (isTransparentExpressionParent(parent, reference)) {
    return commonJsLoaderEscapes(parent, aliases);
  }
  if (ts.isCallExpression(parent) && parent.expression === reference) {
    return false;
  }
  if (ts.isVariableDeclaration(parent) && (parent.name === reference || parent.initializer === reference)) {
    return variableDeclarationCapabilityEscapes(parent, reference, aliases);
  }
  if (ts.isBindingElement(parent) && parent.name === reference) {
    return variableDeclarationIsExported(parent.parent.parent);
  }
  if (ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent)) {
    return false;
  }
  if (ts.isImportEqualsDeclaration(parent) && parent.name === reference) {
    return false;
  }
  if (isAccessExpression(parent) && accessExpressionTarget(parent) === reference) {
    const member = accessExpressionName(parent);
    if (member === "call" || member === "apply") {
      return !(ts.isCallExpression(parent.parent) && parent.parent.expression === parent);
    }
    if (member === "bind") {
      if (!ts.isCallExpression(parent.parent) || parent.parent.expression !== parent) {
        return true;
      }
      return boundLoaderEscapes(parent.parent, aliases);
    }
    if (isModuleNamespaceReference(reference, aliases)) {
      return member !== "createRequire" && member !== "Module" && member !== "default";
    }
    if (isCommonJsModuleReference(reference, aliases)) {
      return ![
        "exports",
        "filename",
        "id",
        "isPreloading",
        "loaded",
        "path",
        "paths",
        "require",
      ].includes(member);
    }
    if (isRequireReference(reference, aliases)) {
      return member !== "resolve";
    }
    if (isProcessReference(reference, aliases)) {
      return member === undefined || ["mainModule", "dlopen", "binding", "_linkedBinding"].includes(member);
    }
    if (isGlobalObjectReference(reference, aliases)) {
      return member === undefined;
    }
    return false;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === reference) {
    return false;
  }
  if (ts.isTypeQueryNode(parent)) {
    return false;
  }
  return true;
}

function referenceOccursInType(reference) {
  let current = reference.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) {
      return true;
    }
    if (ts.isStatement(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function collectCommonJsLoaderAliases(sourceFile) {
  const commonJsModuleAliases = new Set(["module"]);
  const moduleResolutionAliases = new Set();
  const createRequireAliases = new Set();
  const dynamicCodeAliases = new Set(["eval", "Function"]);
  const getBuiltinModuleAliases = new Set();
  const globalObjectAliases = new Set(["globalThis", "global"]);
  const moduleNamespaceAliases = new Set();
  const processAliases = new Set(["process"]);
  const requireAliases = new Set(["require"]);
  const staticStringAliases = new Map();
  const declarations = [];
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      !node.importClause?.isTypeOnly &&
      (node.moduleSpecifier.text === "node:module" || node.moduleSpecifier.text === "module") &&
      node.importClause !== undefined
    ) {
      if (node.importClause.name !== undefined) {
        moduleNamespaceAliases.add(node.importClause.name.text);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        moduleNamespaceAliases.add(bindings.name.text);
      } else if (bindings !== undefined) {
        for (const specifier of bindings.elements) {
          if (!specifier.isTypeOnly) {
            const importedName = (specifier.propertyName ?? specifier.name).text;
            if (importedName === "createRequire") {
              createRequireAliases.add(specifier.name.text);
            } else if (importedName === "Module" || importedName === "default") {
              moduleNamespaceAliases.add(specifier.name.text);
            }
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isNodeModuleSpecifier(moduleLiteral(node.moduleReference.expression))
    ) {
      moduleNamespaceAliases.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const aliases = {
    commonJsModuleAliases,
    moduleResolutionAliases,
    createRequireAliases,
    dynamicCodeAliases,
    getBuiltinModuleAliases,
    globalObjectAliases,
    moduleNamespaceAliases,
    processAliases,
    requireAliases,
    staticStringAliases,
  };
  let changed;
  do {
    changed = false;
    for (const declaration of declarations) {
      if (ts.isIdentifier(declaration.name)) {
        const staticString = staticStringValue(declaration.initializer, aliases);
        if (staticString !== undefined) {
          changed = addStaticStringAlias(staticStringAliases, declaration.name.text, staticString) || changed;
        }
        if (
          isModuleResolutionReference(declaration.initializer, aliases) ||
          isBoundFunction(declaration.initializer, (value) => isModuleResolutionReference(value, aliases))
        ) {
          changed = addAlias(moduleResolutionAliases, declaration.name.text) || changed;
        }
        if (isDynamicCodeReference(declaration.initializer, aliases)) {
          changed = addAlias(dynamicCodeAliases, declaration.name.text) || changed;
        }
        if (isBoundFunction(declaration.initializer, (value) => isDynamicCodeReference(value, aliases))) {
          changed = addAlias(dynamicCodeAliases, declaration.name.text) || changed;
        }
        if (
          isGetBuiltinModuleReference(declaration.initializer, aliases) ||
          isBoundFunction(declaration.initializer, (value) => isGetBuiltinModuleReference(value, aliases))
        ) {
          changed = addAlias(getBuiltinModuleAliases, declaration.name.text) || changed;
        }
        if (isGlobalObjectReference(declaration.initializer, aliases)) {
          changed = addAlias(globalObjectAliases, declaration.name.text) || changed;
        }
        if (isCommonJsModuleReference(declaration.initializer, aliases)) {
          changed = addAlias(commonJsModuleAliases, declaration.name.text) || changed;
        }
        if (
          isCreateRequireReference(declaration.initializer, aliases) ||
          isBoundFunction(declaration.initializer, (value) => isCreateRequireReference(value, aliases))
        ) {
          changed = addAlias(createRequireAliases, declaration.name.text) || changed;
        }
        if (
          isRequireReference(declaration.initializer, aliases) ||
          isCreateRequireInvocation(declaration.initializer, aliases) ||
          isBoundFunction(declaration.initializer, (value) => isRequireReference(value, aliases))
        ) {
          changed = addAlias(requireAliases, declaration.name.text) || changed;
        }
        if (isNodeModuleNamespaceValue(declaration.initializer, aliases)) {
          changed = addAlias(moduleNamespaceAliases, declaration.name.text) || changed;
        }
        if (isProcessReference(declaration.initializer, aliases)) {
          changed = addAlias(processAliases, declaration.name.text) || changed;
        }
      } else if (ts.isObjectBindingPattern(declaration.name)) {
        for (const element of declaration.name.elements) {
          const propertyName = bindingElementPropertyName(element);
          if (
            (propertyName === "eval" || propertyName === "Function") &&
            isGlobalObjectReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(dynamicCodeAliases, element.name.text) || changed;
          }
          if (
            propertyName === "constructor" &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(dynamicCodeAliases, element.name.text) || changed;
          }
          if (
            propertyName === "resolve" &&
            (isRequireReference(declaration.initializer, aliases) ||
              isCreateRequireInvocation(declaration.initializer, aliases) ||
              isImportMetaReference(declaration.initializer)) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(moduleResolutionAliases, element.name.text) || changed;
          }
          if (
            propertyName === "getBuiltinModule" &&
            isProcessReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(getBuiltinModuleAliases, element.name.text) || changed;
          }
          if (
            propertyName === "require" &&
            (isCommonJsModuleReference(declaration.initializer, aliases) ||
              isGlobalObjectReference(declaration.initializer, aliases)) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(requireAliases, element.name.text) || changed;
          }
          if (
            propertyName === "parent" &&
            isCommonJsModuleReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(commonJsModuleAliases, element.name.text) || changed;
          }
          if (
            propertyName === "main" &&
            isRequireReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(commonJsModuleAliases, element.name.text) || changed;
          }
          if (
            propertyName === "mainModule" &&
            isProcessReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(commonJsModuleAliases, element.name.text) || changed;
          }
          if (
            propertyName === "module" &&
            isGlobalObjectReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(commonJsModuleAliases, element.name.text) || changed;
          }
          if (
            propertyName === "process" &&
            isGlobalObjectReference(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(processAliases, element.name.text) || changed;
          }
          if (
            propertyName === "createRequire" &&
            isNodeModuleNamespaceValue(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(createRequireAliases, element.name.text) || changed;
          }
          if (
            (propertyName === "Module" || propertyName === "default") &&
            isNodeModuleNamespaceValue(declaration.initializer, aliases) &&
            ts.isIdentifier(element.name)
          ) {
            changed = addAlias(moduleNamespaceAliases, element.name.text) || changed;
          }
        }
      }
    }
  } while (changed);
  return aliases;
}

function parseCommonJsLoad(call, aliases) {
  const requireInvocation = parseKnownFunctionInvocation(call, (value) => isRequireReference(value, aliases));
  if (requireInvocation !== undefined) {
    return { moduleArgument: requireInvocation.arguments?.[0] };
  }
  if (
    isCreateRequireInvocation(call.expression, aliases) ||
    isBoundFunction(call.expression, (value) => isRequireReference(value, aliases))
  ) {
    return { moduleArgument: call.arguments[0] };
  }
  return undefined;
}

function parseModuleResolution(call, aliases) {
  const invocation = parseKnownFunctionInvocation(call, (value) => isModuleResolutionReference(value, aliases));
  return invocation === undefined ? undefined : { moduleArgument: invocation.arguments?.[0] };
}

function isModuleResolutionReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.moduleResolutionAliases)) {
    return true;
  }
  if (!isAccessExpression(value) || accessExpressionName(value) !== "resolve") {
    return false;
  }
  const target = accessExpressionTarget(value);
  return isRequireReference(target, aliases) || isCreateRequireInvocation(target, aliases) || isImportMetaReference(target);
}

function isImportMetaReference(value) {
  value = unwrapTransparentExpression(value);
  return (
    ts.isMetaProperty(value) &&
    value.keywordToken === ts.SyntaxKind.ImportKeyword &&
    value.name.text === "meta"
  );
}

function parseKnownFunctionInvocation(call, isFunctionReference) {
  if (isFunctionReference(call.expression)) {
    return { arguments: [...call.arguments] };
  }
  if (!isAccessExpression(call.expression) || !isFunctionReference(accessExpressionTarget(call.expression))) {
    return undefined;
  }
  const invocation = accessExpressionName(call.expression);
  if (invocation === "call") {
    return { arguments: [...call.arguments].slice(1) };
  }
  if (invocation !== "apply") {
    return undefined;
  }
  const appliedArguments = call.arguments[1];
  return {
    arguments: appliedArguments !== undefined && ts.isArrayLiteralExpression(appliedArguments)
      ? [...appliedArguments.elements]
      : undefined,
  };
}

function isCreateRequireInvocation(value, aliases) {
  return (
    ts.isCallExpression(value) &&
    parseKnownFunctionInvocation(value, (candidate) => isCreateRequireReference(candidate, aliases)) !== undefined
  );
}

function createRequireBaseIsImporterRelative(value, aliases, sourceCondition) {
  const invocation = parseKnownFunctionInvocation(value, (candidate) => isCreateRequireReference(candidate, aliases));
  if (invocation === undefined) {
    return false;
  }
  const argument = invocation.arguments?.[0];
  if (argument === undefined) {
    return false;
  }
  const base = unwrapTransparentExpression(argument);
  if (sourceCondition === "require" && ts.isIdentifier(base) && base.text === "__filename") {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(base) &&
    base.name.text === "url" &&
    ts.isMetaProperty(base.expression) &&
    base.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    base.expression.name.text === "meta"
  );
}

function isRebasedModuleRequireInvocation(value, aliases) {
  if (!ts.isCallExpression(value) || !isAccessExpression(value.expression)) {
    return false;
  }
  const invocation = accessExpressionName(value.expression);
  if (!["apply", "bind", "call"].includes(invocation)) {
    return false;
  }
  const requireReference = accessExpressionTarget(value.expression);
  return (
    isAccessExpression(requireReference) &&
    accessExpressionName(requireReference) === "require" &&
    isCommonJsModuleReference(accessExpressionTarget(requireReference), aliases)
  );
}

function isBoundFunction(value, isFunctionReference) {
  return (
    ts.isCallExpression(value) &&
    isAccessExpression(value.expression) &&
    accessExpressionName(value.expression) === "bind" &&
    isFunctionReference(accessExpressionTarget(value.expression))
  );
}

function isCommonJsLoaderReference(value, aliases) {
  return (
    isCommonJsModuleReference(value, aliases) ||
    isRequireReference(value, aliases) ||
    isCreateRequireReference(value, aliases) ||
    isModuleNamespaceReference(value, aliases) ||
    isGetBuiltinModuleReference(value, aliases) ||
    isDynamicCodeReference(value, aliases) ||
    isProcessReference(value, aliases) ||
    isGlobalObjectReference(value, aliases)
  );
}

function isRequireReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.requireAliases)) {
    return true;
  }
  return (
    isAccessExpression(value) &&
    accessExpressionName(value) === "require" &&
    (isCommonJsModuleReference(accessExpressionTarget(value), aliases) ||
      isGlobalObjectReference(accessExpressionTarget(value), aliases))
  );
}

function isCommonJsModuleReference(value, aliases) {
  value = unwrapTransparentExpression(value);
  if (isAliasIdentifierReference(value, aliases.commonJsModuleAliases)) {
    return true;
  }
  if (!isAccessExpression(value)) {
    return false;
  }
  const member = accessExpressionName(value);
  const target = accessExpressionTarget(value);
  return (
    (member === "main" && isRequireReference(target, aliases)) ||
    (member === "parent" && isCommonJsModuleReference(target, aliases)) ||
    (member === "module" && isGlobalObjectReference(target, aliases)) ||
    (member === "mainModule" && isProcessReference(target, aliases))
  );
}

function isCreateRequireReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.createRequireAliases)) {
    return true;
  }
  if (!isAccessExpression(value) || accessExpressionName(value) !== "createRequire") {
    return false;
  }
  const target = accessExpressionTarget(value);
  return isModuleNamespaceReference(target, aliases) || isNodeModuleNamespaceValue(target, aliases);
}

function isModuleNamespaceReference(value, aliases) {
  return isAliasIdentifierReference(value, aliases.moduleNamespaceAliases);
}

function isGetBuiltinModuleReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.getBuiltinModuleAliases)) {
    return true;
  }
  return (
    isAccessExpression(value) &&
    accessExpressionName(value) === "getBuiltinModule" &&
    isProcessReference(accessExpressionTarget(value), aliases)
  );
}

function isProcessReference(value, aliases) {
  return isAliasIdentifierReference(value, aliases.processAliases) ||
    (isAccessExpression(value) &&
      accessExpressionName(value) === "process" &&
      isGlobalObjectReference(accessExpressionTarget(value), aliases));
}

function isDynamicCodeReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.dynamicCodeAliases)) {
    return true;
  }
  if (
    isAccessExpression(value) &&
    (dynamicAccessExpressionName(value, aliases) === "eval" ||
      dynamicAccessExpressionName(value, aliases) === "Function") &&
    isGlobalObjectReference(accessExpressionTarget(value), aliases)
  ) {
    return true;
  }
  return (
    (isAccessExpression(value) && dynamicAccessExpressionName(value, aliases) === "constructor") ||
    isReflectGetConstructor(value, aliases) ||
    isFunctionConstructorDescriptorValue(value, aliases)
  );
}

function isReflectGetConstructor(value, aliases) {
  value = unwrapTransparentExpression(value);
  return (
    ts.isCallExpression(value) &&
    isAccessExpression(value.expression) &&
    accessExpressionName(value.expression) === "get" &&
    ts.isIdentifier(unwrapTransparentExpression(accessExpressionTarget(value.expression))) &&
    unwrapTransparentExpression(accessExpressionTarget(value.expression)).text === "Reflect" &&
    staticStringValue(value.arguments[1], aliases) === "constructor"
  );
}

function isFunctionConstructorDescriptorValue(value, aliases) {
  value = unwrapTransparentExpression(value);
  if (
    !isAccessExpression(value) ||
    dynamicAccessExpressionName(value, aliases) !== "value"
  ) {
    return false;
  }
  const descriptor = unwrapTransparentExpression(accessExpressionTarget(value));
  return (
    ts.isCallExpression(descriptor) &&
    isAccessExpression(descriptor.expression) &&
    accessExpressionName(descriptor.expression) === "getOwnPropertyDescriptor" &&
    staticStringValue(descriptor.arguments[1], aliases) === "constructor"
  );
}

function isGlobalObjectReference(value, aliases) {
  if (isAliasIdentifierReference(value, aliases.globalObjectAliases)) {
    return true;
  }
  return (
    isAccessExpression(value) &&
    (accessExpressionName(value) === "global" || accessExpressionName(value) === "globalThis") &&
    isGlobalObjectReference(accessExpressionTarget(value), aliases)
  );
}

function isAliasIdentifierReference(value, aliases) {
  if (!ts.isIdentifier(value) || !aliases.has(value.text)) {
    return false;
  }
  const parent = value.parent;
  return !(ts.isPropertyAccessExpression(parent) && parent.name === value) &&
    !(ts.isBindingElement(parent) && parent.propertyName === value) &&
    !(ts.isImportSpecifier(parent) && parent.propertyName === value);
}

function isNodeModuleNamespaceValue(value, aliases) {
  value = unwrapTransparentExpression(value);
  if (isModuleNamespaceReference(value, aliases)) {
    return true;
  }
  if (
    isAccessExpression(value) &&
    (accessExpressionName(value) === "Module" || accessExpressionName(value) === "default") &&
    isNodeModuleNamespaceValue(accessExpressionTarget(value), aliases)
  ) {
    return true;
  }
  if (ts.isAwaitExpression(value)) {
    const awaited = unwrapTransparentExpression(value.expression);
    return isNodeModuleDynamicImport(awaited) || isNodeModuleNamespaceValue(awaited, aliases);
  }
  if (!ts.isCallExpression(value)) {
    return false;
  }
  const builtinModuleLoad = parseGetBuiltinModuleInvocation(value, aliases);
  if (builtinModuleLoad !== undefined) {
    return isNodeModuleSpecifier(moduleLiteral(builtinModuleLoad.arguments?.[0]));
  }
  const load = parseCommonJsLoad(value, aliases);
  const specifier = load === undefined ? undefined : moduleLiteral(load.moduleArgument);
  return specifier === "node:module" || specifier === "module";
}

function parseGetBuiltinModuleInvocation(value, aliases) {
  return ts.isCallExpression(value)
    ? parseKnownFunctionInvocation(value, (candidate) => isGetBuiltinModuleReference(candidate, aliases))
    : undefined;
}

function isDynamicCodeInvocation(value, aliases) {
  if (
    parseKnownFunctionInvocation(value, (candidate) => isDynamicCodeReference(candidate, aliases)) !== undefined ||
    isBoundFunction(value, (candidate) => isDynamicCodeReference(candidate, aliases))
  ) {
    return true;
  }
  const expression = value.expression;
  if (isDynamicCodeReference(expression, aliases)) {
    return true;
  }
  return (
    isAccessExpression(expression) &&
    dynamicAccessExpressionName(expression, aliases) === "constructor" &&
    (value.arguments ?? []).length > 0
  );
}

function createRequireResultEscapes(call) {
  let value = call;
  while (isTransparentExpressionParent(value.parent, value)) {
    value = value.parent;
  }
  const consumer = value.parent;
  if (ts.isVariableDeclaration(consumer) && consumer.initializer === value) {
    return !ts.isIdentifier(consumer.name) || variableDeclarationIsExported(consumer);
  }
  if (ts.isCallExpression(consumer) && consumer.expression === value) {
    return false;
  }
  if (
    isAccessExpression(consumer) &&
    accessExpressionTarget(consumer) === value &&
    accessExpressionName(consumer) === "resolve"
  ) {
    const resolveConsumer = consumer.parent;
    if (ts.isCallExpression(resolveConsumer) && resolveConsumer.expression === consumer) {
      return false;
    }
    return !(
      isAccessExpression(resolveConsumer) &&
      accessExpressionTarget(resolveConsumer) === consumer &&
      accessExpressionName(resolveConsumer) === "paths" &&
      ts.isCallExpression(resolveConsumer.parent) &&
      resolveConsumer.parent.expression === resolveConsumer
    );
  }
  return true;
}

function dynamicNodeModuleImportIsTracked(call) {
  let value = call;
  while (isTransparentExpressionParent(value.parent, value)) {
    value = value.parent;
  }
  if (!ts.isAwaitExpression(value.parent) || value.parent.expression !== value) {
    return false;
  }
  value = value.parent;
  while (isTransparentExpressionParent(value.parent, value)) {
    value = value.parent;
  }
  return nodeModuleNamespaceConsumerIsTracked(value);
}

function nodeModuleNamespaceConsumerIsTracked(value) {
  while (isTransparentExpressionParent(value.parent, value)) {
    value = value.parent;
  }
  if (ts.isAwaitExpression(value.parent) && value.parent.expression === value) {
    value = value.parent;
    while (isTransparentExpressionParent(value.parent, value)) {
      value = value.parent;
    }
  }
  const consumer = value.parent;
  if (ts.isVariableDeclaration(consumer) && consumer.initializer === value) {
    if (ts.isIdentifier(consumer.name)) {
      return true;
    }
    return (
      ts.isObjectBindingPattern(consumer.name) &&
      consumer.name.elements.every((element) => {
        const propertyName = bindingElementPropertyName(element);
        return (
          element.dotDotDotToken === undefined &&
          propertyName !== undefined &&
          ["Module", "createRequire", "default"].includes(propertyName) &&
          ts.isIdentifier(element.name)
        );
      })
    );
  }
  if (!isAccessExpression(consumer) || accessExpressionTarget(consumer) !== value) {
    return false;
  }
  const member = accessExpressionName(consumer);
  return member === "createRequire" ||
    ((member === "Module" || member === "default") && nodeModuleNamespaceConsumerIsTracked(consumer));
}

function isNodeModuleDynamicImport(value) {
  return (
    ts.isCallExpression(value) &&
    value.expression.kind === ts.SyntaxKind.ImportKeyword &&
    isNodeModuleSpecifier(moduleLiteral(value.arguments[0]))
  );
}

function isNodeModuleSpecifier(specifier) {
  return specifier === "node:module" || specifier === "module";
}

function isRuntimeCodeCapabilityModule(specifier) {
  return specifier === "node:vm" || specifier === "vm" || specifier === "node:worker_threads" || specifier === "worker_threads";
}

function isChildProcessSpecifier(specifier) {
  return specifier === "node:child_process" || specifier === "child_process";
}

function childProcessImportExposesUntrackedCapability(node) {
  if (!isChildProcessSpecifier(node.moduleSpecifier.text) || node.importClause?.isTypeOnly) {
    return false;
  }
  if (node.importClause?.name !== undefined) {
    return true;
  }
  const bindings = node.importClause?.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) {
    return true;
  }
  return bindings.elements.some(
    (specifier) => !specifier.isTypeOnly && (specifier.propertyName ?? specifier.name).text === "fork",
  );
}

function nodeModuleImportExposesUntrackedCapability(node) {
  if (!isNodeModuleSpecifier(node.moduleSpecifier.text)) {
    return false;
  }
  const bindings = node.importClause?.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.some((specifier) => {
      const importedName = (specifier.propertyName ?? specifier.name).text;
      return !specifier.isTypeOnly && !["Module", "createRequire", "default"].includes(importedName);
    })
  );
}

function unwrapTransparentExpression(value) {
  let current = value;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isTransparentExpressionParent(parent, expression) {
  return (
    parent !== undefined &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isSatisfiesExpression(parent)) &&
    parent.expression === expression
  );
}

function boundLoaderEscapes(bindCall, aliases) {
  const parent = bindCall.parent;
  if (ts.isVariableDeclaration(parent) && parent.initializer === bindCall) {
    return variableDeclarationIsExported(parent);
  }
  if (ts.isCallExpression(parent) && parent.expression === bindCall) {
    return parseCommonJsLoad(parent, aliases) === undefined;
  }
  return true;
}

function variableDeclarationIsExported(declaration) {
  let current = declaration;
  while (current !== undefined && !ts.isVariableStatement(current) && !ts.isSourceFile(current)) {
    current = current.parent;
  }
  return (
    current !== undefined &&
    ts.isVariableStatement(current) &&
    current.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function variableDeclarationCapabilityEscapes(declaration, source, aliases) {
  if (variableDeclarationIsExported(declaration)) {
    return true;
  }
  if (ts.isIdentifier(declaration.name)) {
    return false;
  }
  if (!ts.isObjectBindingPattern(declaration.name)) {
    return true;
  }
  return !declaration.name.elements.every((element) => {
    if (element.dotDotDotToken !== undefined) {
      return false;
    }
    const propertyName = bindingElementPropertyName(element);
    if (propertyName === undefined) {
      return false;
    }
    const capturesCapability = destructuredCapabilityIsTracked(source, propertyName, aliases);
    return capturesCapability ? ts.isIdentifier(element.name) : destructuredPropertyIsInert(source, propertyName, aliases);
  });
}

function destructuredCapabilityIsTracked(source, propertyName, aliases) {
  if (isNodeModuleNamespaceValue(source, aliases)) {
    return propertyName === "Module" || propertyName === "createRequire" || propertyName === "default";
  }
  if (isCommonJsModuleReference(source, aliases)) {
    return propertyName === "require" || propertyName === "parent";
  }
  if (isRequireReference(source, aliases)) {
    return propertyName === "main";
  }
  if (isProcessReference(source, aliases)) {
    return propertyName === "getBuiltinModule" || propertyName === "mainModule";
  }
  if (isGlobalObjectReference(source, aliases)) {
    return ["Function", "eval", "module", "process", "require"].includes(propertyName);
  }
  return false;
}

function destructuredPropertyIsInert(source, propertyName, aliases) {
  if (isCommonJsModuleReference(source, aliases)) {
    return ["exports", "filename", "id", "isPreloading", "loaded", "path", "paths"].includes(propertyName);
  }
  if (isRequireReference(source, aliases)) {
    return propertyName === "resolve";
  }
  if (isProcessReference(source, aliases)) {
    return ["argv", "env", "execPath", "exitCode", "pid", "platform", "stderr", "stdin", "stdout"].includes(
      propertyName,
    );
  }
  return false;
}

function bindingElementPropertyName(element) {
  const propertyName = element.propertyName ?? element.name;
  if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) {
    return propertyName.text;
  }
  return ts.isComputedPropertyName(propertyName) && ts.isStringLiteralLike(propertyName.expression)
    ? propertyName.expression.text
    : undefined;
}

function isAccessExpression(value) {
  return ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value);
}

function accessExpressionTarget(value) {
  return value.expression;
}

function accessExpressionName(value) {
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text;
  }
  return value.argumentExpression !== undefined && ts.isStringLiteralLike(value.argumentExpression)
    ? value.argumentExpression.text
    : undefined;
}

function dynamicAccessExpressionName(value, aliases) {
  if (ts.isPropertyAccessExpression(value)) {
    return value.name.text;
  }
  return staticStringValue(value.argumentExpression, aliases);
}

function staticStringValue(value, aliases) {
  if (value === undefined) {
    return undefined;
  }
  value = unwrapTransparentExpression(value);
  if (ts.isStringLiteralLike(value)) {
    return value.text;
  }
  return ts.isIdentifier(value) ? aliases.staticStringAliases.get(value.text) : undefined;
}

function addAlias(aliases, name) {
  const previousSize = aliases.size;
  aliases.add(name);
  return aliases.size !== previousSize;
}

function addStaticStringAlias(aliases, name, value) {
  if (aliases.has(name)) {
    return false;
  }
  aliases.set(name, value);
  return true;
}

function moduleLiteral(node) {
  if (node === undefined) {
    return undefined;
  }
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  return ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function importDeclarationIsRuntime(node) {
  if (node.importClause === undefined) {
    return true;
  }
  if (node.importClause.isTypeOnly) {
    return false;
  }
  if (node.importClause.name !== undefined) {
    return true;
  }
  const bindings = node.importClause.namedBindings;
  return (
    bindings === undefined ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.length === 0 ||
    bindings.elements.some((specifier) => !specifier.isTypeOnly)
  );
}

function exportDeclarationIsRuntime(node) {
  if (node.isTypeOnly) {
    return false;
  }
  return (
    node.exportClause === undefined ||
    !ts.isNamedExports(node.exportClause) ||
    node.exportClause.elements.length === 0 ||
    node.exportClause.elements.some((specifier) => !specifier.isTypeOnly)
  );
}

function resolveImport(repository, fileSet, importer, specifier, condition) {
  if (specifier.startsWith("#")) {
    return resolvePackageImport(repository, fileSet, importer, specifier, condition);
  }
  if (!specifier.startsWith(".")) {
    return resolveWorkspaceImport(repository, fileSet, specifier, condition);
  }
  const requested = normalize(join(dirname(importer), specifier));
  const extension = extname(requested);
  const candidates = extension
    ? relativeSourceCandidates(requested, extension)
    : [
        requested + ".ts",
        requested + ".tsx",
        requested + ".mts",
        requested + ".cts",
        requested + ".mjs",
        join(requested, "index.ts"),
      ];
  return candidates.map(normalize).find((candidate) => fileSet.has(candidate));
}

function relativeSourceCandidates(requested, extension) {
  const stem = requested.slice(0, -extension.length);
  if (extension === ".mjs") {
    return [`${stem}.mts`, requested];
  }
  if (extension === ".cjs") {
    return [`${stem}.cts`, requested];
  }
  if (extension === ".js") {
    return [`${stem}.ts`, `${stem}.tsx`, requested];
  }
  return [requested];
}

function resolvePackageImport(repository, fileSet, importer, specifier, condition) {
  const workspace = workspaceContainingFile(repository, importer);
  if (workspace === undefined) {
    return undefined;
  }
  for (const [importPattern, configuredTarget] of Object.entries(workspace.manifest.imports ?? {})) {
    const match = matchExportPath(importPattern, specifier);
    if (match === undefined) {
      continue;
    }
    const target = exportTarget(configuredTarget, condition);
    if (target === undefined) {
      return undefined;
    }
    const resolvedTarget = match === "" ? target : target.replaceAll("*", match);
    return resolvedTarget.startsWith(".")
      ? resolveManifestTargets(workspace, resolvedTarget, [...fileSet])[0]
      : resolveWorkspaceImport(repository, fileSet, resolvedTarget, condition);
  }
  return undefined;
}

function workspaceContainingFile(repository, file) {
  for (const workspace of repository.workspaces.values()) {
    if (file === workspace.sourceRoot || file.startsWith(`${workspace.sourceRoot}${sep}`)) {
      return workspace;
    }
  }
  return undefined;
}

function resolveWorkspaceImport(repository, fileSet, specifier, condition) {
  const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
  const workspace = repository.workspaces.get(packageName);
  if (workspace === undefined) {
    return undefined;
  }
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const configuredExports = workspace.manifest.exports;
  for (const [exportPath, configuredTarget] of packageExportEntries(configuredExports, subpath)) {
    const match = matchExportPath(exportPath, subpath);
    if (match === undefined) {
      continue;
    }
    const target = exportTarget(configuredTarget, condition);
    if (target === undefined) {
      return undefined;
    }
    const resolvedTarget = match === "" ? target : target.replace("*", match);
    return resolveManifestTargets(workspace, resolvedTarget, [...fileSet])[0];
  }
  if (configuredExports === undefined && subpath === ".") {
    const target = legacyPackageTarget(workspace.manifest, condition);
    return target === undefined
      ? undefined
      : resolveManifestTargets(workspace, target, [...fileSet])[0];
  }
  return undefined;
}

function workspaceForSpecifier(repository, specifier) {
  if (specifier.startsWith(".")) {
    return undefined;
  }
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return repository.workspaces.get(packageName);
}

function packageExportEntries(configuredExports, subpath) {
  if (configuredExports === undefined || configuredExports === null) {
    return [];
  }
  if (
    typeof configuredExports !== "object" ||
    Array.isArray(configuredExports) ||
    !Object.keys(configuredExports).some((key) => key.startsWith("."))
  ) {
    return subpath === "." ? [[".", configuredExports]] : [];
  }
  return Object.entries(configuredExports);
}

function sourceModuleCondition(repository, file) {
  if (extname(file) === ".cts") {
    return "require";
  }
  if (extname(file) === ".mts") {
    return "import";
  }
  const workspace = workspaceContainingFile(repository, file);
  if (workspace !== undefined) {
    return workspace.manifest.type === "module" ? "import" : "require";
  }
  return "import";
}

function typeModuleCondition(sourceCondition) {
  return sourceCondition === "require" ? "types-require" : "types-import";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchExportPath(exportPath, subpath) {
  if (!exportPath.includes("*")) {
    return exportPath === subpath ? "" : undefined;
  }
  const [prefix, suffix] = exportPath.split("*");
  return subpath.startsWith(prefix) && subpath.endsWith(suffix)
    ? subpath.slice(prefix.length, subpath.length - suffix.length)
    : undefined;
}

function exportTarget(configuredTarget, condition) {
  return conditionalExportTarget(configuredTarget, activeExportConditions(condition));
}

function conditionalExportTarget(configuredTarget, activeConditions) {
  if (typeof configuredTarget === "string") {
    return configuredTarget;
  }
  if (configuredTarget === null || typeof configuredTarget !== "object") {
    return undefined;
  }
  if (Array.isArray(configuredTarget)) {
    for (const candidate of configuredTarget) {
      const target = conditionalExportTarget(candidate, activeConditions);
      if (target !== undefined) {
        return target;
      }
    }
    return undefined;
  }
  for (const [condition, candidate] of Object.entries(configuredTarget)) {
    if (activeConditions.has(condition)) {
      const target = conditionalExportTarget(candidate, activeConditions);
      if (target !== undefined) {
        return target;
      }
    }
  }
  return undefined;
}

function activeExportConditions(condition) {
  if (condition === "types-import") {
    return new Set(["types", "node", "import", "default"]);
  }
  if (condition === "types-require") {
    return new Set(["types", "node", "require", "default"]);
  }
  return new Set(["node", condition, "default"]);
}

function legacyPackageTarget(manifest, condition) {
  if (condition === "types-import") {
    return manifest.types ?? manifest.module ?? manifest.main;
  }
  if (condition === "types-require") {
    return manifest.types ?? manifest.main ?? manifest.module;
  }
  return condition === "import" ? manifest.module ?? manifest.main : manifest.main ?? manifest.module;
}
