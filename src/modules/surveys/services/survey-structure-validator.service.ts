import { BadRequestException, Injectable } from '@nestjs/common';
import { SurveyDimensionInputDto } from '../dto/update-survey-version.dto';
import { SurveyQuestionType } from '../entities/survey-question-type.enum';

@Injectable()
export class SurveyStructureValidator {
  /**
   * Valida únicamente consistencia estructural. No introduce puntajes,
   * condiciones, exclusiones ni ninguna otra regla funcional pendiente.
   */
  validate(dimensions: SurveyDimensionInputDto[], requireContent = false) {
    const errors = this.inspect(dimensions, requireContent);
    if (errors.length)
      throw new BadRequestException({
        message: errors[0],
        errors,
      });
  }

  /** Devuelve todos los errores para que la interfaz pueda corregirlos en conjunto. */
  inspect(dimensions: SurveyDimensionInputDto[], requireContent = false) {
    const errors: string[] = [];
    if (requireContent && dimensions.length === 0)
      errors.push('La versión debe contener al menos una dimensión.');

    this.assertUniqueCodes(
      dimensions.map((dimension) => dimension.code),
      'dimensión',
      errors,
    );

    for (const dimension of dimensions) {
      const dimensionPath = `Dimensión ${dimension.code}`;
      if (requireContent && dimension.sections.length === 0)
        errors.push(`${dimensionPath}: debe contener al menos una sección.`);
      this.assertUniqueCodes(
        dimension.sections.map((section) => section.code),
        `sección en ${dimension.code}`,
        errors,
      );

      for (const section of dimension.sections) {
        const sectionPath = `${dimensionPath} / sección ${section.code}`;
        if (requireContent && section.questions.length === 0)
          errors.push(`${sectionPath}: debe contener al menos una pregunta.`);
        this.assertUniqueCodes(
          section.questions.map((question) => question.code),
          `pregunta en ${dimension.code}/${section.code}`,
          errors,
        );

        for (const question of section.questions) {
          const questionPath = `${sectionPath} / pregunta ${question.code}`;
          const isChoice = [
            SurveyQuestionType.SingleChoice,
            SurveyQuestionType.MultipleChoice,
          ].includes(question.type);
          if (requireContent && isChoice && question.options.length === 0)
            errors.push(`${questionPath}: debe tener al menos una opción.`);
          if (!isChoice && question.options.length > 0)
            errors.push(
              `${questionPath}: el tipo ${question.type} no admite opciones configuradas.`,
            );
          this.assertUniqueCodes(
            question.options.map((option) => option.value),
            `opción en ${question.code}`,
            errors,
          );

          const validation = question.validation ?? {};
          const isText = [
            SurveyQuestionType.ShortText,
            SurveyQuestionType.LongText,
          ].includes(question.type);
          if (
            (validation.min !== undefined || validation.max !== undefined) &&
            question.type !== SurveyQuestionType.Number
          )
            errors.push(
              `${questionPath}: mínimo y máximo sólo corresponden al tipo número.`,
            );
          if (
            (validation.minLength !== undefined ||
              validation.maxLength !== undefined) &&
            !isText
          )
            errors.push(
              `${questionPath}: las longitudes sólo corresponden a preguntas de texto.`,
            );
          if (
            validation.placeholder !== undefined &&
            validation.placeholder !== '' &&
            !isText &&
            question.type !== SurveyQuestionType.Number
          )
            errors.push(
              `${questionPath}: el placeholder sólo corresponde a preguntas de texto o número.`,
            );
          if (
            validation.min !== undefined &&
            validation.max !== undefined &&
            validation.min > validation.max
          )
            errors.push(
              `${questionPath}: el mínimo no puede superar al máximo.`,
            );
          if (
            validation.minLength !== undefined &&
            validation.maxLength !== undefined &&
            validation.minLength > validation.maxLength
          )
            errors.push(
              `${questionPath}: la longitud mínima no puede superar a la máxima.`,
            );
          if (
            validation.maxSelections !== undefined &&
            question.type !== SurveyQuestionType.MultipleChoice
          )
            errors.push(
              `${questionPath}: el máximo de selecciones sólo corresponde a selección múltiple.`,
            );
          if (
            validation.maxSelections !== undefined &&
            validation.maxSelections > question.options.length
          )
            errors.push(
              `${questionPath}: el máximo de selecciones supera la cantidad de opciones.`,
            );
        }
      }
    }

    return errors;
  }

  private assertUniqueCodes(codes: string[], label: string, errors: string[]) {
    const normalized = codes.map((code) => code.trim().toLowerCase());
    const duplicates = normalized.filter(
      (code, index) => normalized.indexOf(code) !== index,
    );
    for (const duplicate of new Set(duplicates))
      errors.push(`El código de ${label} “${duplicate}” está repetido.`);
  }
}
