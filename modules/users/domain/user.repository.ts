import type { User } from "./user.type";

export interface ListUsersQuery {
  readonly first: number;
  readonly max: number;
  readonly search?: string;
}

export interface UserRepository {
  list(query: ListUsersQuery): Promise<User[]>;
  count(): Promise<number>;
}
