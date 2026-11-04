import { describe, expect, it } from 'vitest';
import {
  cpfAjustado,
  criarIdentidade,
  extrairCpfMascarado,
  normalizarCpf,
  normalizarIbge,
  normalizarTexto,
} from './import-normalizers';

// Identificadores e nomes exclusivamente sintéticos; não representam pessoas reais.
describe('normalizarTexto', () => {
  it('remove acentos, normaliza caixa e colapsa espaços preservando pontuação', () => {
    expect(normalizarTexto(' \t PESSÔA   SINTÉTICA,\n AÇÃO! ')).toBe('pessoa sintetica, acao!');
    expect(normalizarTexto('AC\u0327A\u0303O')).toBe('acao');
    expect(normalizarTexto(123)).toBe('123');
  });

  it.each([null, undefined, {}, [], true])('não converte valores não escalares: %j', (value) => {
    expect(normalizarTexto(value)).toBe('');
  });
});

describe('normalizarIbge', () => {
  it.each([
    [1234, '001234'],
    [1234.0, '001234'],
    ['1234', '001234'],
    [' 1234.0 ', '001234'],
    ['001234.000', '001234'],
    [0, '000000'],
    ['000000', '000000'],
    ['1.234e3', '001234'],
  ])('normaliza %j para %s', (value, esperado) => {
    expect(normalizarIbge(value)).toBe(esperado);
  });

  it.each([
    null, undefined, true, {}, [], '', ' ', 'abc', '12.3', 12.3, -1,
    '1234567', 1234567, '0000001', '12-34', '1,0', 'NaN', Infinity, NaN,
  ])('rejeita IBGE inválido: %j', (value) => {
    expect(normalizarIbge(value)).toBeNull();
  });
});

describe('normalizarCpf', () => {
  it.each([
    [1, '00000000001'],
    [1.0, '00000000001'],
    ['1.0', '00000000001'],
    [' 00000000001.000 ', '00000000001'],
    ['00000000001', '00000000001'],
    ['000.000.000-01', '00000000001'],
    [0, '00000000000'],
    ['00000000000', '00000000000'],
    ['1e0', '00000000001'],
    ['1.2300E+3', '00000001230'],
    ['1000e-3', '00000000001'],
    ['0.00001e5', '00000000001'],
    ['10000000000e-10', '00000000001'],
    ['1.00000000000000000000e0', '00000000001'],
  ])('normaliza CPF sintético %j sem validar DV', (value, esperado) => {
    expect(normalizarCpf(value)).toBe(esperado);
  });

  it.each([
    null, undefined, true, {}, [], '', ' ', -1, '-1', 1.5, '1.5', NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, '100000000000', 100000000000, '000000000001',
    '000.000.000-001', 'CPF 00000000001', '000/000/000/01', '1,0',
    'XXX.000.000-XX', '1e11', '1e-1', '1.00000000000000000001e0',
    '1e999999', '1e-999999', '1e9007199254740992', '1e', 'NaN', 'Infinity',
  ])('rejeita CPF inválido ou inexato: %j', (value) => {
    expect(normalizarCpf(value)).toBeNull();
  });
});

describe('extrairCpfMascarado', () => {
  it.each(['XXX.132.057-XX', 'xxx.132.057-xx', ' XxX.132.057-xX ', '***.132.057-**'])(
    'extrai somente os seis dígitos de %s',
    (value) => {
      expect(extrairCpfMascarado(value)).toBe('132057');
    },
  );

  it.each([null, 132057, {}, '', 'XXX132057XX', 'XX.132.057-XX', 'XXX.132.057-**',
    'XXX.13A.057-XX', '***.132.057-***', '000.000.000-01'])(
    'rejeita máscara inválida: %j',
    (value) => {
      expect(extrairCpfMascarado(value)).toBeNull();
    },
  );
});

