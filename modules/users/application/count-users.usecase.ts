import type {
  CountUsersQuery,
  UserRepository,
} from "../domain/user.repository";
import { normalizeUsersSearch } from "./user-query.validation";

export class InvalidCountUsersQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCountUsersQueryError";
  }
}

export class CountUsersUseCase {
  private readonly userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(query: CountUsersQuery = {}): Promise<number> {
    const search = normalizeUsersSearch(
      query.search,
      message => new InvalidCountUsersQueryError(message),
    );

    return this.userRepository.count(search === undefined ? {} : { search });
  }
}
