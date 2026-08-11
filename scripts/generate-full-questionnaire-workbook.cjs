require('reflect-metadata');

const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const {
  OFFICIAL_GENERAL_SCORE_PROFILE,
  OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE,
  OFFICIAL_UNRESOLVED_P038_CODE,
  OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES,
  getApprovedOfficialQuestionScoreSequence,
  getOfficialScoreProfile,
} = require('../src/modules/surveys/policies/official-survey-scoring.policy.ts');

const OUTPUT_PATH = path.resolve(
  __dirname,
  '../docs/plantilla-cuestionario-completo.xlsx',
);

const HEADERS = [
  'dimension_codigo',
  'seccion_codigo',
  'seccion',
  'pregunta_codigo',
  'pregunta',
  'texto_ayuda',
  'opcion_codigo',
  'opcion',
  'puntaje',
  'obligatoria',
  'orden',
  'condicion',
];

const DIMENSIONS = [
  {
    code: 'compromiso_institucional',
    title: 'Compromiso Institucional y Planificación Estratégica',
  },
  {
    code: 'articulacion_equipos_salud',
    title: 'Articulación con los Equipos de Salud',
  },
  {
    code: 'entorno_alimentario',
    title: 'Entorno Alimentario Seguro y Saludable',
  },
  {
    code: 'actividad_fisica',
    title: 'Actividad Física y Entorno Favorecedor',
  },
  {
    code: 'espacios_libres_humo',
    title: 'Espacios 100% Libres de Humo de Tabaco',
  },
  {
    code: 'salud_mental',
    title: 'Salud Mental y Bienestar Emocional',
  },
];

const q = (
  number,
  dimensionCode,
  sectionCode,
  sectionTitle,
  prompt,
  options,
) => ({
  number,
  dimensionCode,
  sectionCode,
  sectionTitle,
  prompt,
  options: options.map((option) =>
    typeof option === 'string' ? { label: option } : option,
  ),
});

const na = (label) => ({ label, excludedFromImport: true });

