import type { AuthorizePermissionUseCase } from "../../access/application/authorize-permission.usecase";
import { USERS_PERMISSIONS } from "../../access/domain/permission-policy";
import type { ListUsersQuery } from "../domain/user.repository";
import type { User } from "../domain/user.type";
import type { ListUsersUseCase } from "./list-users.usecase";

export class ListUsersForSubjectUseCase {
  private readonly authorize: AuthorizePermissionUseCase;
  private readonly listUsers: ListUsersUseCase;

  constructor(
    authorize: AuthorizePermissionUseCase,
    listUsers: ListUsersUseCase,
  ) {
    this.authorize = authorize;
    this.listUsers = listUsers;
  }

  async execute(
    subject: string,
    query: ListUsersQuery,
  ): Promise<readonly User[]> {
    await this.authorize.execute(subject, USERS_PERMISSIONS.list);

    return this.listUsers.execute(query);
  }
}
