import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const PATTERNS = [
  {
    name: "hand-written singular/plural choice",
    // `x === 1 ? "lesson" : "lessons"`, also when split across lines.
    regex: /===\s*1\s*\?\s*(["'`])[^"'`]*\1\s*:/g,
  },
  {
    name: "count followed by a hardcoded plural noun",
    // `{count} lessons`, `${count} lessons`, `{count}{" "}\n lessons`.
    regex: new RegExp(
      String.raw`\}(?:\s*\{\s*(["'\`]) \1\s*\})?[ \t\r\n]*\b(?:${PLURAL_NOUNS.join("|")})\b(?!\s*[:=(]|\.\w)`,
      "g"
    ),
  },
];

// Files that still hand-roll count labels. Remove entries as files migrate
// to `pluralize`; delete this mechanism once the list is empty.
const KNOWN_EXCEPTIONS: string[] = [
  "app/components/star-rating.tsx",
  "app/routes/admin.categories.tsx",
  "app/routes/admin.courses.tsx",
  "app/routes/admin.users.tsx",
  "app/routes/courses.$slug.$moduleId.tsx",
  "app/routes/courses.$slug.purchase.tsx",
  "app/routes/courses.$slug.tsx",
  "app/routes/courses.tsx",
  "app/routes/dashboard.tsx",
  "app/routes/home.tsx",
  "app/routes/instructor.$courseId.modules.$moduleId.tsx",
  "app/routes/instructor.$courseId.students.tsx",
  "app/routes/instructor.$courseId.tsx",
  "app/routes/instructor.questions.tsx",
  "app/routes/instructor.tsx",
  "app/services/categoryService.ts",
];

type Violation = { line: number; text: string; pattern: string };

function findCountLabelViolations(source: string): Violation[] {
  const violations: Violation[] = [];
  for (const { name, regex } of PATTERNS) {
    for (const match of source.matchAll(regex)) {
      violations.push({
        line: source.slice(0, match.index).split("\n").length,
        text: match[0].replace(/\s+/g, " ").trim(),
        pattern: name,
      });
    }
  }
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
    const violations = findCountLabelViolations(fs.readFileSync(file, "utf8"));
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
