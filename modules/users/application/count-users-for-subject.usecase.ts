import type { AuthorizePermissionUseCase } from "../../access/application/authorize-permission.usecase";
import { USERS_PERMISSIONS } from "../../access/domain/permission-policy";
import type { CountUsersQuery } from "../domain/user.repository";
import type { CountUsersUseCase } from "./count-users.usecase";

export class CountUsersForSubjectUseCase {
  private readonly authorize: AuthorizePermissionUseCase;
  private readonly countUsers: CountUsersUseCase;

  constructor(
    authorize: AuthorizePermissionUseCase,
    countUsers: CountUsersUseCase,
  ) {
    this.authorize = authorize;
    this.countUsers = countUsers;
  }

  async execute(subject: string, query: CountUsersQuery): Promise<number> {
    await this.authorize.execute(subject, USERS_PERMISSIONS.count);

    return this.countUsers.execute(query);
  }
}
