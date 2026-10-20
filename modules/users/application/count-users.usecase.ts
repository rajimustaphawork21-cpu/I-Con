import type { UserRepository } from "../domain/user.repository";

export class CountUsersUseCase {
  private readonly userRepository: UserRepository;

  constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  async execute(): Promise<number> {
    return this.userRepository.count();
  }
}
