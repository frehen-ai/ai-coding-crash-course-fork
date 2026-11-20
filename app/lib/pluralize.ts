// Pinned to en-US so server and browser render identical text.
const countFormat = new Intl.NumberFormat("en-US");

export function pluralize(
  count: number,
  singular: string,
  plural: string = `${singular}s`
): string {
  return `${countFormat.format(count)} ${count === 1 ? singular : plural}`;
}

const countWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

export function pluralizeWords(
  count: number,
  singular: string,
  plural: string = `${singular}s`
): string {
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    return pluralize(count, singular, plural);
  }
  return `${countWords[count]} ${count === 1 ? singular : plural}`;
}
