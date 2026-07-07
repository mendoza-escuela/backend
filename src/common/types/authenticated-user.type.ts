import { UserRole } from '../../modules/users/entities/user-role.enum';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};
