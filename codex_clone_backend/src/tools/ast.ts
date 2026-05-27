import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { parse } from "@babel/parser";
import fs from "fs/promises";
import path from "path";
import { safePath } from "./fileSystem";

function extractStructureFromAST(ast: any) {
  const result: any = {
    imports: [],
    exports: [],
    functions: [],
    variables: [],
    classes: [],
    types: [],
  };

  const visitedNodes = new WeakSet();

  function visit(node: any, isExported = false, parentKind?: string) {
    if (!node || typeof node !== "object" || visitedNodes.has(node)) return;
    visitedNodes.add(node);

    if (node.type) {
      switch (node.type) {
        case "ImportDeclaration":
          result.imports.push({
            source: node.source.value,
            specifiers: node.specifiers,
          });
          break;
        case "ExportNamedDeclaration":
        case "ExportDefaultDeclaration":
        case "ExportAllDeclaration":
          if (node.declaration) {
            visit(node.declaration, true);
          } else if (node.specifiers) {
            node.specifiers.forEach((c: any) => visit(c, true));
          }
          break;
        case "VariableDeclaration":
          node.declarations?.forEach((d: any) => visit(d, isExported, node.kind));
          break;
        case "FunctionDeclaration":
          if (node.id) {
            result.functions.push({
              name: node.id.name,
              params: formatParams(node.params),
              async: node.async,
              generator: node.generator,
              exported: isExported,
              returnType: node.returnType,
            });
          }
          break;
        case "VariableDeclarator":
          if (node.id?.type === "Identifier") {
            result.variables.push({
              name: node.id.name,
              kind: parentKind || "const",
              exported: isExported,
              line: node.loc?.start?.line,
            });
          }
          break;
        case "ClassDeclaration":
          if (node.id) {
            result.classes.push({
              name: node.id.name,
              superClass: node.superClass?.name,
              exported: isExported,
              methods: (node.body?.body || [])
                .filter(
                  (m: any) =>
                    m.type === "ClassMethod" ||
                    m.type === "TSAbstractMethodDefinition",
                )
                .map((m: any) => ({
                  name: m.key?.name,
                  params: formatParams(m.params),
                  static: m.static,
                  abstract: m.abstract,
                  access: m.access,
                  returnType: m.returnType,
                })),
            });
          }
          break;
        case "TSTypeAliasDeclaration":
        case "TSInterfaceDeclaration":
          result.types.push({
            kind:
              node.type === "TSTypeAliasDeclaration" ? "alias" : "interface",
            name: node.id?.name,
            members: (node.body?.members || []).map((m: any) => ({
              name: m.key?.name,
              typeAnnotation: m.typeAnnotation,
            })),
            line: node.loc?.start?.line,
          });
          break;
        default:
          break;
      }
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c: any) =>
          visit(c, isExported || node.type?.startsWith("Export")),
        );
      } else if (child && typeof child === "object") {
        visit(child, isExported || node.type?.startsWith("Export"));
      }
    }
  }

  visit(ast);
  return result;
}

function formatParams(params: any) {
  return params.map((param: any) => {
    switch (param.type) {
      case "Identifier":
        return param.typeAnnotation
          ? `${param.name}: ${param.typeAnnotation.typeAnnotation?.type || "unknown"}`
          : param.name;
      case "AssignmentPattern":
        return `${param.left.name} = ${param.right.value}`;
      case "RestElement":
        return `...${param.argument.name ?? "?"}`;
      case "ObjectPattern":
        return `{ ${param.properties.map((prop: any) => prop.key.name).join(", ")} }`;
      case "ArrayPattern":
        return `[${param.elements.map((elem: any) => elem.name || "unknown").join(", ")}]`;
      case "TSParameterProperty":
        return `${param.parameter.name}: ${param.parameter.typeAnnotation?.typeAnnotation?.type || "unknown"}`;
      default:
        return "unknown";
    }
  });
}

