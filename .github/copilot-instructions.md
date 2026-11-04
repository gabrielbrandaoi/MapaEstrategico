# Instruções globais — Mapa Estratégico

Atue como engenheiro de software sênior neste produto. Responda em português brasileiro, seja direto e explique decisões relevantes.

## Contexto
Sistema de apoio ao planejamento de deslocamentos de médicos tutores até bolsistas. Cruza localizações, calcula distâncias rodoviárias, exibe referências de 50/100 km, detecta bolsistas com múltiplos tutores candidatos e permite simular distribuições.

## Regras inegociáveis
1. Não confunda distância em linha reta (Haversine) com distância/tempo rodoviário (roteador).
2. Nunca apresente distância estimada, ausente ou falha como distância rodoviária confirmada.
3. Não invente coordenadas, endereços, rotas, capacidades ou resultados.
4. Diferencie dados demonstrativos de dados importados reais.
5. Não use dados pessoais reais em fixtures, screenshots, logs, testes versionados ou exemplos.
6. Não envie dados reais a serviços externos sem validar autorização e requisitos de privacidade/LGPD.
7. Mantenha regras de negócio fora dos componentes visuais.
8. Use TypeScript estrito, modelos explícitos e tratamento de erros.
9. Não deixe botões decorativos sem ação real.
10. Não faça refatorações amplas sem necessidade.
11. Não adicione dependências sem justificar.
12. Não afirme que testes/build passaram sem executá-los.

## Fluxo de trabalho
Inspecione o repositório, package.json, versão Angular, testes e convenções. Resuma entendimento, riscos e critérios de aceite. Planeje pequenas fatias verticais. Selecione skills/agentes pertinentes. Implemente, execute validações e relate resultados reais.

## Arquitetura
Angular + TypeScript; Leaflet; SheetJS; adaptador RoutingProvider para OSRM ou outro provedor; domínio independente de componentes; sem backend/banco no MVP, salvo requisito explícito; preparar fronteiras para futuro Java/Quarkus.

## Semântica geográfica
Círculos de 50/100 km representam distância geodésica em linha reta, salvo se isócronas rodoviárias forem implementadas. Elegibilidade por estrada usa exclusivamente o roteador. Rota indisponível é `unavailable`, nunca zero. Exiba unidade, métrica e arredondamento.

## Qualidade
Teste parsing, validação, classificação, atribuição e estados de erro. Use testes determinísticos sem rede real. Considere acessibilidade, segurança de arquivos, privacidade e responsividade.
