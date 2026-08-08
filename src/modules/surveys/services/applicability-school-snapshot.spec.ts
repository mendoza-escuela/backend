import { DataSource } from 'typeorm';
import { ApplicabilityRulesService } from './applicability-rules.service';
import { ApplicabilityEngine } from './applicability-engine.service';

describe('Contexto escolar del motor condicional', () => {
  const service = new ApplicabilityRulesService(
    {} as DataSource,
    new ApplicabilityEngine(),
  );

  it('lee códigos estables y distingue false, cero y null', () => {
    expect(
      service.factsFromSnapshot({
        name: 'Escuela',
        cue: '500012300',
        directorName: 'Ana',
        address: 'Calle 1',
        locality: 'Mendoza',
        scope: 'Urbano',
        educationLevel: 'Texto heredado',
        shift: 'Texto heredado',
        hasKiosk: false,
        hasFoodService: true,
        isBoarding: null,
        shiftCatalog: {
          id: 'shift-id',
          code: 'jornada_completa',
          label: 'Jornada completa',
        },
        educationLevels: [
          {
            id: 'level-id',
            code: 'primario',
            label: 'Primario',
            enrollment: 0,
          },
        ],
        enrollmentTotal: 0,
      }),
    ).toEqual({
      has_kiosk: false,
      has_food_service: true,
      is_boarding: null,
      shift: 'jornada_completa',
      education_levels: ['primario'],
      enrollment_total: 0,
    });
  });

  it('no infiere datos estructurados desde textos de snapshots legados', () => {
    expect(
      service.factsFromSnapshot({
        name: 'Escuela',
        cue: '500012300',
        directorName: 'Ana',
        address: 'Calle 1',
        locality: 'Mendoza',
        scope: 'Urbano',
        educationLevel: 'Primario, Secundario',
        shift: 'Completa albergue',
      }),
    ).toEqual({
      has_kiosk: null,
      has_food_service: null,
      is_boarding: null,
      shift: null,
      education_levels: null,
      enrollment_total: null,
    });
  });
});
