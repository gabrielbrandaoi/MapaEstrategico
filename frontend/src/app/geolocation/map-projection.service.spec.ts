import { TestBed } from '@angular/core/testing';
import { MunicipalBaseService } from './municipal-base.service';
import { MapProjectionService } from './map-projection.service';
import { adaptarImportacao } from '../importing/import-domain.adapter';
import { detectarAbas } from '../importing/workbook-classifier';
import { mapearWorkbook } from '../importing/workbook-mapper';
import type { ParsedWorkbook } from '../domain/models';

describe('MapProjectionService', () => {
  it('usa o reader injetado, registra assets ausentes e não impede projeção/importação', async () => {
    const base = new MunicipalBaseService(async () => { throw new Error('asset ausente sintético'); });
    TestBed.configureTestingModule({ providers: [{ provide: MunicipalBaseService, useValue: base }] });
    const workbook: ParsedWorkbook = {
      fileName: 'sintetico.xlsx',
      sheets: [{
        name: 'Nominal', rows: [
          ['NOME_TUTOR', 'CPF_TUTOR', 'IBGE_TUTOR', 'NOME_BOLSISTA',
            'CPF_BOLSISTA', 'IBGE_BOLSISTA', 'km', 'Regra', 'Regra_agregacao'],
          ['Tutor sintético', 1, 123456, 'Bolsista sintético', 2, 234567, 150,
            '45 Ciclo do PMM', 'critério desconhecido'],
        ],
      }],
    };
    const batch = adaptarImportacao(mapearWorkbook(workbook, detectarAbas(workbook)), 'lote-1');
    const result = await TestBed.inject(MapProjectionService).projetar(workbook, batch, 'lote-1');
    expect(base.estado).toBe('erro');
    expect(base.falhas).toHaveLength(2);
    expect(result.pontos).toHaveLength(2);
    expect(result.vinculos).toHaveLength(1);
    expect(result.semLocalizacao).toHaveLength(2);
    expect(batch.report.participants).toHaveLength(2);
  });
});
