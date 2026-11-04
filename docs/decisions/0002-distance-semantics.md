# ADR 0002 — Semântica das distâncias
- Status: Proposto
- Círculos 50/100 km representam raio geodésico em linha reta.
- Classificação de proximidade rodoviária usa distância do RoutingProvider.
- Resultado indisponível permanece indisponível; nunca substituir silenciosamente por Haversine.
- UI e relatórios nomeiam claramente cada métrica.
- Se houver necessidade de cobertura por estrada/tempo, avaliar isócronas.