describe('cpfAjustado', () => {
  it('recorta os dígitos centrais somente depois de normalizar e preencher zeros', () => {
    expect(cpfAjustado('1234567')).toBe('012345');
    expect(cpfAjustado('1.0')).toBe('000000');
    expect(cpfAjustado('000.000.000-01')).toBe('000000');
    expect(cpfAjustado('1.234567e6')).toBe('012345');
    expect(cpfAjustado('inválido')).toBe('');
  });
});

describe('criarIdentidade', () => {
  it('cria identidade completa independente de nome e município', () => {
    const identidade = {
      id: 'CPF-00000000001',
      cpf: '00000000001',
      cpfProvisorio: false,
      seisDigitos: '000000',
    };
    expect(criarIdentidade('000.000.000-01', '001234', 'Pessoa Sintética A')).toEqual(identidade);
    expect(criarIdentidade(1, '005678', 'Pessoa Sintética B')).toEqual(identidade);
  });

  it('cria ID provisório estável a partir do nome normalizado, IBGE e máscara', () => {
    const identidade = criarIdentidade('XXX.132.057-XX', '001234', 'Pessoa Sintética A');
    expect(identidade).toEqual({
      id: expect.stringMatching(/^PROV-001234-132057-[0-9a-f]{8}$/),
      cpf: null,
      cpfProvisorio: true,
      seisDigitos: '132057',
    });
    expect(criarIdentidade('***.132.057-**', '1234.0', '  PESSÔA  SINTÉTICA A ')).toEqual(
      identidade,
    );
    expect(criarIdentidade('xxx.132.057-xx', '001234', 'Pessoa Sintética A')).toEqual(
      identidade,
    );
    expect(criarIdentidade('XXX.132.057-XX', '001234', 'Pessoa Sintética B')?.id).not.toBe(
      identidade?.id,
    );
    expect(criarIdentidade('XXX.132.057-XX', '005678', 'Pessoa Sintética A')?.id).not.toBe(
      identidade?.id,
    );
    expect(criarIdentidade('XXX.132.058-XX', '001234', 'Pessoa Sintética A')?.id).not.toBe(
      identidade?.id,
    );
  });

  it('preserva identidade provisória sem inventar código quando IBGE está ausente', () => {
    const identidade = criarIdentidade('XXX.132.057-XX', '', 'Pessoa Sintética');
    expect(identidade).toEqual({
      id: expect.stringMatching(/^PROV-SEM-IBGE-132057-[0-9a-f]{8}$/),
      cpf: null,
      cpfProvisorio: true,
      seisDigitos: '132057',
    });
    expect(criarIdentidade('***.132.057-**', '  ', ' PESSÔA  SINTÉTICA ')).toEqual(
      identidade,
    );
    expect(criarIdentidade('XXX.132.057-XX', '000000', 'Pessoa Sintética')?.id).not.toBe(
      identidade?.id,
    );
    expect(criarIdentidade('XXX.132.057-XX', '001234', 'Pessoa Sintética')?.id).not.toBe(
      identidade?.id,
    );
    expect(criarIdentidade('XXX.132.057-XX', '', 'Pessoa Sintética B')?.id).not.toBe(
      identidade?.id,
    );
  });

  it('não inventa identidade quando faltam dados válidos', () => {
    expect(criarIdentidade(null, '001234', 'Pessoa Sintética')).toBeNull();
    expect(criarIdentidade('invalido', '001234', 'Pessoa Sintética')).toBeNull();
    expect(criarIdentidade('XXX.132.057-XX', 'invalido', 'Pessoa Sintética')).toBeNull();
    expect(criarIdentidade('XXX.132.057-XX', '1234567', 'Pessoa Sintética')).toBeNull();
    expect(criarIdentidade('XXX.132.057-XX', '', '   ')).toBeNull();
    expect(criarIdentidade('XXX.132.057-XX', '001234', '   ')).toBeNull();
  });
});
