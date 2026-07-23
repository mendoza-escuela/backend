import { Injectable } from '@nestjs/common';
import { SurveyVersion } from '../entities/survey-version.entity';

export type SurveyVersionChange = {
  type: 'added' | 'removed' | 'modified';
  entityType: 'version' | 'dimension' | 'section' | 'question' | 'option';
  path: string;
  label: string;
  changedFields: string[];
};

type ComparableNode = {
  entityType: SurveyVersionChange['entityType'];
  path: string;
  label: string;
  fields: Record<string, unknown>;
};

@Injectable()
export class SurveyVersionComparator {
  compare(from: SurveyVersion, to: SurveyVersion) {
    const fromNodes = this.flatten(from);
    const toNodes = this.flatten(to);
    const keys = new Set([...fromNodes.keys(), ...toNodes.keys()]);
    const changes: SurveyVersionChange[] = [];

    for (const key of [...keys].sort()) {
      const previous = fromNodes.get(key);
      const current = toNodes.get(key);
      if (!previous && current) {
        changes.push({
          type: 'added',
          entityType: current.entityType,
          path: current.path,
          label: current.label,
          changedFields: [],
        });
      } else if (previous && !current) {
        changes.push({
          type: 'removed',
          entityType: previous.entityType,
          path: previous.path,
          label: previous.label,
          changedFields: [],
        });
      } else if (previous && current) {
        const changedFields = Object.keys({
          ...previous.fields,
          ...current.fields,
        }).filter(
          (field) =>
            JSON.stringify(previous.fields[field]) !==
            JSON.stringify(current.fields[field]),
        );
        if (changedFields.length)
          changes.push({
            type: 'modified',
            entityType: current.entityType,
            path: current.path,
            label: current.label,
            changedFields,
          });
      }
    }

    return {
      fromVersion: this.versionSummary(from),
      toVersion: this.versionSummary(to),
      summary: {
        added: changes.filter((change) => change.type === 'added').length,
        removed: changes.filter((change) => change.type === 'removed').length,
        modified: changes.filter((change) => change.type === 'modified').length,
        total: changes.length,
      },
      changes,
    };
  }

  private flatten(version: SurveyVersion) {
    const nodes = new Map<string, ComparableNode>();
    nodes.set('version', {
      entityType: 'version',
      path: 'versión',
      label: version.title,
      fields: {
        title: version.title,
        instructions: version.instructions,
      },
    });
    for (const dimension of version.dimensions) {
      const dimensionPath = dimension.code;
      nodes.set(`dimension:${dimensionPath}`, {
        entityType: 'dimension',
        path: dimensionPath,
        label: dimension.title,
        fields: {
          title: dimension.title,
          description: dimension.description,
          order: dimension.order,
        },
      });
      for (const section of dimension.sections) {
        const sectionPath = `${dimensionPath}/${section.code}`;
        nodes.set(`section:${sectionPath}`, {
          entityType: 'section',
          path: sectionPath,
          label: section.title,
          fields: {
            title: section.title,
            description: section.description,
            order: section.order,
          },
        });
        for (const question of section.questions) {
          const questionPath = `${sectionPath}/${question.code}`;
          nodes.set(`question:${questionPath}`, {
            entityType: 'question',
            path: questionPath,
            label: question.prompt,
            fields: {
              type: question.type,
              prompt: question.prompt,
              helpText: question.helpText,
              required: question.required,
              order: question.order,
              validation: question.validation,
            },
          });
          for (const option of question.options) {
            const optionPath = `${questionPath}/${option.value}`;
            nodes.set(`option:${optionPath}`, {
              entityType: 'option',
              path: optionPath,
              label: option.label,
              fields: {
                label: option.label,
                helpText: option.helpText,
                order: option.order,
              },
            });
          }
        }
      }
    }
    return nodes;
  }

  private versionSummary(version: SurveyVersion) {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      title: version.title,
      status: version.status,
    };
  }
}
