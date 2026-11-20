import { describe, it, expect } from "vitest";
import { pluralize, pluralizeWords } from "./pluralize";

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

describe("pluralize thousands separators", () => {
  it("leaves counts below 1,000 unseparated", () => {
    expect(pluralize(999, "lesson")).toBe("999 lessons");
  });

  it("separates a count of 1,000", () => {
    expect(pluralize(1000, "lesson")).toBe("1,000 lessons");
  });

  it("separates counts with a custom plural", () => {
    expect(pluralize(1234, "person", "people")).toBe("1,234 people");
  });

  it("separates every group of thousands", () => {
    expect(pluralize(1234567, "lesson")).toBe("1,234,567 lessons");
  });
});

describe("pluralizeWords", () => {
  it("writes zero as a word with the plural", () => {
    expect(pluralizeWords(0, "item")).toBe("zero items");
  });

  it("writes one as a word with the singular", () => {
    expect(pluralizeWords(1, "item")).toBe("one item");
  });

  it("writes counts up to ten as words", () => {
    expect(pluralizeWords(3, "item")).toBe("three items");
    expect(pluralizeWords(10, "item")).toBe("ten items");
  });

  it("uses the given plural", () => {
    expect(pluralizeWords(2, "person", "people")).toBe("two people");
  });

  it("falls back to digits above ten", () => {
    expect(pluralizeWords(11, "item")).toBe("11 items");
    expect(pluralizeWords(1000, "person", "people")).toBe("1,000 people");
  });

  it("falls back to digits for non-integers", () => {
    expect(pluralizeWords(2.5, "item")).toBe("2.5 items");
  });

  it("falls back to digits for negative counts", () => {
    expect(pluralizeWords(-1, "item")).toBe("-1 items");
  });
});
