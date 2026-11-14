import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

// Guards against count labels that bypass `pluralize` (app/lib/pluralize.ts).

const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const PLURAL_NOUNS = [
  "lessons",
  "students",
  "courses",
  "users",
  "categories",
  "quizzes",
  "ratings",
  "seats",
  "links",
  "days",
  "modules",
];

const LEADING_PLURAL_NOUN = new RegExp(
  String.raw`^\s*\b(?:${PLURAL_NOUNS.join("|")})\b`,
  "i"
);

// Files that still hand-roll count labels. Remove entries as files migrate
// to `pluralize`; delete this mechanism once the list is empty.
const KNOWN_EXCEPTIONS: string[] = [
  "app/routes/admin.categories.tsx",
  "app/routes/admin.courses.tsx",
  "app/routes/admin.users.tsx",
  "app/routes/instructor.$courseId.modules.$moduleId.tsx",
  "app/routes/instructor.$courseId.students.tsx",
  "app/routes/instructor.$courseId.tsx",
  "app/routes/instructor.questions.tsx",
  "app/routes/instructor.tsx",
  "app/services/categoryService.ts",
];

type Violation = { line: number; text: string; pattern: string };

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression)
    ? unwrap(expression.expression)
    : expression;
}

// Read literal label text through parentheses, JSX wrappers and fragments.
// Dynamic branches remain unknown, so they cannot silently bypass the guard.
function labelText(node: ts.Node): string | undefined {
  if (ts.isParenthesizedExpression(node)) return labelText(node.expression);
  if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) return node.text;
  if (ts.isJsxExpression(node)) {
    return node.expression ? labelText(node.expression) : "";
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const parts = node.children.map(labelText);
    return parts.every((part) => part !== undefined) ? parts.join("") : undefined;
  }
  return undefined;
}

function isPluralChoice(singular: string, plural: string): boolean {
  const irregular: Record<string, string> = {
    person: "people",
    child: "children",
    man: "men",
    woman: "women",
    mouse: "mice",
    goose: "geese",
    foot: "feet",
    tooth: "teeth",
    ox: "oxen",
  };
  // Suffix choices ("" / "s") are labels too. Otherwise compare words,
  // not whole phrases: the label may continue with e.g. "lessons completed".
  if (!singular.trim()) return /^(s|es)$/i.test(plural.trim());
  const singularWords = singular.toLowerCase().match(/[a-z]+/g) ?? [];
  const pluralWords = plural.toLowerCase().match(/[a-z]+/g) ?? [];
  return singularWords.some((one) =>
    pluralWords.some((many) =>
      many === `${one}s` ||
      many === `${one}es` ||
      (/y$/.test(one) && many === `${one.slice(0, -1)}ies`) ||
      (/z$/.test(one) && many === `${one}zes`) ||
      (/fe?$/.test(one) && many === one.replace(/fe?$/, "ves")) ||
      (/sis$/.test(one) && many === one.replace(/sis$/, "ses")) ||
      many === irregular[one]
    )
  );
}