const QUESTIONS = [
  q(
    1,
    'compromiso_institucional',
    'compromiso_institucional',
    'Compromiso Institucional y Planificación Estratégica',
    'Acta compromiso: Existe un acta compromiso institucional firmada y vigente que refleja el compromiso con la promoción de la salud y prevención de la obesidad en niños, niñas y adolescentes.',
    [
      'Existe, está vigente y es conocida por la comunidad educativa',
      'Existe, pero no está vigente o difundida',
      'No existe acta compromiso',
    ],
  ),
  q(
    2,
    'compromiso_institucional',
    'compromiso_institucional',
    'Compromiso Institucional y Planificación Estratégica',
    'Referente institucional: La escuela cuenta con una persona designada como referente institucional de Promoción de la salud en los ejes: alimentación saludable, actividad física, salud mental y prevención del tabaquismo.',
    [
      'Designado, con funciones definidas, capacitado y activo',
      'Designado, pero sin funciones claras o capacitación',
      'No hay referentes designados',
    ],
  ),
  q(
    3,
    'compromiso_institucional',
    'compromiso_institucional',
    'Compromiso Institucional y Planificación Estratégica',
    'Plan institucional con enfoque en promoción de la salud: La escuela implementa el Enfoque de Escuelas Promotoras de la Salud u otra estrategia de Promoción de la Salud con un plan de trabajo anual.',
    [
      'Implementa Escuelas Promotoras u otro enfoque de promoción de la salud, con plan de trabajo anual y seguimiento',
      'En proceso de implementación de Escuelas Promotoras u otro enfoque de Promoción de la Salud',
      'No implementa ninguna estrategia',
    ],
  ),
  q(
    4,
    'compromiso_institucional',
    'compromiso_institucional',
    'Compromiso Institucional y Planificación Estratégica',
    'Proyecto educativo institucional incluye Alimentación Saludable: Los temas de alimentación saludable y nutrición están insertos en el proyecto educativo institucional (PEI) y/o cuentan con proyectos escolares específicos.',
    [
      'Incluidos de forma explícita y con implementación activa y sostenida',
      'Incluidos en el PEI o en proyectos, pero sin implementación activa',
      'No están incluidos en el PEI ni cuentan con proyectos específicos',
    ],
  ),
  q(
    5,
    'compromiso_institucional',
    'compromiso_institucional',
    'Compromiso Institucional y Planificación Estratégica',
    'Proyecto educativo institucional incluye Actividad Física: Los temas de actividad física y su relación con la salud están insertos en el proyecto educativo institucional (PEI) y/o cuentan con proyectos escolares específicos.',
    [
      'Incluidos de forma explícita y con implementación activa y sostenida',
      'Incluidos en el PEI o en proyectos, pero sin implementación activa',
      'No están incluidos en el PEI ni cuentan con proyectos específicos',
    ],
  ),
  q(
    6,
    'articulacion_equipos_salud',
    'articulacion_equipos_salud',
    'Articulación con los Equipos de Salud',
    'Mecanismos formales de articulación: La escuela cuenta con mecanismos formales y circuitos claros para articular con el sistema de salud local.',
    [
      'Se cuenta con circuitos claros y articulados con el sistema de salud local',
      'Se realizan derivaciones informales o sin seguimiento',
      'No se cuenta con mecanismos formales',
    ],
  ),
  q(
    7,
    'articulacion_equipos_salud',
    'articulacion_equipos_salud',
    'Articulación con los Equipos de Salud',
    'La escuela articula con equipos de salud (centros de atención primaria, hospitales, programas provinciales, etc.) para desarrollar actividades de promoción de la salud y prevención de enfermedades.',
    [
      'Se realizan actividades al menos una vez por año, con planificación conjunta',
      'Se han realizado algunas actividades, pero de forma esporádica, sin planificación conjunta ni continuidad',
      'No se realizan actividades con equipos de salud',
    ],
  ),
  q(
    8,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Educación alimentaria integrada a la currícula: Abordaje de la educación alimentaria nutricional de forma articulada por docentes de distintas áreas curriculares.',
    [
      'Se aborda en varias áreas con planificación articulada',
      'Se aborda en algunas áreas, sin planificación conjunta',
      'No se aborda la educación alimentaria nutricional',
    ],
  ),
  q(
    9,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Higiene antes y después de las comidas: Promoción del lavado de manos previo a las comidas y cepillado dental posterior, con disponibilidad de elementos necesarios accesibles (agua, jabón, toallas, etc.).',
    [
      'Se promueve activamente y hay insumos accesibles',
      'Se promueve, pero con limitaciones en insumos o acceso',
      'No se promueve',
    ],
  ),
  q(
    10,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Tiempo adecuado para las comidas escolares: Garantía de un tiempo adecuado, asegurando al menos 10 minutos para desayunos y meriendas, y 30 minutos para almuerzos.',
    [
      'Se garantiza sistemáticamente 10 minutos para desayuno/merienda y 30 minutos para almuerzo.',
      'Se respeta parcialmente (sólo en algunos turnos o niveles)',
      'No se evalúa o controla el tiempo de las comidas',
    ],
  ),
  q(
    11,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Acompañamiento durante las comidas: El personal docente o no docente acompaña a los estudiantes durante las comidas, para reforzar prácticas saludables y fortalecer relaciones sociales.',
    [
      'Comparte el espacio, acompaña, cuida y promueve la alimentación saludable',
      'Comparte el mismo espacio, pero no se vincula con los estudiantes',
      'No hay acompañamiento durante las comidas',
      na(
        'El establecimiento no es Albergue, y no cuenta con Jornada extendida',
      ),
    ],
  ),
  q(
    12,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Clima convivencial durante las comidas y comensalidad: Existencia de un ambiente respetuoso, alegre y libre de violencia o discriminación durante las comidas.',
    [
      'El clima es positivo y se promueve activamente el respeto, la comunicación, el aprendizaje y fortalecimiento de vínculos',
      'El clima es variable o se interviene solo ante conflictos',
      'Se observan conflictos frecuentes',
      na(
        'El establecimiento no es Albergue, y no cuenta con Jornada extendida',
      ),
    ],
  ),
  q(
    13,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Respeto e inclusión de la diversidad corporal en la institución: Promoción de un entorno respetuoso e inclusivo que contemple la diversidad corporal, tanto de los estudiantes como del personal.',
    [
      'Se promueve de forma activa y transversal con materiales, lenguaje y prácticas inclusivas',
      'Se abordan ocasionalmente o sin enfoque sistemático',
      'No se abordan explícitamente estos temas',
    ],
  ),
  q(
    14,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Capacitación docente en alimentación saludable: El personal docente ha recibido formación sistemática y actualizada en los últimos dos años en temas vinculados a la Alimentación saludable.',
    [
      'Se realizan capacitaciones sistemáticas sobre AS',
      'Se han realizado 1 a 2 capacitaciones puntuales',
      'El personal docente no recibió formación',
    ],
  ),
  q(
    15,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Condiciones higiénico-sanitarias: Las instalaciones se observan en adecuadas condiciones de higiene y limpieza.',
    [
      'Se observa higiene adecuada, rutinas de limpieza y condiciones seguras de manipulación',
      'Hay cumplimiento parcial o variable',
      'No se cumplen condiciones mínimas de limpieza y orden',
    ],
  ),
  q(
    16,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Agua segura para consumo: La comunidad escolar tiene acceso durante toda la jornada a beber agua potable, fresca y gratuita, en espacios comunes (patios, pasillos, aulas, comedor). No incluye los picos de agua en baños.',
    [
      'Disponen de bebederos y/o dispensers visibles y accesibles en espacios comunes',
      'No disponen de bebederos o dispenser pero implementan estrategias como jarras con agua a disposición',
      'No tienen agua disponible',
    ],
  ),
  q(
    17,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Espacio para comer: La escuela dispone de un espacio específico y exclusivo para que los estudiantes puedan comer en condiciones de higiene y seguridad (sin incluir aulas).',
    [
      'Hay un espacio exclusivo, limpio, seguro, techado o con sombra y equipado para comer',
      'Hay un espacio, pero no cumple con condiciones de limpieza y seguridad',
      'No hay un espacio definido o se utiliza el aula para comer',
      na(
        'El establecimiento no es Albergue, y no cuenta con Jornada extendida',
      ),
    ],
  ),
  q(
    18,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Mobiliario para comer: El espacio asignado para comer cuenta con mesas y sillas suficientes para la matrícula que hace uso del comedor.',
    [
      'El mobiliario es suficiente y adecuado a la matrícula del comedor',
      'Hay mobiliario, pero no es suficiente para la matrícula del comedor',
      'No hay mobiliario específico para las comidas',
      na(
        'El establecimiento no es Albergue, y no cuenta con Jornada extendida',
      ),
    ],
  ),
  q(
    19,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Utensilios adecuados: La escuela cuenta con vajilla y utensilios adecuados (platos, cubiertos, vasos) en cantidad suficiente y en condiciones de higiene y mantenimiento.',
    [
      'Se dispone de utensilios en cantidad suficiente, en buenas condiciones y adaptados a la edad de los estudiantes',
      'Se cuenta con utensilios adecuados, pero no en cantidad suficiente o presentan deterioros',
      'No se dispone de utensilios suficientes o están en mal estado',
      na(
        'El establecimiento no es Albergue, y no cuenta con Jornada extendida',
      ),
    ],
  ),
  q(
    20,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Publicidad en equipamiento del Comedor: El equipamiento escolar (heladeras, freezers, congeladores, mobiliario, etc.) exhibe marcas comerciales de alimentos o bebidas con sellos de advertencia.',
    [
      'No se observan logos ni marcas comerciales en el equipamiento escolar',
      'Algunos elementos presentan logos, pero no están en espacios visibles para los estudiantes',
      'El equipamiento presenta logos o marcas comerciales visibles',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    21,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Publicidad en equipamiento del Kiosco: El equipamiento del Kiosco (heladeras, freezers, congeladores, mobiliario, etc.) exhibe marcas comerciales de alimentos o bebidas con sellos de advertencia.',
    [
      'No se observan logos ni marcas comerciales en el equipamiento escolar',
      'Algunos elementos presentan logos, pero no están en espacios visibles para los estudiantes',
      'El equipamiento presenta logos o marcas comerciales visibles',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    22,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Publicidad de alimentos no saludables en cartelería escolar: Presencia de afiches, carteles o materiales gráficos que promocionan alimentos o bebidas con sellos de advertencia.',
    [
      'No se observan materiales gráficos que publiciten alimentos con sellos de advertencia',
      'Se observan múltiples carteles o afiches con publicidad de productos con sellos de advertencia',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    23,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Venta de bebidas azucaradas y/o endulzadas artificialmente: El kiosco escolar ofrece para la venta bebidas azucaradas y/o bebidas que contengan edulcorantes o cafeína (gaseosas, jugos con azúcar, etc.) que contienen sellos de advertencia.',
    [
      'No se venden bebidas azucaradas ni las que contienen edulcorantes o cafeína, de ningún tipo',
      'Se venden bebidas azucaradas y/o bebidas que contienen edulcorantes o cafeína',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    24,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Proporción de productos no saludables en el kiosco: Evalúa la proporción visual de productos con bajo valor nutricional y/o con advertencias (sellos negros) en el espacio de venta. Considera alimentos ultraprocesados, golosinas, snacks y bebidas azucaradas con sellos.',
    [
      'No se ofrecen estos productos',
      'Ocupan menos de la mitad de la góndola o vitrina',
      'Ocupan la mitad o más de la góndola o vitrina del kiosco',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    25,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Venta de productos no recomendados para kioscos saludables: El kiosco escolar ofrece para la venta productos alimenticios no recomendados (galletitas dulces/saladas con sellos, facturas, golosinas, productos de copetín, embutidos, etc.).',
    [
      'No se vende ninguno de estos productos',
      'Se venden sin restricciones alguno o varios de estos productos comestibles no recomendados',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    26,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Oferta de alimentos saludables: Venta en el kiosco de alimentos y bebidas saludables (sin sellos de advertencia), basados preferentemente en alimentos frescos (frutas, yogures, sándwiches saludables, etc.).',
    [
      'Se ofrecen de forma variada, accesible y visible',
      'Se venden, pero la oferta es limitada o se encuentran poco visibles',
      'No se ofrecen',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    27,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Oferta de alimentos libres de gluten (ALG): En el kiosco de la escuela hay oferta de alimentos libres de gluten (ALG), debidamente identificados y almacenados.',
    [
      'Se ofrecen con variedad, identificación y condiciones de almacenamiento adecuadas',
      'Se ofrecen, pero la variedad es limitada (menos de 5 opciones)',
      'No se ofrecen',
      na('El establecimiento no cuenta con Kiosco'),
    ],
  ),
  q(
    28,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Control de porciones servidas: Verificación de la cantidad y tamaño de las porciones, según grupo etario, en el comedor.',
    [
      'Se controla según recomendaciones nutricionales',
      'Se controla parcialmente o sin criterios claros definidos',
      'No se controla',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    29,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Oferta exclusiva de agua segura: Oferta exclusiva de agua como bebida durante las comidas.',
    [
      'Se ofrece exclusivamente agua segura',
      'Se ofrece agua diariamente, pero para días festivos o eventos se ofrecen también otras bebidas',
      'No se ofrece agua o diariamente se ofrece junto a otras bebidas',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    30,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Uso y disponibilidad de sal: Uso de sal en la preparación de comidas y disponibilidad de saleros o sobres de sal en mesas, bandejas u otros espacios accesibles para estudiantes durante las comidas.',
    [
      'Se evita el agregado de sal durante las preparaciones y no hay saleros ni sobres de sal disponibles',
      'No hay saleros ni sobres de sal disponibles, pero se añade sal durante la preparación de alimentos',
      'Se encuentran saleros o sobres de sal disponibles',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    31,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Menú escolar planificado por profesional nutricionista: El menú ofrecido en el comedor ha sido diseñado, revisado o validado por un/a profesional nutricionista matriculado/a, en función de las recomendaciones nutricionales vigentes.',
    [
      'El menú es planificado y/o supervisado regularmente por un/a nutricionista matriculado/a',
      'El menú ha sido revisado por un/a nutricionista en algún momento, pero no se actualiza regularmente',
      'El menú no ha sido planificado ni revisado por un/a nutricionista',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    32,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Inclusión diaria de frutas y/o verduras frescas, crudas y preferentemente de estación.',
    [
      'Se incluyen diariamente.',
      'Se incluyen de 2 a 3 veces por semana.',
      'Se incluyen una vez por semana.',
      na('El establecimiento no cuenta con Comedor'),
    ],
  ),
  q(
    33,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Carnet de Manipulación de Alimentos: El personal de cocina (cocineros/as y ayudantes) o responsable de la preparación de alimentos cuenta con el Carnet de Manipulación de Alimentos vigente.',
    [
      'Todo el personal lo posee y está vigente',
      'Algunos miembros del personal no lo poseen o se encuentran desactualizados',
      'Ninguno de los miembros del personal lo posee',
    ],
  ),
  q(
    34,
    'entorno_alimentario',
    'entorno_alimentario',
    'Entorno Alimentario Seguro y Saludable',
    'Huerta escolar: La escuela cuenta con una huerta escolar activa, entendida como una herramienta pedagógica y comunitaria que promueve la alimentación saludable, el contacto con la naturaleza, el trabajo colaborativo y el aprendizaje.',
    [
      'Existe y está integrada al proyecto pedagógico',
      'Existe, pero está inactiva o se encuentra en proceso de implementación',
      'No existe',
    ],
  ),
  q(
    35,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Patios y espacios de juego: El patio y los espacios comunes de recreación/lúdicos son adecuados para el movimiento y juego seguros durante los recreos.',
    [
      'El patio es adecuado y permite el juego y movimiento',
      'Hay patio, pero presenta limitaciones de tamaño, seguridad o accesibilidad',
      'No hay patio o el patio no cuenta con piso adecuado para el juego',
    ],
  ),
  q(
    36,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Espacios para educación física: La escuela dispone de espacios específicos (cubiertos o al aire libre) destinados a la práctica de actividad física o clases de EF, con condiciones adecuadas de seguridad.',
    [
      'Hay espacios adecuados y seguros para la práctica regular de actividad física.',
      'Hay espacios disponibles pero con limitaciones de tamaño.',
      'No hay espacios específicos para actividad física o están inhabilitados.',
    ],
  ),
  q(
    37,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Equipamiento básico para educación física: La escuela cuenta con equipamiento para el desarrollo de las clases de EF (redes, arcos, pelotas, aros, colchonetas, conos, sogas, entre otros).',
    [
      'Cuenta con equipamiento suficiente y en buenas condiciones.',
      'El equipamiento es insuficiente o está en malas condiciones.',
      'No cuenta con equipamiento',
    ],
  ),
  q(
    38,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Asignatura Educación física: La escuela tiene Educación Física como asignatura obligatoria en todos los niveles, con frecuencia y duración adecuada.',
    [
      'Tiene 3 estímulos semanales.',
      'Tiene 2 estímulos semanales.',
      'Tiene 1 estímulo semanal.',
      'No tiene',
    ],
  ),
  q(
    39,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Recreos activos: Promoción de recreos activos y activación del cuerpo antes del comienzo de las clases de las diferentes asignaturas.',
    [
      'Se promueve activamente con propuestas organizadas',
      'Se promueve ocasionalmente o sin planificación',
      'No se promueve',
    ],
  ),
  q(
    40,
    'actividad_fisica',
    'actividad_fisica',
    'Actividad Física y Entorno Favorecedor',
    'Capacitación docente en educación física y salud: El personal docente ha recibido formación sistemática y actualizada en los últimos dos años en temas vinculados a EF y salud.',
    [
      'Se realizan capacitaciones sistemáticas en el tema.',
      'Se han realizado 1 a 2 capacitaciones puntuales',
      'El personal docente no recibió formación',
    ],
  ),
  q(
    41,
    'salud_mental',
    'entorno_socioemocional',
    'Entorno Socioemocional y Educativo Saludable',
    'Valores en la Institución: Promoción de valores como respeto, tolerancia, juego limpio y cooperación.',
    [
      'Se trabaja de forma limpia, transversal y sostenida.',
      'Se promueven de forma ocasional o implícita',
      'No se abordan explícitamente estos temas',
    ],
  ),
  q(
    42,
    'salud_mental',
    'entorno_socioemocional',
    'Entorno Socioemocional y Educativo Saludable',
    'Participación activa de la comunidad educativa: Fomento de la participación activa de estudiantes, familias y comunidad en actividades de promoción de estilos de vida saludables.',
    [
      'Se promueve sistemáticamente con participación representativa',
      'Hay instancias esporádicas o con baja participación.',
      'No hay instancias de participación.',
    ],
  ),
  q(
    43,
    'salud_mental',
    'entorno_socioemocional',
    'Entorno Socioemocional y Educativo Saludable',
    'Alumnos promotores de la salud con inserción comunitaria: La escuela realiza actividades de promoción de la salud donde los alumnos actúan como promotores, llevando mensajes y acciones a la comunidad circundante.',
    [
      'La escuela cuenta con un programa estructurado de formación de alumnos promotores de la salud y estos realizan actividades regulares con impacto en la comunidad.',
      'Se realizan actividades esporádicas o aisladas, sin una estructura de formación de alumnos promotores.',
      'No se realizan actividades de este tipo',
    ],
  ),
  q(
    44,
    'espacios_libres_humo',
    'espacios_libres_humo',
    'Espacios 100% Libres de Humo de Tabaco',
    'Escuela libre de tabaco: Existe una política escrita que prohíba fumar o usar productos de tabaco/vapeadores en todas las instalaciones de la escuela (incluyendo el interior y exterior del establecimiento, patios y áreas recreativas).',
    [
      'Existe una política escrita, está vigente, es conocida por la comunidad educativa y se aplica consistentemente en todas las instalaciones.',
      'Existe una política escrita, pero su aplicación es inconsistente o limitada a ciertas áreas',
      'No existe una política escrita o no se aplica',
    ],
  ),
  q(
    45,
    'espacios_libres_humo',
    'espacios_libres_humo',
    'Espacios 100% Libres de Humo de Tabaco',
    'Señalización clara: Presencia de señalización visible y adecuada que indique la prohibición de fumar y usar productos de tabaco/vapeadores en todas las áreas de la escuela.',
    [
      'Hay señalización clara y visible en todas las entradas y áreas clave de la escuela.',
      'Hay alguna señalización, pero no es visible en todas las entradas o áreas clave.',
      'No hay señalización o es insuficiente',
    ],
  ),
  q(
    46,
    'espacios_libres_humo',
    'espacios_libres_humo',
    'Espacios 100% Libres de Humo de Tabaco',
    'Educación y sensibilización: La escuela incorpora contenidos sobre los riesgos del tabaquismo y el uso de vapeadores en el plan de estudios y/o realiza actividades de sensibilización para la comunidad educativa.',
    [
      'Se abordan de forma activa y transversal en el plan de estudios, y se realizan actividades de sensibilización planificadas y regulares.',
      'Se abordan ocasionalmente o sin enfoque sistemático',
      'No se abordan estos temas.',
    ],
  ),
  q(
    47,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Espacios de participación estudiantil: La escuela ofrece espacios institucionales y tiempos específicos donde los estudiantes puedan expresarse, proponer iniciativas y participar en decisiones relacionadas con la vida escolar.',
    [
      'Sí, de manera sistemática con espacios regulares (centro de estudiantes, asambleas, consejos escolares)',
      'Sí, pero de manera ocasional (actividades puntuales sin práctica regular)',
      'No se ofrecen estos espacios',
    ],
  ),
  q(
    48,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Actividades con participación comunitaria: Existen actividades programadas con otros sectores que posibilitan la participación activa de los estudiantes en proyectos de la comunidad o entorno escolar.',
    [
      'Sí, se realizan actividades sistemáticas con participación de la comunidad.',
      'Sí, pero de manera esporádica o limitada.',
      'No se realizan actividades de este tipo',
    ],
  ),
  q(
    49,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Espacios de convivencia y resolución de conflictos: La escuela cuenta con espacios institucionales que promueven el encuentro entre estudiantes para fortalecer la convivencia, el diálogo y la resolución pacífica de conflictos.',
    [
      'Sí, de manera sistemática con espacios regulares',
      'Sí, pero de manera ocasional sin regularidad.',
      'No existen estos espacios',
    ],
  ),
  q(
    50,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Referentes adultos de confianza: La escuela dispone de referentes adultos de confianza que facilitan la escucha y contención de los estudiantes en forma programática.',
    [
      'Sí, cuenta con referentes designados y horas programáticas específicas',
      'Sí, cuenta con referentes pero sin horas específicas asignadas',
      'No dispone de referentes adultos designados',
    ],
  ),
  q(
    51,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Participación de familias: Las acciones y proyectos de bienestar emocional incluyen la participación de cuidadores adultos familiares en su implementación.',
    [
      'Sí, cuenta con referentes designados y horas programáticas específicas.',
      'Sí, pero la participación es ocasional o limitada.',
      'No se incluye la participación de familias.',
    ],
  ),
  q(
    52,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    '¿Cuál de las siguientes opciones describe mejor el nivel de desarrollo del abordaje institucional del bienestar emocional de los estudiantes y su articulación con el sistema de salud?',
    [
      {
        label:
          'La institución se limita a aplicar los protocolos de actuación establecidos por la Dirección General de Escuelas ante situaciones de crisis.',
        explicitScore: 0,
      },
      {
        label:
          'La institución, además de aplicar los protocolos, desarrolla articulaciones con el centro de salud de referencia y/o participa en programas del Ministerio de Salud para el abordaje de la salud mental.',
        explicitScore: 33,
      },
      {
        label:
          'La institución, además de los protocolos y la articulación, desarrolla acciones preventivas (como espacios de escucha, tutorías o talleres), promueve instancias de formación/capacitación en bienestar emocional y mantiene vínculos operativos con efectores de salud y/o programas ministeriales.',
        explicitScore: 66,
      },
      {
        label:
          'La institución implementa un enfoque integral y sostenido, incorporando la educación socioemocional en el proyecto institucional, promoviendo la capacitación continua de la comunidad educativa y articulando de manera sistemática con el sistema de salud y programas intersectoriales.',
        explicitScore: 100,
      },
    ],
  ),
  q(
    53,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Alumnos promotores de salud mental: La escuela realiza actividades de promoción de la salud mental donde los estudiantes actúan como promotores, llevando mensajes y acciones a la comunidad.',
    [
      'La escuela cuenta con un programa estructurado de formación de alumnos promotores y realiza actividades regulares con impacto en la comunidad.',
      'Se realizan actividades esporádicas o aisladas, sin una estructura de formación.',
      'No se realizan actividades de este tipo',
    ],
  ),
  q(
    54,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Capacitación docente en salud mental: El personal docente ha recibido formación sistemática y actualizada en temas vinculados a salud mental en los últimos dos años.',
    [
      'Se realizan capacitaciones sistemáticas sobre salud mental.',
      'Se han realizado 1 o 2 capacitaciones puntuales',
      'El personal no ha recibido formación.',
    ],
  ),
  q(
    55,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Derivaciones por salud mental: La escuela cuenta con circuitos claros para derivar estudiantes a centros de salud por problemas de salud mental, con seguimiento adecuado.',
    [
      'Cuenta con circuitos claros, responsables designados y realiza seguimiento de las derivaciones.',
      'Realiza derivaciones, pero sin circuitos formales o seguimiento sistemático.',
      'No se realizan derivaciones o no hay circuitos establecidos',
    ],
  ),
  q(
    56,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Actividades con equipos de salud en salud mental: Las actividades conjuntas con equipos de salud incluyen la temática de prevención y promoción de la salud mental.',
    [
      'Se realizan actividades sistemáticas con equipos de salud sobre salud mental.',
      'Se realizan actividades ocasionales o esporádicas.',
      'No se incluye la temática de salud mental en las actividades.',
    ],
  ),
  q(
    57,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Capacitación para situaciones de crisis: El personal escolar se encuentra capacitado para generar programas o protocolos de abordaje en salud mental ante situaciones críticas, urgencias o desastres de impacto colectivo.',
    [
      'El personal está capacitado y la escuela cuenta con protocolos establecidos.',
      'Algunos miembros del personal han recibido capacitación, pero sin protocolos formales.',
      'El personal no está capacitado para estas situaciones.',
    ],
  ),
  q(
    58,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Salud mental en la currícula: Los temas de salud mental están incluidos en la currícula de contenidos académicos y en el proyecto educativo institucional (PEI).',
    [
      'Incluidos de forma específica en currícula y PEI, con implementación activa y sostenida',
      'Incluidos en la currícula o PEI, pero sin implementación sistemática',
      'No están incluidos en la currícula ni en el PEI',
    ],
  ),
  q(
    59,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Calendario de efemérides de salud mental: La escuela cuenta con un calendario de efemérides de salud mental inserto en el PEI o en proyectos escolares (ej.: Día Mundial de la Salud Mental, prevención del suicidio).',
    [
      'Incluido de forma con implementación específica activa y sostenida',
      'Incluido en el PEI o proyectos, pero sin implementación regular',
      'No está incluido en el PEI ni en proyectos',
    ],
  ),
  q(
    60,
    'salud_mental',
    'salud_mental',
    'Salud Mental',
    'Acuerdos sobre usos de tecnologías: Existen acuerdos institucionales formales respecto del uso de las tecnologías, en particular los dispositivos móviles, dentro del establecimiento.',
    [
      'Sí existen acuerdos formales implementados y conocidos por la comunidad educativa',
      'Están en proceso de elaboración o implementación',
      'No existen acuerdos formales',
    ],
  ),
];

const PENDING_SCORE_DEFINITIONS = [
  {
    questionCodes: [OFFICIAL_UNRESOLVED_P038_CODE],
    questions: '38',
    topic: 'Cuatro respuestas en escala general',
    detail: `La escala general confirmada es ${OFFICIAL_GENERAL_SCORE_PROFILE.join('/')}, pero la pregunta tiene cuatro niveles. Falta el mapeo exacto opción–puntaje; todas sus celdas de puntaje permanecen vacías para no repetir un valor sin aprobación.`,
  },
  {
    questionCodes: [...OFFICIAL_MENTAL_HEALTH_PENDING_QUESTION_CODES],
    questions: '41 a 43 y 47 a 51, 53 a 60',
    topic: 'Tres respuestas en dimensión Salud Mental',
    detail: `La escala confirmada para Salud Mental es ${OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE.join('/')}, pero estas preguntas tienen tres opciones. Falta definir el mapeo exacto, en especial si la alternativa intermedia vale 66 o 33; todas sus celdas de puntaje permanecen vacías.`,
  },
];

const PENDING_ITEMS = [
  {
    priority: 'Bloqueante para publicación',
    questions: '11, 12, 17, 18 y 19',
    topic: 'Condición por jornada/albergue',
    detail:
      'El PDF incluye una respuesta manual “El establecimiento no es Albergue, y no cuenta con Jornada extendida”. Se excluyó de la hoja importable porque la regla aprobada indica que las preguntas no aplicables deben omitirse automáticamente. Falta definir la condición exacta.',
  },
  {
    priority: 'Bloqueante para publicación',
    questions: '20',
    topic: 'Aplicabilidad por comedor',
    detail:
      'La respuesta funcional final agrega “El establecimiento no cuenta con Comedor”. Se conserva en la hoja Fuente, pero no puede importarse como respuesta puntuable: confirmar si p020 debe excluirse automáticamente cuando no existe comedor.',
  },
  {
    priority: 'Bloqueante para publicación',
    questions: '21 a 27',
    topic: 'Condición por kiosco',
    detail:
      'La respuesta funcional enumera p021–p027, pero más adelante dice que el filtro anula 9 preguntas sin identificar las dos adicionales. El backend aplica la definición enumerada de 7; falta resolver la contradicción antes de publicar.',
  },
  {
    priority: 'Bloqueante para publicación',
    questions: '28 a 32',
    topic: 'Condición por comedor',
    detail:
      'Las alternativas manuales “El establecimiento no cuenta con Comedor” se conservaron en la hoja Fuente, pero se excluyeron de la hoja importable. Falta confirmar la condición automática y si existen más preguntas dependientes del comedor.',
  },
  {
    priority: 'Bloqueante para publicación',
    questions: '33',
    topic: 'Aplicabilidad por cocina/comedor',
    detail:
      'La pregunta refiere al personal que prepara alimentos, pero no aclara qué ocurre si el establecimiento no prepara alimentos. Confirmar si corresponde una exclusión automática.',
  },
  ...PENDING_SCORE_DEFINITIONS.map((definition) => ({
    priority: 'Bloqueante para importación y publicación',
    questions: definition.questions,
    topic: definition.topic,
    detail: definition.detail,
  })),
  {
    priority: 'Corrección de contenido',
    questions: '41',
    topic: 'Redacción',
    detail:
      'La primera opción dice “Se trabaja de forma limpia, transversal y sostenida”. Confirmar si “limpia” es el término esperado.',
  },
  {
    priority: 'Bloqueante para publicación',
    questions: '51',
    topic: 'Respuesta no relacionada con la pregunta',
    detail:
      'La primera opción refiere a adultos designados y horas programáticas, mientras la pregunta consulta participación de familias. Solicitar la opción correcta.',
  },
  {
    priority: 'Corrección de contenido',
    questions: '59',
    topic: 'Redacción',
    detail:
      'La primera opción dice “Incluido de forma con implementación específica activa y sostenida”. Solicitar la redacción definitiva.',
  },
];

function scoreMappingForQuestion(question) {
  const scorableOptions = question.options.filter(
    (option) => !option.excludedFromImport,
  );
  const questionCode = `p${String(question.number).padStart(3, '0')}`;
  const pendingDefinition = PENDING_SCORE_DEFINITIONS.find((definition) =>
    definition.questionCodes.includes(questionCode),
  );
  const officialScale = [...getOfficialScoreProfile(question.dimensionCode)];

  if (pendingDefinition)
    return {
      questionNumber: question.number,
      questionCode,
      dimensionCode: question.dimensionCode,
      optionCount: scorableOptions.length,
      officialScale,
      scores: scorableOptions.map(() => null),
      status: 'pending',
      detail: pendingDefinition.detail,
    };

  const approvedScores = getApprovedOfficialQuestionScoreSequence(questionCode);
  if (!approvedScores)
    throw new Error(
      `La política no inventaría un mapeo aprobado ni pendiente para ${questionCode}.`,
    );
  const scores = [...approvedScores];
  if (scores.length !== scorableOptions.length)
    throw new Error(
      `${questionCode} tiene ${scorableOptions.length} opciones, pero la política define ${scores.length} puntajes.`,
    );

  const explicitScores = scorableOptions.map((option) =>
    Number.isInteger(option.explicitScore) ? option.explicitScore : null,
  );
  const hasExplicitScores = explicitScores.some((score) => score !== null);
  if (
    hasExplicitScores &&
    JSON.stringify(explicitScores) !== JSON.stringify(scores)
  )
    throw new Error(
      `${questionCode} contradice el mapeo central: fuente ${explicitScores.join('/')} / política ${scores.join('/')}.`,
    );

  const invalidScores = scores.filter(
    (score) => !Number.isInteger(score) || !officialScale.includes(score),
  );
  if (invalidScores.length)
    throw new Error(
      `La pregunta ${question.number} usa puntajes fuera de la escala oficial: ${invalidScores.join(', ')}.`,
    );

  return {
    questionNumber: question.number,
    questionCode,
    dimensionCode: question.dimensionCode,
    optionCount: scorableOptions.length,
    officialScale,
    scores,
    status: 'confirmed',
    detail: hasExplicitScores
      ? 'Mapeo explícito confirmado en la fuente funcional.'
      : 'Mapeo obtenido de la política central de puntuación oficial.',
  };
}

const SCORE_MAPPING_INVENTORY = QUESTIONS.map(scoreMappingForQuestion);
const SCORE_MAPPING_BY_QUESTION = new Map(
  SCORE_MAPPING_INVENTORY.map((mapping) => [
    mapping.questionNumber,
    mapping,
  ]),
);

function recordsForQuestion(question, includeExcluded) {
  const scorableOptions = question.options.filter(
    (option) => !option.excludedFromImport,
  );
  const scoreMapping = SCORE_MAPPING_BY_QUESTION.get(question.number);
  if (!scoreMapping)
    throw new Error(`Falta inventariar la pregunta ${question.number}.`);
  let scorableIndex = 0;
  return question.options
    .filter((option) => includeExcluded || !option.excludedFromImport)
    .map((option, optionIndex) => {
      const currentScorableIndex = option.excludedFromImport
        ? -1
        : scorableIndex++;
      const score =
        currentScorableIndex === -1
          ? null
          : scoreMapping.scores[currentScorableIndex];
      return {
        dimension_codigo: question.dimensionCode,
        seccion_codigo: question.sectionCode,
        seccion: question.sectionTitle,
        pregunta_codigo: `p${String(question.number).padStart(3, '0')}`,
        pregunta: question.prompt,
        texto_ayuda: '',
        opcion_codigo: `opcion_${optionIndex + 1}`,
        opcion: option.label,
        puntaje: score === null ? '' : String(score),
        obligatoria: 'si',
        orden: String(question.number),
        condicion: '',
        estado_importacion: option.excludedFromImport
          ? 'Excluida: debe reemplazarse por condición automática'
          : scoreMapping.status === 'pending'
            ? 'Pendiente: puntaje sin definición funcional'
            : 'Incluida',
        estado_puntuacion: scoreMapping.status,
      };
    });
}

const IMPORT_RECORDS = QUESTIONS.flatMap((question) =>
  recordsForQuestion(question, false),
);
const SOURCE_RECORDS = QUESTIONS.flatMap((question) =>
  recordsForQuestion(question, true),
);

const colors = {
  blue: 'FF000F9F',
  sky: 'FF3CB4E5',
  gold: 'FFC8A977',
  background: 'FFF7F4EF',
  white: 'FFFFFFFF',
  text: 'FF1F2937',
  muted: 'FF6B7280',
  border: 'FFE5E7EB',
  warning: 'FFFFF4D6',
};

function styleHeader(row) {
  row.height = 30;
  row.font = { bold: true, color: { argb: colors.white } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: colors.blue },
  };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function styleBody(sheet, lastColumn) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    row.font = { color: { argb: colors.text }, size: 10 };
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        bottom: { style: 'hair', color: { argb: colors.border } },
      };
    });
  });
  sheet.autoFilter = { from: 'A1', to: `${lastColumn}1` };
}

function addImportSheet(workbook) {
  const sheet = workbook.addWorksheet('Cuestionario', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.addRow(HEADERS);
  IMPORT_RECORDS.forEach((record) => {
    const row = sheet.addRow(HEADERS.map((header) => record[header]));
    if (record.estado_puntuacion === 'pending') {
      const scoreCell = row.getCell(9);
      scoreCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.warning },
      };
      scoreCell.note =
        'Puntaje pendiente de definición funcional. No completar sin aprobación del cliente.';
    }
  });
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 'L');
  const widths = [28, 25, 38, 18, 75, 28, 18, 75, 11, 13, 9, 28];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index];
  });
  for (let row = 2; row <= 2001; row += 1) {
    sheet.getCell(`A${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [
        `"${DIMENSIONS.map((dimension) => dimension.code).join(',')}"`,
      ],
    };
    sheet.getCell(`I${row}`).dataValidation = {
      type: 'whole',
      operator: 'between',
      allowBlank: false,
      formulae: [0, 100],
    };
    sheet.getCell(`J${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: ['"si,no"'],
    };
    sheet.getCell(`K${row}`).dataValidation = {
      type: 'whole',
      operator: 'greaterThanOrEqual',
      allowBlank: false,
      formulae: [1],
    };
  }
  return sheet;
}

function addInstructionsSheet(workbook) {
  const sheet = workbook.addWorksheet('Instrucciones', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { key: 'item', width: 34 },
    { key: 'detail', width: 115 },
  ];
  sheet.addRow(['Elemento', 'Descripción']);
  const rows = [
    [
      'Uso',
      'La primera hoja (“Cuestionario”) es la que lee el importador administrativo. No cambies sus encabezados.',
    ],
    [
      'Contenido',
      `Incluye las ${QUESTIONS.length} preguntas del PDF, organizadas en las seis dimensiones oficiales y con las correcciones funcionales cerradas para p010, p020, p032 y p046.`,
    ],
    [
      'Opciones no aplicables',
      'Las respuestas manuales por inexistencia de kiosco, comedor o jornada/albergue no se incluyeron en la hoja importable. Deben reemplazarse por exclusiones automáticas cuando se implemente y confirme la condicionalidad.',
    ],
    [
      'Fuente consolidada',
      'La hoja “Fuente” conserva las alternativas del documento y la opción de comedor agregada por la respuesta funcional final, incluidas las no importables, para trazabilidad y revisión funcional.',
    ],
    [
      'Inventario de puntuación',
      'La hoja “Mapeo de puntajes” enumera las 60 preguntas, su escala oficial, el mapeo aplicado en el orden de las opciones y cualquier definición pendiente.',
    ],
    [
      'Puntajes generales',
      `La escala oficial es ${OFFICIAL_GENERAL_SCORE_PROFILE.join('/')}. Las ternarias confirmadas usan ${OFFICIAL_GENERAL_SCORE_PROFILE.join('/')} y las binarias p022, p023 y p025 usan 100/0. p038 permanece completamente sin puntuar porque tiene cuatro alternativas y no existe un mapeo aprobado.`,
    ],
    [
      'Puntajes de Salud Mental',
      `La escala oficial es ${OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE.join('/')}. p052 usa 0/33/66/100 según el orden creciente de madurez confirmado. Las preguntas mentales de tres alternativas permanecen completamente sin puntuar hasta definir si la opción intermedia vale 66 o 33.`,
    ],
    [
      'Obligatoriedad',
      'Todas las preguntas están marcadas como obligatorias, sujeto a las exclusiones automáticas que correspondan.',
    ],
    [
      'Condición',
      'La columna condicion permanece vacía porque el importador no admite reglas hasta que se defina el modelo formal de condicionalidad.',
    ],
    [
      'Estado de la versión',
      'La planilla no puede importarse mientras existan puntajes vacíos. La vista previa del backend debe rechazar exclusivamente p038 y las preguntas mentales de tres opciones. La hoja “Pendientes” enumera las definiciones requeridas.',
    ],
    [
      'Origen',
      'Arquitectura de datos para la App de Escuelas Promotoras de Salud Mendoza. DEFINITIVA y Respuestas Funcionales Final (prioridad ante contradicciones).',
    ],
  ];
  rows.forEach((row) => sheet.addRow(row));
  sheet.addRow([]);
  sheet.addRow(['Dimensiones oficiales', '']);
  DIMENSIONS.forEach((dimension, index) =>
    sheet.addRow([dimension.code, `${index + 1}. ${dimension.title}`]),
  );
  styleHeader(sheet.getRow(1));
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
    if (row.getCell(1).value === 'Dimensiones oficiales') {
      row.font = { bold: true, color: { argb: colors.blue } };
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.background },
      };
    }
  });
}

