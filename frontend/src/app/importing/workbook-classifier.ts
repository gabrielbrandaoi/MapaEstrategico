import type {
  AbaCrua,
  AbaDetectada,
  CampoImportacao,
  DocumentoCru,
  OcorrenciaImportacao,
  TipoAba,
} from './import-contracts';

type Papel = 'tutor' | 'bolsista' | 'generico';
type CampoCabecalho =
  | 'nome'
  | 'cpf'
  | 'ibge'
  | 'cnes'
  | 'pcs'
  | 'municipio'
  | 'km'
  | 'regra'
  | 'regraAgregacao'
  | 'cpfAjustado'
  | 'motivo'
  | 'quantidade';
type TipoSchema = Exclude<TipoAba, 'ignorada'>;

interface Resolucao {
  campo: CampoImportacao;
  indices: number[];
}

interface LayoutDetectado {
  tipo: TipoSchema;
  colunas: Resolucao[];
}

/** Normaliza cabeçalho para comparação, removendo acentos e separadores. */
export function normalizarCabecalho(value: unknown): string {
  const normalizado = textoSeguro(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');
  return normalizado.startsWith('empty') ? '' : normalizado;
}

/** Classifica as abas por cabeçalhos, sem usar o nome da aba como evidência. */
export function detectarAbas(documento: DocumentoCru): AbaDetectada[] {
  return documento.sheets.map(detectarAba);
}

function detectarAba(aba: AbaCrua): AbaDetectada {
  let cabecalhoRelacionalParcial: { linha: number; cabecalho: unknown[] } | null = null;
  for (let linha = 0; linha < Math.min(20, aba.rows.length); linha += 1) {
    const cabecalho = aba.rows[linha] ?? [];
    const layouts = identificarLayouts(cabecalho);
    if (layouts.length === 0) {
      if (!cabecalhoRelacionalParcial && ehCabecalhoRelacionalIncompleto(cabecalho)) {
        cabecalhoRelacionalParcial = { linha, cabecalho };
      }
      continue;
    }

    if (layouts.length > 1) {
      return {
        aba,
        tipo: 'ignorada',
        cabecalho: linha,
        colunas: {},
        ocorrencias: [
          ocorrencia(
            aba.name,
            linha + 1,
            null,
            'erro',
            'schema_ambiguo',
            'Cabeçalho compatível com mais de um tipo de aba; classificação não realizada.',
          ),
        ],
      };
    }

    const layout = layouts[0];
    if (layout) return classificarLayout(aba, linha, layout);
  }

  if (cabecalhoRelacionalParcial) {
    return {
      aba,
      tipo: 'ignorada',
      cabecalho: cabecalhoRelacionalParcial.linha,
      colunas: {},
      ocorrencias: ocorrenciasRelacionaisIncompletas(
        aba.name,
        cabecalhoRelacionalParcial.linha,
        cabecalhoRelacionalParcial.cabecalho,
      ),
    };
  }
  return { aba, tipo: 'ignorada', cabecalho: -1, colunas: {}, ocorrencias: [] };
}

function classificarLayout(aba: AbaCrua, linha: number, layout: LayoutDetectado): AbaDetectada {
  const colunas: Partial<Record<CampoImportacao, number>> = {};
  const ocorrencias: OcorrenciaImportacao[] = [];
  for (const { campo, indices } of layout.colunas) {
    if (indices.length > 1) {
      for (const indice of indices) {
        ocorrencias.push(
          ocorrencia(
            aba.name,
            linha + 1,
            indiceParaColuna(indice),
            'erro',
            'cabecalho_duplicado',
            `Mais de uma coluna corresponde ao campo "${campo}"; nenhuma foi selecionada.`,
          ),
        );
      }
    } else if (indices[0] !== undefined) {
      colunas[campo] = indices[0];
    }
  }

  return { aba, tipo: layout.tipo, cabecalho: linha, colunas, ocorrencias };
}

function identificarLayouts(cabecalho: unknown[]): LayoutDetectado[] {
  const cabecalhos = cabecalho.map(normalizarHeaderPalavras);
  const campos = resolverCampos(cabecalhos);
  const tem = (campo: CampoImportacao): boolean => (campos.get(campo)?.length ?? 0) > 0;
  const quantidades = indicesQuantidade(cabecalhos, false);
  const quantidadesContagem = indicesQuantidade(cabecalhos, true);
  const possuiQuantidade = quantidades.length > 0;
  const campo = (origem: CampoImportacao, destino = origem): Resolucao[] => {
    let indices = campos.get(origem) ?? [];
    if (origem === 'quantidadeBolsistas') indices = quantidades;
    if (origem === 'ibgeBolsista' && indices.length === 0) indices = campos.get('ibge') ?? [];
    return indices.length > 0 ? [{ campo: destino, indices }] : [];
  };
  const compor = (
    tipo: TipoSchema,
    bindings: Array<[CampoImportacao, CampoImportacao?]>,
    aceitaNomeBolsistaComoContagem = false,
  ): LayoutDetectado => ({
    tipo,
    colunas: bindings.flatMap(([origem, destino]) => {
      if (origem === 'quantidadeBolsistas' && aceitaNomeBolsistaComoContagem) {
        return quantidadesContagem.length > 0
          ? [{ campo: destino ?? origem, indices: quantidadesContagem }]
          : [];
      }
      return campo(origem, destino ?? origem);
    }),
  });
  const layouts: LayoutDetectado[] = [];

  // B: NOME_bolsista é um nome histórico da coluna de contagem, não um nome.
  if (
    tem('nomeTutor') &&
    tem('ibgeTutor') &&
    tem('municipioTutor') &&
    tem('regraAgregacao') &&
    quantidadesContagem.length > 0 &&
    !tem('cpfTutor') &&
    !tem('cpfBolsista') &&
    !tem('km')
  ) {
    layouts.push(
      compor(
        'contagem',
        [
          ['nomeTutor'],
          ['ibgeTutor'],
          ['municipioTutor'],
          ['regraAgregacao'],
          ['quantidadeBolsistas'],
        ],
        true,
      ),
    );
  }

  // E: a contagem pode vir como n_bolsistas/quantidade/total.
  if (
    tem('nomeTutor') &&
    tem('cpfTutor') &&
    tem('ibgeTutor') &&
    tem('municipioTutor') &&
    possuiQuantidade
  ) {
    layouts.push(
      compor('alerta-rodada2', [
        ['nomeTutor'],
        ['cpfTutor'],
        ['ibgeTutor'],
        ['municipioTutor'],
        ['quantidadeBolsistas'],
      ]),
    );
  }

  if (tem('nome') && tem('cpf') && tem('ibge') && tem('cpfAjustado')) {
    layouts.push(compor('base-bolsistas', [['nome'], ['cpf'], ['ibge'], ['cpfAjustado']]));
  }

  if (tem('nome') && tem('cpf') && tem('ibge') && tem('municipio') && tem('motivo')) {
    layouts.push(compor('alerta-50km', [['nome'], ['cpf'], ['ibge'], ['municipio'], ['motivo']]));
  }

  // Mantém a forma nominal mínima histórica: os quatro campos de identidade.
  // A coluna km é opcional em algumas planilhas legadas.
  if (tem('nomeTutor') && tem('cpfTutor') && tem('nomeBolsista') && tem('cpfBolsista')) {
    layouts.push(
      compor('nominal', [
        ['nomeTutor'],
        ['cpfTutor'],
        ['ibgeTutor'],
        ['cnesTutor'],
        ['pcsTutor'],
        ['municipioTutor'],
        ['nomeBolsista'],
        ['cpfBolsista'],
        ['ibgeBolsista'],
        ['km'],
        ['regra'],
        ['regraAgregacao'],
      ]),
    );
  }

  return layouts;
}

function ehCabecalhoRelacionalIncompleto(cabecalho: unknown[]): boolean {
  const cabecalhos = cabecalho.map(normalizarHeaderPalavras);
  const campos = resolverCampos(cabecalhos);
  const camposRelacionados: CampoImportacao[] = [
    'nomeTutor',
    'cpfTutor',
    'ibgeTutor',
    'municipioTutor',
    'nomeBolsista',
    'cpfBolsista',
    'ibgeBolsista',
  ];
  const haCamposTutor = camposRelacionados
    .filter((campo) => campo.endsWith('Tutor'))
    .some((campo) => (campos.get(campo)?.length ?? 0) > 0);
  const haCamposBolsista = camposRelacionados
    .filter((campo) => campo.endsWith('Bolsista'))
    .some((campo) => (campos.get(campo)?.length ?? 0) > 0);
  return haCamposTutor && haCamposBolsista;
}

function ocorrenciasRelacionaisIncompletas(
  aba: string,
  indiceLinha: number,
  cabecalho: unknown[],
): OcorrenciaImportacao[] {
  const campos = resolverCampos(cabecalho.map(normalizarHeaderPalavras));
  const relacionados: CampoImportacao[] = [
    'nomeTutor',
    'cpfTutor',
    'ibgeTutor',
    'municipioTutor',
    'nomeBolsista',
    'cpfBolsista',
    'ibgeBolsista',
  ];
  const ocorrencias: OcorrenciaImportacao[] = [];
  for (const campo of relacionados) {
    const indices = campos.get(campo) ?? [];
    if (indices.length < 2) continue;
    for (const indice of indices) {
      ocorrencias.push(
        ocorrencia(
          aba,
          indiceLinha + 1,
          indiceParaColuna(indice),
          'erro',
          'cabecalho_duplicado',
          `Mais de uma coluna corresponde ao campo "${campo}"; nenhuma foi selecionada.`,
        ),
      );
    }
  }
  ocorrencias.push(
    ocorrencia(
      aba,
      indiceLinha + 1,
      null,
      'erro',
      'cabecalho_relacional_incompleto',
      'Cabeçalho relacional incompleto: são necessários nome e CPF de tutor e bolsista, além da coluna km.',
    ),
  );
  return ocorrencias;
}

function resolverCampos(cabecalhos: string[]): Map<CampoImportacao, number[]> {
  const campos = new Map<CampoImportacao, number[]>();
  const especificacoes: Array<{
    campo: CampoImportacao;
    papel: Papel;
    tipo: CampoCabecalho;
  }> = [
    { campo: 'nomeTutor', papel: 'tutor', tipo: 'nome' },
    { campo: 'cpfTutor', papel: 'tutor', tipo: 'cpf' },
    { campo: 'ibgeTutor', papel: 'tutor', tipo: 'ibge' },
    { campo: 'cnesTutor', papel: 'tutor', tipo: 'cnes' },
    { campo: 'pcsTutor', papel: 'tutor', tipo: 'pcs' },
    { campo: 'municipioTutor', papel: 'tutor', tipo: 'municipio' },
    { campo: 'nomeBolsista', papel: 'bolsista', tipo: 'nome' },
    { campo: 'cpfBolsista', papel: 'bolsista', tipo: 'cpf' },
    { campo: 'ibgeBolsista', papel: 'bolsista', tipo: 'ibge' },
    { campo: 'km', papel: 'generico', tipo: 'km' },
    { campo: 'regra', papel: 'generico', tipo: 'regra' },
    { campo: 'regraAgregacao', papel: 'generico', tipo: 'regraAgregacao' },
    { campo: 'nome', papel: 'generico', tipo: 'nome' },
    { campo: 'cpf', papel: 'generico', tipo: 'cpf' },
    { campo: 'ibge', papel: 'generico', tipo: 'ibge' },
    { campo: 'cpfAjustado', papel: 'generico', tipo: 'cpfAjustado' },
    { campo: 'municipio', papel: 'generico', tipo: 'municipio' },
    { campo: 'motivo', papel: 'generico', tipo: 'motivo' },
    { campo: 'quantidadeBolsistas', papel: 'generico', tipo: 'quantidade' },
  ];

  for (const [indice, cabecalho] of cabecalhos.entries()) {
    if (!cabecalho || cabecalho.startsWith('empty')) continue;
    for (const especificacao of especificacoes) {
      if (corresponde(cabecalho, especificacao.papel, especificacao.tipo)) {
        adicionarIndice(campos, especificacao.campo, indice);
      }
    }
  }
  return campos;
}

function indicesQuantidade(cabecalhos: string[], incluiNomeBolsista: boolean): number[] {
  return cabecalhos.flatMap((cabecalho, indice) => {
    if (
      corresponde(cabecalho, 'generico', 'quantidade') ||
      corresponde(cabecalho, 'bolsista', 'quantidade') ||
      (incluiNomeBolsista && corresponde(cabecalho, 'bolsista', 'nome'))
    ) {
      return [indice];
    }
    return [];
  });
}

function corresponde(cabecalho: string, papel: Papel, campo: CampoCabecalho): boolean {
  if (!cabecalho || cabecalho === 'empty' || cabecalho.startsWith('empty ')) return false;
  const papelCabecalho = detectarPapel(cabecalho);
  if (papel === 'generico' ? papelCabecalho !== null : papelCabecalho !== papel) return false;

  let restante = cabecalho;
  if (papelCabecalho === 'tutor') {
    restante = restante.replace(/\b(?:tutor(?:a|as|es)?|medic(?:o|a|os|as))\b/g, '');
  } else if (papelCabecalho === 'bolsista') {
    restante = restante.replace(/\b(?:bolsistas?|fellows?)\b/g, '');
  }
  restante = restante.replace(/\b(?:do|da|de|dos|das|em|para|no|na|por)\b/g, '').trim();

  const aliases: Record<CampoCabecalho, string[]> = {
    nome: ['nome', 'nomes', 'name', 'full name', 'nome completo', 'nome da pessoa'],
    cpf: ['cpf', 'documento cpf'],
    ibge: ['ibge', 'codigo ibge', 'cod ibge', 'codigo municipio'],
    cnes: ['cnes'],
    pcs: ['pcs'],
    municipio: ['municipio', 'cidade', 'localidade'],
    km: ['km', 'distancia km', 'distancia em km', 'quilometros'],
    regra: ['regra', 'criterio', 'criterion'],
    regraAgregacao: ['regra agregacao', 'regra agrupamento', 'regra agregada', 'aggregation rule'],
    cpfAjustado: ['cpf ajustado', 'cpf ajustada'],
    motivo: ['motivo', 'reason'],
    quantidade: ['n', 'qtd', 'qtde', 'quantidade', 'numero', 'total', 'count'],
  };
  return aliases[campo].includes(restante);
}

function detectarPapel(cabecalho: string): Exclude<Papel, 'generico'> | null {
  const tutor = /\b(?:tutor(?:a|as|es)?|medic(?:o|a|os|as))\b/.test(cabecalho);
  const bolsista = /\b(?:bolsistas?|fellows?)\b/.test(cabecalho);
  if (tutor === bolsista) return null;
  return tutor ? 'tutor' : 'bolsista';
}

function adicionarIndice(
  campos: Map<CampoImportacao, number[]>,
  campo: CampoImportacao,
  indice: number,
): void {
  const indices = campos.get(campo) ?? [];
  indices.push(indice);
  campos.set(campo, indices);
}

function ocorrencia(
  aba: string,
  linha: number,
  coluna: string | null,
  severidade: 'aviso' | 'erro',
  codigo: string,
  mensagem: string,
): OcorrenciaImportacao {
  return { aba, linha, coluna, severidade, codigo, mensagem };
}

function indiceParaColuna(indice: number): string {
  let numero = indice + 1;
  let resultado = '';
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    resultado = String.fromCharCode(65 + resto) + resultado;
    numero = Math.floor((numero - 1) / 26);
  }
  return resultado;
}

function normalizarHeaderPalavras(value: unknown): string {
  return textoSeguro(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function textoSeguro(value: unknown): string {
  try {
    return value === null || value === undefined ? '' : String(value);
  } catch {
    return '';
  }
}