function renderStructure(filePath: string, structure: any) {
  const lines = [`# AST: ${filePath}`];

  if (structure.imports.length) {
    lines.push(`## Imports:`);
    structure.imports.forEach((imp: any) => {
      lines.push(
        `from ${imp.source} import ${imp.specifiers.map((s: any) => s.local.name).join(", ")}`,
      );
    });
  }

  if (structure.functions.length) {
    lines.push(`\n## Functions:`);
    for (const func of structure.functions) {
      const flags = [
        func.async ? "async" : null,
        func.generator ? "generator" : null,
        func.exported ? "exported" : null,
      ]
        .filter(Boolean)
        .join(", ");

      const ret = func.returnType
        ? `: ${func.returnType.typeAnnotation?.type || "unknown"}`
        : "";
      const meta = flags ? ` [${flags}]` : "";
      lines.push(`- ${func.name}(${func.params.join(", ")})${ret}${meta}`);
    }
  }

  if (structure.classes.length) {
    lines.push(`\n## Classes:`);
    for (const cls of structure.classes) {
      const ext = cls.superClass ? ` extends ${cls.superClass}` : "";
      const exp = cls.exported ? "exported " : "";
      lines.push(`- ${exp}class ${cls.name}${ext}`);

      for (const m of cls.methods) {
        const flags = [
          m.static ? "static" : null,
          m.abstract ? "abstract" : null,
          m.access != "public" ? m.access : null,
        ]
          .filter(Boolean)
          .join(", ");
        lines.push(
          `  - ${m.name}(${m.params.join(", ")})${m.returnType ? `: ${m.returnType.typeAnnotation?.type || "unknown"}` : ""}${flags ? ` [${flags}]` : ""}`,
        );
      }
    }
  }

  if (structure.types.length) {
    lines.push(`\n## Types:`);
    for (const type of structure.types) {
      const members = type.members
        .map(
          (m: any) =>
            `  - ${m.name}: ${m.typeAnnotation?.typeAnnotation?.type || "unknown"}`,
        )
        .join("\n");
      lines.push(
        `- type ${type.kind} ${type.name} {\n${members}\n} line ${type.line}`,
      );
    }
  }

  if (structure.variables.length) {
    lines.push(`\n## Variables:`);
    for (const variable of structure.variables) {
      const exp = variable.exported ? " [exported] " : "";

      lines.push(
        `- ${variable.kind} ${variable.name}${exp} line ${variable.line}`,
      );
    }
  }

  if (structure.exports.length) {
    lines.push(`\n## Exports:`);
    lines.push(`- ${structure.exports.join(", ")}`);
  }

  return lines.join("\n");
}

// 1- Fast codebase understanding
// 2- Codebase navigation
// 3- Dependency analysis

export const astAnalysisTool = tool(
  async ({ filePath }) => {
    try {
      const safeFilePath = safePath(filePath);
      const content = await fs.readFile(safeFilePath, "utf-8");
      const ext = path.extname(filePath).toLocaleLowerCase();

      const isTS = ext === ".ts" || ext === ".tsx";
      const isJSX = ext === ".jsx" || ext === ".tsx";

      const plugins: any = [
        ...(isTS ? ["typescript"] : []),
        ...(isJSX ? ["jsx"] : []),
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "objectRestSpread",
        "optionalChaining",
        "nullishCoalescingOperator",
      ];
      const ast = parse(content, {
        sourceType: "module",
        plugins,
      });
      const structure = extractStructureFromAST(ast);
      return renderStructure(filePath, structure);
    } catch (err: Error | any) {
      return `Error processing file ${filePath}: ${err.message}`;
    }
  },
  {
    name: "ast_analysis",
    description:
      "Analyze the AST of a JavaScript/TypeScript file and extract its structure." +
      "imports, exports, function declarations, variable declarations, class declarations, type declarations" +
      "Typescript interfaces and type aliases should be included in the output under a 'Types' section, with their members listed.",
    schema: z.object({
      filePath: z.string().describe("The path to the file to analyze."),
    }),
  },
);

// Test: uncomment and run with `npm run file`
// async function testMain() {
//   const res = await astAnalysisTool.invoke({ filePath: "human-in-loop/ast.ts" });
//   console.log("Res: ", res);
// }
// testMain();