function addScoreMappingSheet(workbook) {
  const sheet = workbook.addWorksheet('Mapeo de puntajes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { key: 'questionCode', width: 20 },
    { key: 'dimensionCode', width: 32 },
    { key: 'optionCount', width: 20 },
    { key: 'officialScale', width: 24 },
    { key: 'appliedMapping', width: 34 },
    { key: 'status', width: 22 },
    { key: 'detail', width: 110 },
  ];
  sheet.addRow([
    'pregunta_codigo',
    'dimension_codigo',
    'cantidad_opciones',
    'escala_oficial',
    'mapeo_segun_orden_opciones',
    'estado',
    'detalle',
  ]);
  SCORE_MAPPING_INVENTORY.forEach((mapping) => {
    const row = sheet.addRow([
      mapping.questionCode,
      mapping.dimensionCode,
      mapping.optionCount,
      mapping.officialScale.join('/'),
      mapping.scores.every((score) => score === null)
        ? 'SIN DEFINIR'
        : mapping.scores.join('/'),
      mapping.status === 'confirmed' ? 'Confirmado' : 'Pendiente',
      mapping.detail,
    ]);
    if (mapping.status === 'pending')
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.warning },
      };
  });
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 'G');
}

function addPendingSheet(workbook) {
  const sheet = workbook.addWorksheet('Pendientes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { key: 'priority', width: 28 },
    { key: 'questions', width: 24 },
    { key: 'topic', width: 36 },
    { key: 'detail', width: 115 },
  ];
  sheet.addRow(['Prioridad', 'Preguntas', 'Tema', 'Definición requerida']);
  PENDING_ITEMS.forEach((pending) =>
    sheet.addRow([
      pending.priority,
      pending.questions,
      pending.topic,
      pending.detail,
    ]),
  );
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 'D');
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: String(row.getCell(1).value).startsWith('Bloqueante')
          ? colors.warning
          : colors.white,
      },
    };
  });
}

