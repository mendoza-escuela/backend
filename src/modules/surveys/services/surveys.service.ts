import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SurveyVersionStatus } from '../entities/survey-version-status.enum';
import { SurveyVersion } from '../entities/survey-version.entity';
import { Survey } from '../entities/survey.entity';

@Injectable()
export class SurveysService {
  constructor(
    @InjectRepository(Survey)
    private readonly surveysRepository: Repository<Survey>,
    @InjectRepository(SurveyVersion)
    private readonly versionsRepository: Repository<SurveyVersion>,
  ) {}

  /** Lista cuestionarios activos que cuentan con una versión publicada. */
  async listAvailable() {
    const surveys = await this.surveysRepository.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });

    if (surveys.length === 0) return [];

    const versions = await this.versionsRepository.find({
      where: {
        surveyId: In(surveys.map((survey) => survey.id)),
        status: SurveyVersionStatus.Published,
      },
      order: { versionNumber: 'DESC' },
    });
    const latestVersions = new Map<string, SurveyVersion>();
    for (const version of versions) {
      if (!latestVersions.has(version.surveyId))
        latestVersions.set(version.surveyId, version);
    }

    const available = surveys.map((survey) => {
      const version = latestVersions.get(survey.id);
      return version
        ? {
            code: survey.code,
            name: survey.name,
            description: survey.description,
            versionNumber: version.versionNumber,
            versionTitle: version.title,
            publishedAt: version.publishedAt,
          }
        : null;
    });

    return available.filter((survey) => survey !== null);
  }

  /**
   * Devuelve exclusivamente contenido publicado y ordenado para el
   * renderizador. Las versiones borrador nunca se exponen a las escuelas.
   */
  async findAvailableByCode(code: string) {
    const survey = await this.surveysRepository.findOneBy({
      code,
      isActive: true,
    });
    if (!survey) throw new NotFoundException('Cuestionario no encontrado.');

    const version = await this.findLatestPublishedVersion(survey.id);
    if (!version)
      throw new NotFoundException(
        'El cuestionario todavía no tiene una versión publicada.',
      );

    return {
      code: survey.code,
      name: survey.name,
      description: survey.description,
      version: {
        id: version.id,
        versionNumber: version.versionNumber,
        title: version.title,
        instructions: version.instructions,
        publishedAt: version.publishedAt,
        dimensions: version.dimensions.map((dimension) => ({
          id: dimension.id,
          code: dimension.code,
          title: dimension.title,
          description: dimension.description,
          order: dimension.order,
          sections: dimension.sections.map((section) => ({
            id: section.id,
            code: section.code,
            title: section.title,
            description: section.description,
            order: section.order,
            questions: section.questions.map((question) => ({
              id: question.id,
              code: question.code,
              type: question.type,
              prompt: question.prompt,
              helpText: question.helpText,
              required: question.required,
              order: question.order,
              validation: question.validation,
              options: question.options.map((option) => ({
                id: option.id,
                value: option.value,
                label: option.label,
                helpText: option.helpText,
                order: option.order,
              })),
            })),
          })),
        })),
      },
    };
  }

  private findLatestPublishedVersion(surveyId: string) {
    return this.versionsRepository.findOne({
      where: {
        surveyId,
        status: SurveyVersionStatus.Published,
      },
      relations: {
        dimensions: {
          sections: {
            questions: { options: true },
          },
        },
      },
      order: {
        versionNumber: 'DESC',
        dimensions: {
          order: 'ASC',
          sections: {
            order: 'ASC',
            questions: {
              order: 'ASC',
              options: { order: 'ASC' },
            },
          },
        },
      },
    });
  }
}
