import { describe, it, expect } from "vitest";
import { pluralize } from "./pluralize";

describe("pluralize", () => {
  it("uses the singular for a count of 1", () => {
    expect(pluralize(1, "lesson")).toBe("1 lesson");
  });

  it("uses the default plural for a count of 0", () => {
    expect(pluralize(0, "lesson")).toBe("0 lessons");
  });

  it("uses the default plural for counts above 1", () => {
    expect(pluralize(5, "lesson")).toBe("5 lessons");
  });

  it("uses the given plural when provided", () => {
    expect(pluralize(2, "person", "people")).toBe("2 people");
  });

  it("ignores the given plural for a count of 1", () => {
    expect(pluralize(1, "person", "people")).toBe("1 person");
  });
});
