export type TipoAba =
  'nominal' | 'contagem' | 'base-bolsistas' | 'alerta-50km' | 'alerta-rodada2' | 'ignorada';
export type CampoImportacao =
  | 'nomeTutor'
  | 'cpfTutor'
  | 'ibgeTutor'
  | 'cnesTutor'
  | 'pcsTutor'
  | 'municipioTutor'
  | 'nomeBolsista'
  | 'cpfBolsista'
  | 'ibgeBolsista'
  | 'km'
  | 'regra'
  | 'regraAgregacao'
  | 'nome'
  | 'cpf'
  | 'ibge'
  | 'cpfAjustado'
  | 'municipio'
  | 'motivo'
  | 'quantidadeBolsistas';

export interface AbaCrua {
  name: string;
  rows: unknown[][];
}

export interface DocumentoCru {
  fileName: string;
  sheets: AbaCrua[];
}

export interface FonteImportacao {
  aba: string;
  linha: number;
  coluna: string | null;
}

export interface OcorrenciaImportacao extends FonteImportacao {
  severidade: 'aviso' | 'erro';
  codigo: string;
  mensagem: string;
}

export interface AbaDetectada {
  aba: AbaCrua;
  tipo: TipoAba;
  cabecalho: number;
  colunas: Partial<Record<CampoImportacao, number>>;
  ocorrencias: OcorrenciaImportacao[];
}

export interface LinhaCruaNominal {
  nomeTutor: unknown;
  cpfTutor: unknown;
  ibgeTutor: unknown;
  cnesTutor: unknown;
  pcsTutor: unknown;
  municipioTutor: unknown;
  nomeBolsista: unknown;
  cpfBolsista: unknown;
  ibgeBolsista: unknown;
  km: unknown;
  regra: unknown;
  regraAgregacao: unknown;
  fonte: FonteImportacao;
}

export interface LinhaCruaContagem {
  nomeTutor: unknown;
  ibgeTutor: unknown;
  municipioTutor: unknown;
  quantidadeBolsistas: unknown;
  regraAgregacao: unknown;
  fonte: FonteImportacao;
}

export interface LinhaCruaBase {
  nome: unknown;
  cpf: unknown;
  ibge: unknown;
  cpfAjustado: unknown;
  fonte: FonteImportacao;
}

export interface LinhaCruaAlerta {
  nome: unknown;
  cpf: unknown;
  ibge: unknown;
  municipio: unknown;
  motivo: unknown;
  quantidadeBolsistas: unknown;
  fonte: FonteImportacao;
}

export interface IdentidadeImportada {
  id: string;
  cpf: string | null;
  cpfProvisorio: boolean;
  seisDigitos: string;
}

export enum OrigemBolsista {
  Ciclo45 = 'Ciclo45',
  NaoSupervisionadoMec = 'NaoSupervisionadoMec',
  EgestorForaMec = 'EgestorForaMec',
  RegraDesconhecida = 'RegraDesconhecida',
}

export enum CriterioAlocacao {
  DezNoMunicipio = 'DezNoMunicipio',
  DoisMunicipios50Km = 'DoisMunicipios50Km',
  SegundaRodada = 'SegundaRodada',
  RegraDesconhecida = 'RegraDesconhecida',
}

export interface Tutor {
  id: string;
  cpf: string | null;
  cpfProvisorio: boolean;
  nome: string;
  ibge: string;
  municipio: string | null;
  cnes: string | null;
  pcs: string | null;
  bolsistas: string[];
  criterio: CriterioAlocacao;
  criterioOriginal: string;
  fonte: FonteImportacao;
}

export interface Bolsista {
  id: string;
  cpf: string | null;
  cpfProvisorio: boolean;
  nome: string;
  ibge: string;
  seisDigitos: string;
  origem: OrigemBolsista;
  origemOriginal: string;
  fonte: FonteImportacao;
}

export interface Vinculo {
  id: string;
  tutorId: string;
  bolsistaId: string;
  kmPlanilha: number | null;
  origem: OrigemBolsista;
  origemOriginal: string;
  criterio: CriterioAlocacao;
  criterioOriginal: string;
  fonte: FonteImportacao;
}

export interface AlertaTutor {
  tutorId: string | null;
  nome: string;
  ibge: string;
  tipo: 'sem-vizinho' | 'poucos-bolsistas' | 'rodada2' | 'sem-bolsista' | 'desconhecido';
  quantidadeBolsistas: number | null;
  motivo: string;
  fonte: FonteImportacao;
}

export interface ContagemTutor {
  tutorId: string | null;
  nome: string;
  ibge: string;
  quantidadeBolsistas: number;
  fonte: FonteImportacao;
}

export interface DadosImportados {
  tutores: Tutor[];
  bolsistas: Bolsista[];
  vinculos: Vinculo[];
  alertas: AlertaTutor[];
  contagens: ContagemTutor[];
}

export interface ResumoAba {
  nome: string;
  tipo: TipoAba;
  cabecalho: number | null;
  linhasLidas: number;
  linhasAceitas: number;
  linhasRejeitadas: number;
}

export interface DivergenciaImportacao extends FonteImportacao {
  codigo: string;
  mensagem: string;
  esperado: number | string | null;
  encontrado: number | string | null;
}

export interface RelatorioImportacao {
  arquivo: string;
  estado: 'sucesso' | 'parcial' | 'erro';
  abas: ResumoAba[];
  totais: {
    tutores: number;
    bolsistas: number;
    vinculos: number;
    tutoresSemBolsista: number;
    cpfsProvisorios: number;
    cnesAusentes: number;
  };
  ocorrencias: OcorrenciaImportacao[];
  divergencias: DivergenciaImportacao[];
}

export interface ResultadoImportacao {
  dados: DadosImportados;
  relatorio: RelatorioImportacao;
}
