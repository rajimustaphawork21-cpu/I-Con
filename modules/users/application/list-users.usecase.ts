import type {
  ListUsersQuery,
  UserRepository,
} from "../domain/user.repository";
import type { User } from "../domain/user.type";

const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 256;
const MAX_FIRST_RESULT = 2_147_483_647;

export class InvalidListUsersQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidListUsersQueryError";
  }
}

export class ListUsersUseCase {
  private readonly userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(query: ListUsersQuery): Promise<readonly User[]> {
    const normalizedQuery = normalizeQuery(query);

    return this.userRepository.list(normalizedQuery);
  }
}

function normalizeQuery(query: ListUsersQuery): ListUsersQuery {
  if (
    !Number.isSafeInteger(query.first) ||
    query.first < 0 ||
    query.first > MAX_FIRST_RESULT
  ) {
    throw new InvalidListUsersQueryError(
      `The first result offset must be an integer between 0 and ${MAX_FIRST_RESULT}.`,
    );
  }

  if (
    !Number.isInteger(query.max) ||
    query.max < 1 ||
    query.max > MAX_PAGE_SIZE
  ) {
    throw new InvalidListUsersQueryError(
      `The page size must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }

  if (query.search === undefined) {
    return { first: query.first, max: query.max };
  }

  if (typeof query.search !== "string") {
    throw new InvalidListUsersQueryError("The search value must be a string.");
  }

  const search = query.search.trim();

  if (search.length === 0) {
    return { first: query.first, max: query.max };
  }

  if (search.length > MAX_SEARCH_LENGTH) {
    throw new InvalidListUsersQueryError(
      `The search value must not exceed ${MAX_SEARCH_LENGTH} characters.`,
    );
  }

  return { first: query.first, max: query.max, search };
}
