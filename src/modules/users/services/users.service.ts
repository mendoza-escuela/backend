import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id, isActive: true } });
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async recordFailedLogin(
    user: User,
    maxAttempts: number,
    lockMinutes: number,
  ): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= maxAttempts
        ? new Date(Date.now() + lockMinutes * 60_000)
        : null;

    await this.usersRepository.update(user.id, {
      failedLoginAttempts: lockedUntil ? 0 : attempts,
      lockedUntil,
    });
  }

  async recordSuccessfulLogin(userId: string): Promise<Date> {
    const lastLoginAt = new Date();
    await this.usersRepository.update(userId, {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt,
    });
    return lastLoginAt;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepository.update(userId, {
      passwordHash,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }
}
