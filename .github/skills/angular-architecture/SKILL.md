---
name: angular-architecture
description: Define arquitetura, estrutura de pastas, serviços, estado, roteamento e padrões Angular/TypeScript. Use ao iniciar o frontend ou decidir onde uma responsabilidade deve ficar.
---
Inspecione Angular, package.json, angular.json e convenções antes de propor arquitetura. Não atualize versões/migre padrões sem plano. Prefira organização por funcionalidade. Separe apresentação, aplicação, domínio e infraestrutura quando útil. Componentes não fazem parsing Excel nem chamam OSRM. Modele Tutor, Bolsista, Location, RoadRoute, DistanceResult, ImportIssue e AssignmentScenario conforme requisitos reais. Estado de rota: pending/success/unavailable/error; nunca zero como fallback. Use signals/RxJS conforme padrão existente. Injete adaptadores por interface/token. Evite abstrações prematuras. Verifique build/testes e dependências entre camadas.
