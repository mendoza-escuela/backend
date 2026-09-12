import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { MailService } from './services/mail.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
