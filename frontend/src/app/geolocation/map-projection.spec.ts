import { vi } from 'vitest';
import type { ImportBatch, ParsedWorkbook } from '../domain/models';
import type { Coordenada } from '../domain/mapa.models';
import { adaptarImportacao } from '../importing/import-domain.adapter';
import { detectarAbas } from '../importing/workbook-classifier';
import { mapearWorkbook } from '../importing/workbook-mapper';
import { projetarMapa, textoPublico } from './map-projection';

const header = [
  'NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'CNES_TUTOR', 'PCS_TUTOR',
  'MUNICIPIO_TUTOR', 'NOME_BOLSISTA', 'CPF_BOLSISTA', 'IBGE_BOLSISTA',
  'km', 'Regra', 'Regra_agregacao',
];
const segunda = '2ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm';
const cinquenta = 'Em até dois municipios com menos de 50km atingiu 5 pmm';

function nominal(rows?: unknown[][]): ParsedWorkbook {
  return {
    fileName: 'sintetico.xlsx',
    sheets: [{
      name: 'Nominal',
      rows: [header, ...(rows ?? [
        ['Tutor sintético', 1, 123456, null, null, 'Município A',
          'Bolsista A', 2, 234567, 150, '45 Ciclo do PMM', segunda],
        ['Tutor sintético', 1, 123456, null, null, 'Município A',
          'Bolsista B', 3, 999999, null, '45 Ciclo do PMM', cinquenta],
      ])],
    }],
  };
}
function lote(workbook: ParsedWorkbook): ImportBatch {
  return adaptarImportacao(mapearWorkbook(workbook, detectarAbas(workbook)), 'lote-1');
}
function resolver(ibge: string): Coordenada | null {
  if (ibge === '999999') return null;
  return {
    latitude: ibge === '123456' ? -10 : -15, longitude: -50,
    origem: 'centroide-municipal', fonte: 'Malha sintética de teste',
  };
}
function simples(): { workbook: ParsedWorkbook; lote: ImportBatch } {
  return {
    workbook: { fileName: 'sintetico.csv', sheets: [{ name: 'CSV', rows: [['nome', 'latitude', 'longitude']] }] },
    lote: {
      fileName: 'sintetico.csv', sheetName: 'CSV', participantType: 'tutor',
      report: {
        totalRows: 2, invalidRows: [], issues: [], participantsWithoutCoordinates: 1,
        participants: [
          {
            id: 'lote-1:tutor-2', type: 'tutor', name: 'Tutor manual', city: 'Cidade manual',
            state: null, address: null, postalCode: null, sourceRow: 2,
            location: { latitude: -10.5, longitude: -48.25, source: 'imported' },
          },
          {
            id: 'lote-1:fellow-3', type: 'fellow', name: 'Bolsista manual', city: null,
            state: null, address: null, postalCode: null, sourceRow: 3, location: null,
          },
        ],
      },
    },
  };
}

