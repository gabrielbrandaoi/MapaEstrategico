---
name: excel-processing
description: Importa Excel/CSV, mapeia colunas, normaliza tutores/bolsistas e valida endereços/coordenadas com SheetJS.
---
Use SheetJS conforme dependência instalada. Informe qual aba foi lida e permita escolher aba se necessário. Trate conteúdo como não confiável; não execute macros/conteúdo ativo. Normalize cabeçalhos para sugerir mapeamento, não dependa de nomes fixos. Mapear tipo Tutor/Bolsista, nome, cidade, UF, endereço, CEP, latitude e longitude. Preserve linha original e não descarte inválidos silenciosamente. Valide duplicidades, coordenadas, vazios e tipos. Geocodifique apenas com confirmação, rate limit, cache e avaliação de privacidade. Não persista planilha por padrão. Na exportação, neutralize CSV formula injection (=,+,-,@). Mostre resumo de linhas válidas/inválidas e participantes sem coordenadas. Teste arquivos vazios, colunas alternativas e dados inválidos.