function findCountLabelViolations(
  source: string,
  fileName = "source.tsx"
): Violation[] {
  // Syntax distinguishes rendered text from declarations/comments without
  // treating punctuation in a real label as a reason to ignore it.
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  function report(start: number, end: number, pattern: string) {
    violations.push({
      line: tree.getLineAndCharacterOfPosition(start).line + 1,
      text: source.slice(start, end).replace(/\s+/g, " ").trim(),
      pattern,
    });
  }
  function visit(node: ts.Node) {
    if (ts.isConditionalExpression(node)) {
      const condition = unwrap(node.condition);
      if (
        ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isNumericLiteral(unwrap(condition.right)) &&
        unwrap(condition.right).getText(tree) === "1"
      ) {
        const one = labelText(node.whenTrue);
        const many = labelText(node.whenFalse);
        const nonTextLiterals = [node.whenTrue, node.whenFalse].every((branch) =>
          [
            ts.SyntaxKind.NumericLiteral,
            ts.SyntaxKind.BigIntLiteral,
            ts.SyntaxKind.TrueKeyword,
            ts.SyntaxKind.FalseKeyword,
            ts.SyntaxKind.NullKeyword,
          ].includes(unwrap(branch).kind)
        );
        if (
          !nonTextLiterals &&
          (one === undefined || many === undefined || isPluralChoice(one, many))
        ) {
          report(
            condition.operatorToken.getStart(tree),
            node.colonToken.end,
            "hand-written singular/plural choice"
          );
        }
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      node.children.forEach((child, index) => {
        if (!ts.isJsxExpression(child) || !child.expression) return;
        // A literal spacer is not itself a count.
        const text = labelText(child);
        if (text !== undefined && !text.trim()) return;
        for (const next of node.children.slice(index + 1)) {
          if (ts.isJsxText(next)) {
            const raw = source.slice(next.pos, next.end);
            const match = raw.match(LEADING_PLURAL_NOUN);
            if (match) {
              report(
                child.end - 1,
                next.pos + match[0].length,
                "count followed by a hardcoded plural noun"
              );
            }
            if (raw.trim()) break;
          } else if (ts.isJsxExpression(next) && labelText(next)?.trim() === "") {
            continue;
          } else break;
        }
      });
    }
    if (ts.isTemplateSpan(node)) {
      const match = node.literal.text.match(LEADING_PLURAL_NOUN);
      if (match) {
        const start = node.literal.getStart(tree);
        report(
          start,
          start + 1 + match[0].length,
          "count followed by a hardcoded plural noun"
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations.sort((a, b) => a.line - b.line);
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
  });
}

function isScanned(relativePath: string): boolean {
  return (
    !/\.test\.tsx?$/.test(relativePath) &&
    !relativePath.startsWith("app/test/") &&
    relativePath !== "app/lib/pluralize.ts"
  );
}

function scanApp(): Map<string, Violation[]> {
  const result = new Map<string, Violation[]>();
  for (const file of listSourceFiles(APP_DIR)) {
    const relativePath = `app/${path.relative(APP_DIR, file).split(path.sep).join("/")}`;
    if (!isScanned(relativePath)) continue;
    const violations = findCountLabelViolations(
      fs.readFileSync(file, "utf8"),
      file
    );
    if (violations.length > 0) result.set(relativePath, violations);
  }
  return result;
}

describe("findCountLabelViolations", () => {
  it("flags an inline singular/plural choice", () => {
    const source = `<p>{n} {n === 1 ? "lesson" : "lessons"}</p>`;
    expect(findCountLabelViolations(source)).toEqual([
      expect.objectContaining({ line: 1, text: `=== 1 ? "lesson" :` }),
    ]);
  });

  it("flags a singular/plural choice split across lines", () => {
    const source = `<p>\n  {n}{" "}\n  {n === 1\n    ? "lesson"\n    : "lessons"}\n</p>`;
    expect(findCountLabelViolations(source)).toEqual([
      expect.objectContaining({ line: 3, text: `=== 1 ? "lesson" :` }),
    ]);
  });

  it("flags a suffix choice in a template literal", () => {
    const source = 'const s = `${d} day${d === 1 ? "" : "s"}`;';
    expect(findCountLabelViolations(source)).toHaveLength(1);
  });

  it.each([
    `<p>{n} {n === 1 ? ("lesson") : ("lessons")}</p>`,
    `<p>{n} {n === 1 ? <span>lesson</span> : <span>lessons</span>}</p>`,
    `<p>{n} {n === 1 ? <>category</> : <>categories</>}</p>`,
    `<p>{n} {n === 1 ? singular : plural}</p>`,
    `<p>{n} {n === 1 /* count */ ? "quiz" : "quizzes"}</p>`,
    `<p>{n} {n === 1 ? "person" : "people"}</p>`,
    `<p>{n} {n === 1 ? "child" : "children"}</p>`,
    `<p>{n} {n === 1 ? "lesson completed" : "lessons completed"}</p>`,
    `<p>{n} {n === 1 ? "quiz remaining" : "quizzes remaining"}</p>`,
    `<p>{n} {n === 1 ? <b>person enrolled</b> : <b>people enrolled</b>}</p>`,
    `<p>{n} {n === 1 ? "leaf" : "leaves"}</p>`,
  ])("flags nontrivial singular/plural choices: %s", (source) => {
    expect(findCountLabelViolations(source)).toHaveLength(1);
  });

  it.each([": available now", " (active)", " = total", ".Next"])(
    "flags rendered labels followed by punctuation: %s",
    (suffix) => {
      expect(findCountLabelViolations(`<p>{n} students${suffix}</p>`)).toHaveLength(
        1
      );
      expect(
        findCountLabelViolations('`${n} students' + suffix + '`')
      ).toHaveLength(1);
    }
  );

  it.each([
    `<p>{step === 1 ? "Introduction" : "Summary"}</p>`,
    `<p>{step === 1 ? <b>Introduction</b> : <b>Summary</b>}</p>`,
    `const columns = n === 1 ? 2 : 3;`,
    `const enabled = n === 1 ? true : false;`,
    `// n === 1 ? "lesson" : "lessons"`,
    `// {n} lessons`,
    `const example = '{n} lessons';`,
    `if (ready) {}\nlessons++;`,
  ])("ignores unrelated code and non-rendered examples: %s", (source) => {
    expect(findCountLabelViolations(source)).toEqual([]);
  });

  it.each(PLURAL_NOUNS)("flags a count followed by %s", (noun) => {
    expect(findCountLabelViolations(`<p>{count} ${noun}</p>`)).toHaveLength(1);
  });

  it("flags a count followed by a noun in a template literal", () => {
    expect(findCountLabelViolations("`${count} students`")).toHaveLength(1);
  });

  it("flags a count followed by a spacer and a noun on the next line", () => {
    const source = `<span>\n  {done} / {total}{" "}\n  lessons\n</span>`;
    expect(findCountLabelViolations(source)).toEqual([
      expect.objectContaining({ line: 2, text: `}{" "} lessons` }),
    ]);
  });

  it("flags a noun that ends a sentence", () => {
    expect(findCountLabelViolations(`<p>You have {n} seats.</p>`)).toHaveLength(
      1
    );
  });

  it("ignores pluralize calls and unrelated code", () => {
    const source = [
      `<p>{pluralize(n, "lesson")}</p>`,
      `const { lessons } = course;`,
      `type T = { modules: Array<{ id: number }>; lessons: number };`,
      `if (n === 1) return;`,
      `}\nlessons.map((l) => l.id);`,
    ].join("\n");
    expect(findCountLabelViolations(source)).toEqual([]);
  });
});

describe("count label guard", () => {
  const violationsByFile = scanApp();

  it("finds no hand-rolled count labels outside the known exceptions", () => {
    const report = [...violationsByFile]
      .filter(([file]) => !KNOWN_EXCEPTIONS.includes(file))
      .flatMap(([file, violations]) =>
        violations.map((v) => `  ${file}:${v.line}  ${v.text}  (${v.pattern})`)
      );
    expect(
      report,
      `Hand-rolled count labels found. Use pluralize from ~/lib/pluralize instead:\n${report.join("\n")}\n`
    ).toEqual([]);
  });

  it("lists only files that still violate", () => {
    const stale = KNOWN_EXCEPTIONS.filter(
      (file) => !violationsByFile.has(file)
    );
    expect(
      stale,
      `These files no longer hand-roll count labels. Remove them from KNOWN_EXCEPTIONS in app/lib/count-labels.test.ts:\n${stale.join("\n")}\n`
    ).toEqual([]);
  });
});