describe('projetarMapa: ponte pura sem rede e sem identidade no DTO', () => {
  it('gera um ponto por pessoa, mantém vínculos e delega distâncias/regras ao domínio', () => {
    const workbook = nominal();
    const result = projetarMapa(workbook, lote(workbook), 'lote-1', resolver);
    expect(result.pontos).toHaveLength(3);
    expect(result.pontos.map(p => p.id)).toEqual(['lote-1:p1', 'lote-1:p2', 'lote-1:p3']);
    expect(result.vinculos).toHaveLength(2);
    expect(result.vinculos[0]).toMatchObject({
      id: 'lote-1:v1', tutorId: 'lote-1:p1', bolsistaId: 'lote-1:p2',
      kmPlanilha: 150, segundaRodada: true, regra50Km: false, excede50Km: false, rota: null,
      criterio: segunda, regra: '45 Ciclo do PMM',
    });
    expect(result.vinculos[0].distanciaGeodesicaKm).toBeGreaterThan(500);
    expect(result.vinculos[0].divergente).toBe(true);
    expect(result.vinculos[1].distanciaGeodesicaKm).toBeNull();
    expect(result.vinculos[1].kmPlanilha).toBeNull();
    expect(result.semLocalizacao).toEqual([expect.objectContaining({
      participanteId: 'lote-1:p3', ibge6: '999999',
    })]);
    expect(result.pontos[2].coordenada).toBeNull();
  });

  it.each(['name', 'type', 'sourceRow', 'id', 'city', 'location', 'identityUnverified'])(
    'rejeita alteração de participante (%s) antes de resolver qualquer coordenada', field => {
      const workbook = nominal(), batch = lote(workbook);
      const participant = batch.report.participants[0] as unknown as Record<string, unknown>;
      participant[field] = field === 'sourceRow' ? 100 : 'alterado';
      const reader = vi.fn(resolver);
      expect(() => projetarMapa(workbook, batch, 'lote-1', reader)).toThrow('Lote incompatível');
      expect(reader).not.toHaveBeenCalled();
    },
  );

  it.each(['tutorId', 'fellowId', 'reportedKm', 'sourceRow', 'sheetName', 'fileName'])(
    'rejeita alteração de vínculo (%s)', field => {
      const workbook = nominal(), batch = lote(workbook);
      const link = batch.report.relationships![0] as unknown as Record<string, unknown>;
      link[field] = 'alterado';
      expect(() => projetarMapa(workbook, batch, 'lote-1', resolver)).toThrow('Lote incompatível');
    },
  );

  it('rejeita lote divergente em ordem, relatório, arquivo, contagens ou loteId', () => {
    const workbook = nominal();
    const changed = [
      (b: ImportBatch) => b.report.participants.reverse(),
      (b: ImportBatch) => { b.fileName = 'outro.xlsx'; },
      (b: ImportBatch) => { b.report.totalRows++; },
      (b: ImportBatch) => { b.report.issues.pop(); },
      (b: ImportBatch) => { b.report.relationships!.reverse(); },
    ];
    for (const change of changed) {
      const batch = lote(workbook);
      change(batch);
      expect(() => projetarMapa(workbook, batch, 'lote-1', resolver)).toThrow('Lote incompatível');
    }
    expect(() => projetarMapa(workbook, lote(workbook), 'lote-2', resolver)).toThrow('Lote incompatível');
    expect(() => projetarMapa(workbook, lote(workbook), 'identidade', resolver)).toThrow('opaco');
  });

  it('une alertas pela identidade privada, sem inferir pelo nome de tutores homônimos', () => {
    const workbook = nominal([
      ['Homônimo sintético', 1, 123456, null, null, 'A', 'Bolsista A', 3, 123456, 0,
        '45 Ciclo do PMM', cinquenta],
      ['Homônimo sintético', 2, 123456, null, null, 'A', null, null, null, null, null, null],
    ]);
    workbook.sheets.push({
      name: 'Alerta 50',
      rows: [
        ['NOME', 'CPF', 'IBGE', 'MUNICIPIO', 'MOTIVO'],
        ['Homônimo sintético', 2, 123456, 'A', 'Nenhum município vizinho encontrado'],
      ],
    });
    const result = projetarMapa(workbook, lote(workbook), 'lote-1', resolver);
    const tutores = result.pontos.filter(p => p.tipo === 'tutor');
    expect(tutores).toHaveLength(2);
    expect(tutores[0].alertas).not.toContain('Nenhum município vizinho encontrado');
    expect(tutores[1].alertas).toContain('Nenhum município vizinho encontrado');
    expect(tutores[0].semBolsista).toBe(false);
    expect(tutores[1].semBolsista).toBe(true);
    expect(result.vinculos[0].mesmoMunicipio).toBe(true);
    expect(result.vinculos[0].distanciaGeodesicaKm).toBe(0);
  });

  it('mantém texto de regra desconhecida sem torná-la elegível ou sujeita à regra50', () => {
    const workbook = nominal([
      ['Tutor', 1, 123456, null, null, 'A', 'Bolsista', 2, 234567, 120,
        'regra externa', 'critério externo'],
    ]);
    const result = projetarMapa(workbook, lote(workbook), 'lote-1', resolver);
    expect(result.vinculos[0]).toMatchObject({
      regra: 'regra externa', criterio: 'critério externo',
      segundaRodada: false, regra50Km: false,
    });
  });

  it('remove documentos sintéticos completos/mascarados sem alterar texto literal', () => {
    const document = String(7).padStart(11, '0');
    const masked = ['XXX', '000', '000'].join('.') + '-XX';
    const value = textoPublico(`<img src=x onerror=alert(1)> ${document} x${document}y ${masked}`);
    expect(value).not.toContain(document);
    expect(value).not.toContain(masked);
    const element = globalThis.document.createElement('span');
    element.textContent = value;
    expect(element.querySelector('img')).toBeNull();
    const workbook = nominal([
      [`Tutor ${document}`, 7, 123456, null, null, 'A', 'Bolsista', 8, 234567, 120,
        document, `<b>${document}</b>`],
    ]);
    const result = projetarMapa(workbook, lote(workbook), 'lote-1', resolver);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(document);
    expect(serialized).toContain('<b>[documento omitido]</b>');
    expect(serialized).not.toContain('cpf:');
    expect(result.pontos.every(p => /^lote-1:p\d+$/.test(p.id))).toBe(true);
    expect(result.vinculos.every(v => /^lote-1:v\d+$/.test(v.id))).toBe(true);
  });

  it('preserva Tutor A&B, apóstrofos e controles removidos via textContent', () => {
    const data = simples();
    data.lote.report.participants[0].name = "Tutor A&B D'Ávila\u0000";
    const result = projetarMapa(data.workbook, data.lote, 'lote-1', resolver);
    expect(result.pontos[0].nome).toBe("Tutor A&B D'Ávila");
    const element = document.createElement('span');
    element.textContent = result.pontos[0].nome;
    expect(element.textContent).toBe("Tutor A&B D'Ávila");
    expect(element.textContent).not.toContain('&amp;');
    expect(element.textContent).not.toContain('&#39;');
  });

  it('sem asset mantém todos os dados e lista ausências, nunca inventa 0,0', () => {
    const workbook = nominal();
    const result = projetarMapa(workbook, lote(workbook), 'lote-1', () => null);
    expect(result.pontos).toHaveLength(3);
    expect(result.vinculos).toHaveLength(2);
    expect(result.semLocalizacao).toHaveLength(3);
    expect(result.pontos.every(p => p.coordenada === null)).toBe(true);
    expect(result.vinculos.every(v => v.distanciaGeodesicaKm === null)).toBe(true);
  });

  it('CSV/manual preserva coordenadas importadas, sem lookup municipal nem IBGE inferido', () => {
    const data = simples(), reader = vi.fn(resolver);
    const result = projetarMapa(data.workbook, data.lote, 'lote-1', reader);
    expect(reader).not.toHaveBeenCalled();
    expect(result.pontos[0]).toMatchObject({
      id: data.lote.report.participants[0].id,
      tipo: 'tutor', municipio: 'Cidade manual', ibge6: null,
      coordenada: { latitude: -10.5, longitude: -48.25, origem: 'importada' },
    });
    expect(data.lote.report.participants[0].location?.source).toBe('imported');
    expect(result.semLocalizacao).toHaveLength(1);
    expect(result.vinculos).toEqual([]);
  });

  it('CSV/manual rejeita coordenada fora de range e preserva vínculos com IDs opacos', () => {
    const data = simples();
    data.lote.report.participants[0].location!.latitude = 91;
    data.lote.report.relationships = [{
      tutorId: 'lote-1:tutor-2', fellowId: 'lote-1:fellow-3', reportedKm: null,
      sourceRow: 2, sheetName: 'CSV', fileName: 'sintetico.csv',
    }];
    const result = projetarMapa(data.workbook, data.lote, 'lote-1', resolver);
    expect(result.semLocalizacao).toHaveLength(2);
    expect(result.vinculos[0]).toMatchObject({
      tutorId: 'lote-1:tutor-2', bolsistaId: 'lote-1:fellow-3', distanciaGeodesicaKm: null,
    });
    data.lote.report.relationships[0].tutorId = 'inexistente';
    expect(() => projetarMapa(data.workbook, data.lote, 'lote-1', resolver)).toThrow('Vínculo inconsistente');
  });

  it('CSV/manual preserva também IDs pN e recusa identificador não opaco sem expô-lo', () => {
    const data = simples();
    data.lote.report.participants[0].id = 'lote-1:p1';
    const result = projetarMapa(data.workbook, data.lote, 'lote-1', resolver);
    expect(result.pontos[0].id).toBe(data.lote.report.participants[0].id);
    data.lote.report.participants[0].id = 'identidade-privada';
    expect(() => projetarMapa(data.workbook, data.lote, 'lote-1', resolver))
      .toThrow('Identificador de participante não opaco.');
  });
});
