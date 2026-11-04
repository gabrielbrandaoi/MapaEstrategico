import { CriterioAlocacao, OrigemBolsista } from './import-contracts';

interface RegraTabela<T> {
  texto: string;
  valor: T;
  variantes?: string[];
}

const ORIGENS: RegraTabela<OrigemBolsista>[] = [
  {
    texto: '45 Ciclo do PMM',
    valor: OrigemBolsista.Ciclo45,
  },
  {
    texto: 'Bolsistas não supervisionados segundo base MEC',
    valor: OrigemBolsista.NaoSupervisionadoMec,
  },
  {
    texto: 'Bolsista na base EGESTOR que não aparecem na base MEC',
    valor: OrigemBolsista.EgestorForaMec,
  },
];

const CRITERIOS: RegraTabela<CriterioAlocacao>[] = [
  {
    texto: '10 pmm no municipio - nao precisa deslocar-se',
    valor: CriterioAlocacao.DezNoMunicipio,
  },
  {
    texto: 'Em até dois municipios com menos de 50km atingiu 5 pmm',
    valor: CriterioAlocacao.DoisMunicipios50Km,
  },
  {
    texto: '2ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
    valor: CriterioAlocacao.SegundaRodada,
    variantes: [
      '2a rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      '2o rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      '2º rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      '2° rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      '2.ª rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
      'segunda rodada: sem limite de km, excluindo bolsistas já alocados, para atingir 5 pmm',
    ],
  },
];

const MAPA_ORIGENS = indexar(ORIGENS);
const MAPA_CRITERIOS = indexar(CRITERIOS);

export function mapearOrigem(value: unknown): {
  valor: OrigemBolsista;
  original: string;
  desconhecida: boolean;
} {
  const original = paraTexto(value);
  const valor = MAPA_ORIGENS.get(normalizarRegra(original));
  return {
    valor: valor ?? OrigemBolsista.RegraDesconhecida,
    original,
    desconhecida: valor === undefined,
  };
}

export function mapearCriterio(value: unknown): {
  valor: CriterioAlocacao;
  original: string;
  desconhecida: boolean;
} {
  const original = paraTexto(value);
  const valor = MAPA_CRITERIOS.get(normalizarRegra(original));
  return {
    valor: valor ?? CriterioAlocacao.RegraDesconhecida,
    original,
    desconhecida: valor === undefined,
  };
}

export function interpretarMotivo(value: unknown): {
  tipo: 'sem-vizinho' | 'poucos-bolsistas' | 'desconhecido';
  quantidade: number | null;
  original: string;
} {
  const original = paraTexto(value);
  const normalizado = normalizarRegra(original);
  if (normalizado === normalizarRegra('Nenhum município vizinho encontrado')) {
    return { tipo: 'sem-vizinho', quantidade: null, original };
  }

  const poucos = /^apenas\s+(\d+)\s+bolsistas?\s+alocados(?:\s*\(\s*n\s*<\s*10\s*\))?$/i.exec(
    normalizado,
  );
  const quantidade = poucos?.[1] === undefined ? null : Number(poucos[1]);
  if (
    quantidade !== null &&
    Number.isSafeInteger(quantidade) &&
    quantidade >= 0 &&
    quantidade < 10
  ) {
    return { tipo: 'poucos-bolsistas', quantidade, original };
  }
  return { tipo: 'desconhecido', quantidade: null, original };
}

function indexar<T>(regras: RegraTabela<T>[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const regra of regras) {
    for (const texto of [regra.texto, ...(regra.variantes ?? [])]) {
      mapa.set(normalizarRegra(texto), regra.valor);
    }
  }
  return mapa;
}

function normalizarRegra(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[–—]/g, '-');
}

function paraTexto(value: unknown): string {
  try {
    return value === null || value === undefined ? '' : String(value);
  } catch {
    return '';
  }
}
