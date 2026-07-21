import { UserRole } from '../../modules/users/entities/user-role.enum';

export type AuthenticatedUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  sessionId: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
};
