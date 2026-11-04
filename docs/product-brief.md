# Product Brief — Mapa Estratégico

## Problema e objetivo
Gestores precisam cruzar localizações de médicos tutores e bolsistas para identificar convergências e planejar deslocamentos efetivos. O sistema apoia a decisão, não substitui critérios institucionais.

## MVP
Importar Excel; validar/m mapear colunas; confirmar localização; mostrar pontos no mapa; círculos geodésicos de 50/100 km; calcular distância rodoviária; classificar até 50, 50–100, acima de 100 e indisponível; filtrar; mostrar múltiplos tutores candidatos; exportar cruzamentos.

## Evolução
Simulação de alocação, restrições de capacidade/agenda/território quando definidas, comparação de cenários, persistência e backend Java/Quarkus se necessário.

## Definições
- Raio geodésico: linha reta entre coordenadas.
- Distância rodoviária: distância retornada pelo roteador pela rede viária.
- Candidato: relação possível, não atribuição aprovada.
- Bolsista coberto: bolsista único com pelo menos um tutor candidato no limite.
- Relação candidata: par tutor-bolsista.

## Perguntas abertas
Bolsista pode ter mais de um tutor? Há limite/capacidade por tutor? Ida ou ida e volta? Tutor parte de endereço fixo? Há restrições regionais/agenda/especialidade? Objetivo é km, tempo, custo ou equilíbrio? Qual precisão de geocodificação? Organização autoriza envio a provedores externos? Não inventar respostas.