function addSourceSheet(workbook) {
  const headers = [...HEADERS, 'estado_importacion'];
  const sheet = workbook.addWorksheet('Fuente', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.addRow(headers);
  SOURCE_RECORDS.forEach((record) =>
    sheet.addRow(headers.map((header) => record[header])),
  );
  styleHeader(sheet.getRow(1));
  styleBody(sheet, 'M');
  const widths = [28, 25, 38, 18, 75, 24, 18, 75, 11, 13, 9, 24, 45];
  sheet.columns.forEach((column, index) => {
    column.width = widths[index];
  });
  sheet.eachRow((row, rowNumber) => {
    if (
      rowNumber > 1 &&
      /^(Excluida|Pendiente)/.test(String(row.getCell(13).value))
    ) {
      row.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.warning },
      };
    }
  });
}

function assertDataset() {
  if (QUESTIONS.length !== 60)
    throw new Error(`Se esperaban 60 preguntas y hay ${QUESTIONS.length}.`);
  const questionNumbers = QUESTIONS.map((question) => question.number);
  for (let number = 1; number <= 60; number += 1) {
    if (!questionNumbers.includes(number))
      throw new Error(`Falta la pregunta ${number}.`);
  }
  if (new Set(questionNumbers).size !== 60)
    throw new Error('Hay números de pregunta duplicados.');
  if (SOURCE_RECORDS.length !== 197)
    throw new Error(
      `Se esperaban 197 opciones en la fuente consolidada y hay ${SOURCE_RECORDS.length}.`,
    );
  if (IMPORT_RECORDS.length !== 179)
    throw new Error(
      `Se esperaban 179 opciones importables y hay ${IMPORT_RECORDS.length}.`,
    );
  if (SCORE_MAPPING_INVENTORY.length !== QUESTIONS.length)
    throw new Error('El inventario de puntuación no cubre las 60 preguntas.');

  const expectedPendingCodes = PENDING_SCORE_DEFINITIONS.flatMap(
    (definition) => definition.questionCodes,
  ).sort();
  const pendingMappings = SCORE_MAPPING_INVENTORY.filter(
    (mapping) => mapping.status === 'pending',
  );
  const actualPendingCodes = pendingMappings
    .map((mapping) => mapping.questionCode)
    .sort();
  if (
    JSON.stringify(actualPendingCodes) !== JSON.stringify(expectedPendingCodes)
  )
    throw new Error(
      `Los pendientes de puntuación no coinciden: ${actualPendingCodes.join(', ')}.`,
    );

  SCORE_MAPPING_INVENTORY.forEach((mapping) => {
    if (mapping.scores.length !== mapping.optionCount)
      throw new Error(
        `El mapeo de ${mapping.questionCode} no cubre todas sus opciones.`,
      );
    if (
      mapping.status === 'pending' &&
      mapping.scores.some((score) => score !== null)
    )
      throw new Error(
        `${mapping.questionCode} es pendiente y no debe tener puntajes provisorios.`,
      );
    if (
      mapping.status === 'confirmed' &&
      mapping.scores.some(
        (score) =>
          !Number.isInteger(score) || !mapping.officialScale.includes(score),
      )
    )
      throw new Error(
        `${mapping.questionCode} contiene valores fuera de su escala oficial.`,
      );
  });

  if (
    JSON.stringify(SCORE_MAPPING_BY_QUESTION.get(52)?.scores) !==
    JSON.stringify([0, 33, 66, 100])
  )
    throw new Error('p052 debe conservar el mapeo confirmado 0/33/66/100.');

  if (
    JSON.stringify(OFFICIAL_GENERAL_SCORE_PROFILE) !==
      JSON.stringify([100, 50, 0]) ||
    JSON.stringify(OFFICIAL_MENTAL_HEALTH_SCORE_PROFILE) !==
      JSON.stringify([100, 66, 33, 0])
  )
    throw new Error('Las escalas oficiales centrales fueron modificadas.');
  const officialCodes = new Set(DIMENSIONS.map((dimension) => dimension.code));
  QUESTIONS.forEach((question) => {
    if (!officialCodes.has(question.dimensionCode))
      throw new Error(
        `La pregunta ${question.number} usa una dimensión no oficial.`,
      );
    if (
      [41, 42, 43].includes(question.number) &&
      question.dimensionCode !== 'salud_mental'
    )
      throw new Error(
        `La pregunta ${question.number} debe pertenecer a salud_mental.`,
      );
  });
}

