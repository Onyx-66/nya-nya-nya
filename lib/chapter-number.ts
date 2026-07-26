export function normalizeChapterNumber(input: string) {
  const value = input.normalize("NFKC").trim();
  const match = value.match(/^(\d+)(.*)$/);
  if (!match) return value;

  const integer = match[1]!.replace(/^0+(?=\d)/, "");
  return `${integer}${match[2] ?? ""}`;
}

export function compareChapterNumbers(left: string, right: string) {
  const normalizedLeft = normalizeChapterNumber(left);
  const normalizedRight = normalizeChapterNumber(right);
  const leftMatch = normalizedLeft.match(/^(\d+(?:\.\d+)?)(.*)$/);
  const rightMatch = normalizedRight.match(/^(\d+(?:\.\d+)?)(.*)$/);

  if (leftMatch && rightMatch) {
    const numericDifference =
      Number(leftMatch[1]) - Number(rightMatch[1]);
    if (numericDifference !== 0) return numericDifference;

    const suffixDifference = leftMatch[2].localeCompare(rightMatch[2], undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (suffixDifference !== 0) return suffixDifference;
  } else if (leftMatch) {
    return -1;
  } else if (rightMatch) {
    return 1;
  }

  return normalizedLeft.localeCompare(normalizedRight, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
