import { Controller, Get } from '@nestjs/common';
import { HealthService } from '../services/health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getStatus() {
    return this.healthService.getStatus();
  }

  @Get('database')
  getDatabaseStatus() {
    return this.healthService.getDatabaseStatus();
  }
}
