---
name: road-routing
description: Integra OSRM ou outro provedor para distância/tempo rodoviário, matrizes, cache, erros e limites.
---
Contrato de resultado: distanceMeters, durationSeconds, status (success/unavailable/error), provider, calculatedAt, profile e geometry opcional. Nunca use zero para falha. Isole chamadas em RoutingProvider. Use Route API para rota individual e Table API para matrizes, conforme documentação/limites atuais. OSRM URL usa longitude,latitude. Valide code, arrays, nulls e respostas incompletas. Use concorrência limitada, timeout, cancelamento, cache e retry seletivo. Não desenhe linha reta como rota. Classificação 50/100 km rodoviária usa distanceMeters; círculos Leaflet continuam geodésicos. Serviço público não tem SLA garantido. Não envie localizações pessoais reais sem autorização e avaliação de privacidade. Teste respostas mockadas, timeout, 429/5xx, sem rota e coordenadas invertidas.
