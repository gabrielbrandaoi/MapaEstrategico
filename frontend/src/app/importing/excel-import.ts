import {
  ColumnMapping,
  ImportIssue,
  ImportReport,
  Participant,
  ParticipantType,
} from '../domain/models';

const HEADER_SYNONYMS: Record<keyof ColumnMapping, readonly string[]> = {
  type: [
    'tipo',
    'tipodeparticipante',
    'tipodeprofissional',
    'tipodepessoa',
    'tipodecadastro',
    'perfil',
    'perfilprofissional',
    'papel',
    'categoria',
    'categoriaprofissional',
    'vinculo',
    'vinculoprofissional',
  ],
  name: [
    'nome',
    'nomecompleto',
    'nomedapessoa',
    'nomepessoa',
    'nometutor',
    'nomedotutor',
    'nomedomedicotutor',
    'nomemedicotutor',
    'nomemedico',
    'nomedomedico',
    'nomebolsista',
    'nomedobolsista',
    'nomebeneficiario',
    'nomedobeneficiario',
    'nomedaprofissional',
    'nomeprofissionalresponsavel',
    'nomeprofissional',
    'name',
    'fullname',
  ],
  city: [
    'cidade',
    'cidadederesidencia',
    'cidadedeatuacao',
    'municipio',
    'municipioderesidencia',
    'municipiodeatuacao',
    'localidade',
    'city',
  ],
  state: ['uf', 'sigladoestado', 'estado', 'estadoderesidencia', 'state'],
  address: [
    'endereco',
    'enderecocompleto',
    'enderecoderesidencia',
    'enderecodeatuacao',
    'logradouro',
    'address',
  ],
  postalCode: ['cep', 'cepderesidencia', 'postalcode', 'codigopostal'],
  latitude: ['latitude', 'latitudedecimal', 'lat'],
  longitude: ['longitude', 'longitudedecimal', 'long', 'lon', 'lng'],
};

const MAPPING_KEYS: readonly (keyof ColumnMapping)[] = [
  'type',
  'name',
  'city',
  'state',
  'address',
  'postalCode',
  'latitude',
  'longitude',
];

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function findHeaderRow(rows: readonly unknown[][]): number {
  let bestIndex = -1;
  let bestScore = -1;
  const searchLimit = Math.min(rows.length, 20);

  for (let rowIndex = 0; rowIndex < searchLimit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.every((cell) => cellText(cell) === '')) {
      continue;
    }

    const headers = row.map(normalizeHeader);
    const score = MAPPING_KEYS.filter((key) =>
      headers.some((header) => matchesHeader(header, HEADER_SYNONYMS[key])),
    ).length;

    if (score > bestScore) {
      bestIndex = rowIndex;
      bestScore = score;
    }
  }

  if (bestIndex >= 0 && bestScore >= 2) {
    return bestIndex;
  }

  return rows.findIndex((row) => row !== undefined && row.some((cell) => cellText(cell) !== ''));
}

export function suggestColumnMapping(headers: readonly unknown[]): ColumnMapping {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {
    type: null,
    name: null,
    city: null,
    state: null,
    address: null,
    postalCode: null,
    latitude: null,
    longitude: null,
  };

  for (const key of MAPPING_KEYS) {
    const index = normalizedHeaders.findIndex((header) =>
      matchesHeader(header, HEADER_SYNONYMS[key]),
    );
    mapping[key] = index >= 0 ? index : null;
  }

  return mapping;
}

