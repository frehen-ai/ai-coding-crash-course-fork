// Pinned to en-US so server and browser render identical text.
const countFormat = new Intl.NumberFormat("en-US");

export function pluralize(
  count: number,
  singular: string,
  plural: string = `${singular}s`
): string {
  return `${countFormat.format(count)} ${count === 1 ? singular : plural}`;
}
