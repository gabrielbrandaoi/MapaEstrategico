import type { IdentidadeImportada } from './import-contracts';

/** Normaliza apenas valores escalares; não executa conversões de objetos não confiáveis. */
export function normalizarTexto(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Converte identificadores inteiros sem arredondar a representação textual.
 * A expansão científica opera nos dígitos, não em Number/parseInt.
 */
function normalizarInteiro(value: unknown, tamanho: number): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || value >= 10 ** tamanho) {
      return null;
    }
    return String(value).padStart(tamanho, '0');
  }
  if (typeof value !== 'string') {
    return null;
  }

  const texto = value.trim();
  const decimal = /^(\d+)(?:\.0+)?$/.exec(texto);
  if (decimal) {
    const digitos = decimal[1];
    return digitos.length <= tamanho ? digitos.padStart(tamanho, '0') : null;
  }

  const cientifico = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(texto);
  if (!cientifico) {
    return null;
  }
  const parteInteira = cientifico[1];
  const fracao = cientifico[2] ?? '';
  const expoente = Number(cientifico[3]);
  if (!Number.isSafeInteger(expoente)) {
    return null;
  }
  const digitos = parteInteira + fracao;
  if (/^0+$/.test(digitos)) {
    return '0'.repeat(tamanho);
  }

  const posicaoDecimal = parteInteira.length + expoente;
  if (posicaoDecimal <= 0) {
    return null;
  }
  if (posicaoDecimal < digitos.length && /[1-9]/.test(digitos.slice(posicaoDecimal))) {
    return null;
  }
  const inteiros = digitos.slice(0, posicaoDecimal).replace(/^0+/, '');
  const zerosFinais = Math.max(0, posicaoDecimal - digitos.length);
  if (inteiros.length + zerosFinais > tamanho) {
    return null;
  }
  return (inteiros + '0'.repeat(zerosFinais)).padStart(tamanho, '0');
}

export function normalizarIbge(value: unknown): string | null {
  return normalizarInteiro(value, 6);
}

/** Normalização estrutural somente: não valida dígitos verificadores de CPF. */
export function normalizarCpf(value: unknown): string | null {
  if (typeof value === 'string') {
    const texto = value.trim();
    if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(texto)) {
      return texto.replace(/[.-]/g, '');
    }
  }
  return normalizarInteiro(value, 11);
}

export function extrairCpfMascarado(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const mascara =
    /^(?:XXX\.(\d{3})\.(\d{3})-XX|\*\*\*\.(\d{3})\.(\d{3})-\*\*)$/i.exec(value.trim());
  if (!mascara) {
    return null;
  }
  return mascara[1] !== undefined ? mascara[1] + mascara[2] : mascara[3] + mascara[4];
}

/** Retorna vazio para entrada inválida; o recorte sempre ocorre após padding. */
export function cpfAjustado(cpf: string): string {
  return normalizarCpf(cpf)?.slice(3, 9) ?? '';
}

/**
 * FNV-1a de 32 bits sobre unidades UTF-16, disponível no browser sem dependências.
 * Não anonimiza dados pessoais e não oferece garantia de ausência de colisões.
 */
function hashNome(nome: string): string {
  let hash = 0x811c9dc5;
  for (let indice = 0; indice < nome.length; indice += 1) {
    hash = Math.imul(hash ^ nome.charCodeAt(indice), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function criarIdentidade(
  cpf: unknown,
  ibge: string,
  nome: string,
): IdentidadeImportada | null {
  const completo = normalizarCpf(cpf);
  if (completo !== null) {
    return {
      id: `CPF-${completo}`,
      cpf: completo,
      cpfProvisorio: false,
      seisDigitos: cpfAjustado(completo),
    };
  }

  const seisDigitos = extrairCpfMascarado(cpf);
  // Ausência não equivale ao código numérico 000000 nem permite reconciliação por município.
  const codigoIbge = ibge.trim() === '' ? 'SEM-IBGE' : normalizarIbge(ibge);
  const nomeNormalizado = normalizarTexto(nome);
  if (seisDigitos === null || codigoIbge === null || nomeNormalizado === '') {
    return null;
  }
  return {
    id: `PROV-${codigoIbge}-${seisDigitos}-${hashNome(nomeNormalizado)}`,
    cpf: null,
    cpfProvisorio: true,
    seisDigitos,
  };
}
