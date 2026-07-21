import { PartialType } from '@nestjs/mapped-types';
import { SchoolFieldsDto } from './school-fields.dto';

export class UpdateSchoolDto extends PartialType(SchoolFieldsDto) {}
