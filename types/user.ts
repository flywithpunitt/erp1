export type UserRole = "ADMIN" | "MANAGER";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt?: string | Date;
}


