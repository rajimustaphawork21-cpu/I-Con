const MAX_SEARCH_LENGTH = 256;

export function normalizeUsersSearch(
  value: unknown,
  invalid: (message: string) => Error,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw invalid("The search value must be a string.");
  }

  const search = value.trim();

  if (search.length === 0) {
    return undefined;
  }

  if (search.length > MAX_SEARCH_LENGTH) {
    throw invalid(
      `The search value must not exceed ${MAX_SEARCH_LENGTH} characters.`,
    );
  }

  return search;
}
