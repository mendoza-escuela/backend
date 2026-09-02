import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PasswordChangeRequiredGuard } from '../../../common/guards/password-change-required.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { SurveyCodeParamDto } from '../dto/survey-code-param.dto';
import { SurveysService } from '../services/surveys.service';

@Controller('surveys')
@UseGuards(JwtAuthGuard, PasswordChangeRequiredGuard, RolesGuard)
@Roles(UserRole.Admin, UserRole.School)
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get('available')
  listAvailable() {
    return this.surveysService.listAvailable();
  }

  @Get('available/:code')
  findAvailable(@Param() params: SurveyCodeParamDto) {
    return this.surveysService.findAvailableByCode(params.code);
  }
}
