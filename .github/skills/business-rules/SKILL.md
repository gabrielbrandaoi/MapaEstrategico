---
name: business-rules
description: Define regras de cruzamento tutor-bolsista, elegibilidade por distância, múltiplos candidatos e indicadores.
---
Conceitos: Tutor, Bolsista, CandidateMatch, DistanceResult, Assignment. Não invente capacidade/agenda/especialidade. Faixas: <=50 km; >50 e <=100 km; >100 km. Sem rota é não calculado/indisponível, não zero. "Sem candidato calculado" é diferente de "não foi possível calcular". Indicador de bolsistas cobertos conta bolsistas únicos; relações candidatas contam pares. Bolsista com três tutores é um bolsista coberto e três relações. Cada indicador deve definir denominador/filtros. Candidato não é atribuição confirmada. Teste limites 50, 50.01, 100 e 100.01.
