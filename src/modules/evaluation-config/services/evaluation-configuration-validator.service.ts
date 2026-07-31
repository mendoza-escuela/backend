import { BadRequestException, Injectable } from '@nestjs/common';
import type { EvaluationStarRangeInputDto } from '../dto/evaluation-configuration.dto';

@Injectable()
export class EvaluationConfigurationValidator {
  validate(ranges: ReadonlyArray<EvaluationStarRangeInputDto>): void {
    if (ranges.length !== 5)
      throw new BadRequestException(
        'La configuración debe definir exactamente cinco rangos.',
      );
    const ordered = [...ranges].sort((a, b) => a.order - b.order);
    if (
      new Set(ordered.map((range) => range.stars)).size !== 5 ||
      new Set(ordered.map((range) => range.order)).size !== 5
    ) {
      throw new BadRequestException(
        'Cada cantidad de estrellas y cada orden deben aparecer una sola vez.',
      );
    }
    ordered.forEach((range, index) => {
      if (
        range.order !== index + 1 ||
        range.stars !== index + 1 ||
        range.lowerBound > range.upperBound
      ) {
        throw new BadRequestException(
          'Los rangos deben estar ordenados de 1 a 5 estrellas y tener límites coherentes.',
        );
      }
      if (index === 0 && (range.lowerBound !== 0 || !range.lowerInclusive)) {
        throw new BadRequestException(
          'La cobertura debe comenzar incluyendo el valor 0.',
        );
      }
      if (
        index === ordered.length - 1 &&
        (range.upperBound !== 100 || !range.upperInclusive)
      ) {
        throw new BadRequestException(
          'La cobertura debe finalizar incluyendo el valor 100.',
        );
      }
      const previous = ordered[index - 1];
      if (
        previous &&
        (previous.upperBound !== range.lowerBound ||
          previous.upperInclusive === range.lowerInclusive)
      ) {
        throw new BadRequestException(
          'Los rangos deben cubrir 0–100 sin huecos ni superposiciones y con un único límite inclusivo.',
        );
      }
    });
  }
}
