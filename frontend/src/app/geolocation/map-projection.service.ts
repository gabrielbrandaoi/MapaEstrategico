import { inject, Injectable } from '@angular/core';
import type { CenarioMapa } from '../domain/mapa.models';
import type { ImportBatch, ParsedWorkbook } from '../domain/models';
import { MunicipalBaseService } from './municipal-base.service';
import { projetarMapa } from './map-projection';

export { projetarMapa, textoPublico } from './map-projection';
export type { ResolverCoordenada } from './map-projection';

@Injectable({ providedIn: 'root' })
export class MapProjectionService {
  private readonly base = inject(MunicipalBaseService);

  async projetar(workbook: ParsedWorkbook, lote: ImportBatch, loteId: string): Promise<CenarioMapa> {
    // Base records failures explicitly and resolves even when an asset is missing.
    // CSV/manual coordinates therefore survive offline asset failures unchanged.
    await this.base.carregar();
    return projetarMapa(workbook, lote, loteId, ibge6 => this.base.resolver(ibge6));
  }
}