async function validateWithBackend() {
  const {
    SurveyImportFileService,
  } = require('../src/modules/surveys/services/survey-import-file.service.ts');
  const {
    BulkSurveyImportService,
  } = require('../src/modules/surveys/services/bulk-survey-import.service.ts');
  const buffer = fs.readFileSync(OUTPUT_PATH);
  const file = {
    fieldname: 'file',
    originalname: path.basename(OUTPUT_PATH),
    encoding: '7bit',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
  const service = new BulkSurveyImportService(
    {},
    new SurveyImportFileService(),
  );
  const preview = await service.preview(file);
  const pendingQuestionCodes = new Set(
    SCORE_MAPPING_INVENTORY.filter(
      (mapping) => mapping.status === 'pending',
    ).map((mapping) => mapping.questionCode),
  );
  const expectedPendingRows = SCORE_MAPPING_INVENTORY.filter(
    (mapping) => mapping.status === 'pending',
  ).reduce((total, mapping) => total + mapping.optionCount, 0);
  const invalidRows = preview.rows.filter((row) => row.errors.length);
  const unexpectedErrors = invalidRows.filter(
    (row) =>
      !pendingQuestionCodes.has(row.questionCode) ||
      row.errors.some(
        (error) => error !== 'puntaje: debe ser un entero entre 0 y 100.',
      ),
  );
  if (
    preview.canImport ||
    preview.errorCount !== expectedPendingRows ||
    unexpectedErrors.length
  )
    throw new Error(
      `La validación del backend no coincide con los puntajes pendientes: ${JSON.stringify(
        invalidRows,
        null,
        2,
      )}`,
    );
  return preview;
}

async function main() {
  assertDataset();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Escuelas Promotoras de Salud Mendoza';
  workbook.lastModifiedBy = 'Equipo de desarrollo';
  workbook.created = new Date('2026-07-28T12:00:00-03:00');
  workbook.modified = new Date('2026-07-28T12:00:00-03:00');
  workbook.subject = 'Plantilla de carga del cuestionario institucional';
  workbook.title = 'Cuestionario completo - Escuelas Promotoras de Salud';
  workbook.description =
    'Planilla de revisión del cuestionario institucional con pendientes funcionales explícitos.';

  addImportSheet(workbook);
  addInstructionsSheet(workbook);
  addScoreMappingSheet(workbook);
  addPendingSheet(workbook);
  addSourceSheet(workbook);

  await workbook.xlsx.writeFile(OUTPUT_PATH);
  const preview = await validateWithBackend();
  process.stdout.write(
    `${JSON.stringify(
      {
        output: OUTPUT_PATH,
        sourceQuestions: QUESTIONS.length,
        sourceOptions: SOURCE_RECORDS.length,
        importRows: IMPORT_RECORDS.length,
        pendingScoreQuestions: SCORE_MAPPING_INVENTORY.filter(
          (mapping) => mapping.status === 'pending',
        ).length,
        backendPreview: {
          canImport: preview.canImport,
          errorCount: preview.errorCount,
          counts: preview.counts,
        },
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
