import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    const available = await this.versionsRepository
      .createQueryBuilder('version')
      .innerJoin('version.survey', 'survey')
      .select('survey.code', 'code')
      .addSelect('survey.name', 'name')
      .addSelect('survey.description', 'description')
      .addSelect('version.versionNumber', 'versionNumber')
      .addSelect('version.title', 'versionTitle')
      .addSelect('version.publishedAt', 'publishedAt')
      .distinctOn(['version.surveyId'])
      .where('survey.isActive = true')
      .andWhere('version.status = :status', {
        status: SurveyVersionStatus.Published,
      })
      .orderBy('version.surveyId', 'ASC')
      .addOrderBy('version.versionNumber', 'DESC')
      .getRawMany<{
        code: string;
        name: string;
        description: string | null;
        versionNumber: number;
        versionTitle: string;
        publishedAt: Date;
      }>();

    return available.sort((first, second) =>
      first.name.localeCompare(second.name, 'es'),
    );
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
                score: option.score,
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
