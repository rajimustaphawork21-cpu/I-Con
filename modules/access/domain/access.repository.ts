export interface SubjectAccess {
  readonly subject: string;
  readonly enabled: boolean;
  readonly directClientRoles: readonly string[];
}

export interface AccessRepository {
  resolveBySubject(subject: string): Promise<SubjectAccess | null>;
}
