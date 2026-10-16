export interface User {
  readonly id: string;
  readonly username: string;
  readonly enabled: boolean;
  readonly email?: string;
}
