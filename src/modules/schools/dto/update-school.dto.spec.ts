import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSchoolDto } from './update-school.dto';

describe('UpdateSchoolDto', () => {
  it('rechaza cambios de estado por el endpoint genérico de edición', async () => {
    const dto = plainToInstance(UpdateSchoolDto, {
      name: 'Escuela actualizada',
      isActive: false,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map(({ property }) => property)).toEqual(['isActive']);
  });
});
