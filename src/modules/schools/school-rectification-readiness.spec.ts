import type { SchoolRectificationSnapshot } from './entities/school-rectification.entity';
import { schoolRectificationReadiness } from './school-rectification-readiness';

describe('schoolRectificationReadiness', () => {
  const completeSnapshot: SchoolRectificationSnapshot = {
    name: 'Escuela Uno',
    cue: '500012300',
    directorName: 'Ana Pérez',
    department: 'Capital',
    address: 'Calle 1',
    locality: 'Mendoza',
    scope: 'Urbano',
    educationLevel: 'Educación común',
    shift: 'Simple',
    shiftCatalog: { id: 'shift-id', code: 'simple', label: 'Simple' },
    educationLevels: [
      {
        id: 'level-id',
        code: 'primario',
        label: 'Primario',
        enrollment: 10,
      },
    ],
    hasKiosk: false,
    hasFoodService: true,
  };

  it('marca como apto un snapshot completo sin exigir gestión', () => {
    expect(schoolRectificationReadiness(completeSnapshot)).toEqual({
      isEvaluationReady: true,
      missingFields: [],
    });
  });

  it('mantiene kiosco y comedor como datos obligatorios', () => {
    const readiness = schoolRectificationReadiness({
      ...completeSnapshot,
      hasKiosk: null,
      hasFoodService: undefined,
    });

    expect(readiness).toEqual({
      isEvaluationReady: false,
      missingFields: [
        { code: 'hasKiosk', label: 'Kiosco' },
        {
          code: 'hasFoodService',
          label: 'Comedor o servicio alimentario',
        },
      ],
    });
  });

  it('identifica datos institucionales y catálogos estructurados faltantes', () => {
    const readiness = schoolRectificationReadiness({
      ...completeSnapshot,
      department: ' ',
      shiftCatalog: null,
      educationLevels: [],
    });

    expect(readiness).toEqual({
      isEvaluationReady: false,
      missingFields: [
        { code: 'department', label: 'Departamento' },
        { code: 'shiftCatalog', label: 'Jornada' },
        { code: 'educationLevels', label: 'Niveles educativos' },
      ],
    });
  });

  it('no inventa faltantes desde la ficha vigente cuando no hay confirmación', () => {
    expect(schoolRectificationReadiness(null)).toEqual({
      isEvaluationReady: false,
      missingFields: [],
    });
  });
});
