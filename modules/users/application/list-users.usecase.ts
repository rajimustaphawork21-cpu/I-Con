import type {
  ListUsersQuery,
  UserRepository,
} from "../domain/user.repository";
import type { User } from "../domain/user.type";
import { normalizeUsersSearch } from "./user-query.validation";

const MAX_PAGE_SIZE = 100;
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

  const search = normalizeUsersSearch(
    query.search,
    message => new InvalidListUsersQueryError(message),
  );

  return search === undefined
    ? { first: query.first, max: query.max }
    : { first: query.first, max: query.max, search };
}