export function normalizeImportedRows(
  rows: readonly unknown[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
  defaultType: ParticipantType | null = null,
): ImportReport {
  const participants: Participant[] = [];
  const issues: ImportIssue[] = [];
  const invalidRows = new Set<number>();
  const firstSeen = new Map<string, number>();
  let totalRows = 0;

  if (!Number.isInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= rows.length) {
    return {
      totalRows: 0,
      participants,
      issues: [
        {
          rowNumber: null,
          severity: 'error',
          code: 'invalid_header_row',
          message: 'A linha de cabeçalho selecionada não existe na planilha.',
        },
      ],
      invalidRows: [],
      participantsWithoutCoordinates: 0,
    };
  }

  if ((mapping.type === null && defaultType === null) || mapping.name === null) {
    return {
      totalRows: 0,
      participants,
      issues: [
        {
          rowNumber: null,
          severity: 'error',
          code: 'required_mapping_missing',
          message: 'Mapeie a coluna de nome e informe o tipo do participante.',
        },
      ],
      invalidRows: [],
      participantsWithoutCoordinates: 0,
    };
  }

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (row.every((cell) => cellText(cell) === '')) {
      continue;
    }

    totalRows += 1;
    const rowNumber = rowIndex + 1;
    const rowIssues: ImportIssue[] = [];
    const getValue = (columnIndex: number | null): string =>
      columnIndex === null ? '' : cellText(row[columnIndex]);

    const typeValue = getValue(mapping.type);
    const name = getValue(mapping.name);
    const type = mapping.type === null ? defaultType : parseParticipantType(typeValue);
    const city = nullableText(getValue(mapping.city));
    const state = nullableText(getValue(mapping.state));
    const address = nullableText(getValue(mapping.address));
    const postalCode = nullableText(getValue(mapping.postalCode));
    const latitudeValue = getValue(mapping.latitude);
    const longitudeValue = getValue(mapping.longitude);
    const latitude = parseCoordinate(latitudeValue);
    const longitude = parseCoordinate(longitudeValue);
    const hasLatitude = latitudeValue !== '';
    const hasLongitude = longitudeValue !== '';

    if (!type) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: typeValue ? 'unknown_participant_type' : 'missing_participant_type',
        message: typeValue
          ? 'Tipo inválido. Use Tutor ou Bolsista.'
          : 'Tipo de participante não informado.',
      });
    }

    if (!name) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'missing_name',
        message: 'Nome não informado.',
      });
    }

    if (hasLatitude && latitude === null) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'invalid_latitude',
        message: 'Latitude inválida; informe um número entre -90 e 90.',
      });
    } else if (latitude !== null && (latitude < -90 || latitude > 90)) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'invalid_latitude',
        message: 'Latitude fora do intervalo permitido (-90 a 90).',
      });
    }

    if (hasLongitude && longitude === null) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'invalid_longitude',
        message: 'Longitude inválida; informe um número entre -180 e 180.',
      });
    } else if (longitude !== null && (longitude < -180 || longitude > 180)) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'invalid_longitude',
        message: 'Longitude fora do intervalo permitido (-180 a 180).',
      });
    }

    if (hasLatitude !== hasLongitude) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'partial_coordinates',
        message: 'Latitude e longitude devem ser informadas juntas.',
      });
    }

    const hasValidCoordinates =
      latitude !== null &&
      longitude !== null &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
    if (!hasValidCoordinates && !address && !city) {
      rowIssues.push({
        rowNumber,
        severity: 'error',
        code: 'missing_location',
        message: 'Informe coordenadas, endereço ou cidade.',
      });
    } else if (!hasValidCoordinates) {
      rowIssues.push({
        rowNumber,
        severity: 'warning',
        code: 'missing_coordinates',
        message:
          'Participante carregado sem coordenadas; não aparecerá no mapa até que a localização seja confirmada.',
      });
    }

    const hasErrors = rowIssues.some((issue) => issue.severity === 'error');
    issues.push(...rowIssues);
    if (hasErrors || !type || !name) {
      invalidRows.add(rowNumber);
      continue;
    }

    const duplicateKey = [
      type,
      normalizeHeader(name),
      normalizeHeader(city),
      normalizeHeader(state),
      hasValidCoordinates ? latitude : '',
      hasValidCoordinates ? longitude : '',
    ].join('|');
    const originalRow = firstSeen.get(duplicateKey);
    if (originalRow !== undefined) {
      issues.push({
        rowNumber,
        severity: 'warning',
        code: 'duplicate_participant',
        message: `Registro semelhante à linha ${originalRow}; ambos foram mantidos para revisão.`,
      });
    } else {
      firstSeen.set(duplicateKey, rowNumber);
    }

    participants.push({
      id: `${type}-${rowNumber}`,
      type,
      name,
      city,
      state,
      address,
      postalCode,
      location: hasValidCoordinates ? { latitude, longitude, source: 'imported' } : null,
      sourceRow: rowNumber,
    });
  }

  return {
    totalRows,
    participants,
    issues,
    invalidRows: [...invalidRows].sort((left, right) => left - right),
    participantsWithoutCoordinates: participants.filter(
      (participant) => participant.location === null,
    ).length,
  };
}

function matchesHeader(header: string, synonyms: readonly string[]): boolean {
  return synonyms.some((synonym) => {
    const normalizedSynonym = normalizeHeader(synonym);
    return (
      header === normalizedSynonym ||
      (normalizedSynonym.length >= 5 && header.includes(normalizedSynonym))
    );
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return '';
}

function nullableText(value: string): string | null {
  return value === '' ? null : value;
}

function parseParticipantType(value: string): ParticipantType | null {
  const normalized = normalizeHeader(value);
  if (
    normalized === 'tutor' ||
    normalized === 'tutora' ||
    normalized === 'medicotutor' ||
    normalized === 'medicotutora' ||
    normalized === 'tutormedico' ||
    normalized === 'tutormedica'
  ) {
    return 'tutor';
  }
  if (normalized === 'bolsista') {
    return 'fellow';
  }
  return null;
}

function parseCoordinate(value: string): number | null {
  if (value === '') {
    return null;
  }
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
