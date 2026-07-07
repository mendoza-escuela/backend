import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  getStatus() {
    return {
      status: 'ok' as const,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  async getDatabaseStatus() {
    const startedAt = Date.now();
    await this.dataSource.query('SELECT 1');

    return {
      status: 'ok' as const,
      database: 'postgres' as const,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    };
  }
}
