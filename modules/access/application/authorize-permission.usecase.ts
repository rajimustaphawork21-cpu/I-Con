import type { AccessRepository } from "../domain/access.repository";
import {
  hasUsersPermission,
  type UsersPermission,
} from "../domain/permission-policy";

export class AccessDeniedError extends Error {
  constructor() {
    super("Access denied.");
    this.name = "AccessDeniedError";
  }
}

export class AuthorizePermissionUseCase {
  private readonly accessRepository: AccessRepository;

  constructor(accessRepository: AccessRepository) {
    this.accessRepository = accessRepository;
  }

  async execute(subject: string, permission: UsersPermission): Promise<void> {
    if (typeof subject !== "string" || subject.trim().length === 0) {
      throw new AccessDeniedError();
    }

    const access = await this.accessRepository.resolveBySubject(subject);

    if (
      !access ||
      access.subject !== subject ||
      !access.enabled ||
      !hasUsersPermission(access.directClientRoles, permission)
    ) {
      throw new AccessDeniedError();
    }
  }
}
