# ADR 0003 — Aplicação frontend e chamadas externas opt-in

- Status: Aceito para o MVP.
- Contexto: o repositório continha apenas o Agent Kit e documentos, sem aplicação. Localizações de participantes podem ser dados pessoais e provedores externos recebem requisições geográficas.
- Decisão: criar frontend Angular standalone, sem backend/banco; manter arquivos, participantes e cache apenas em memória; não geocodificar; solicitar consentimento explícito antes de carregar tiles OSM ou calcular uma rota individual no OSRM.
- Alternativas: enviar rotas automaticamente ou geocodificar endereços. Rejeitadas por falta de autorização institucional, avaliação de privacidade, finalidade e requisitos de volume.
- Consequências: mapas base e rotas dependem de terceiros e podem falhar; o OSRM público não tem SLA. A interface envia apenas coordenadas do par selecionado, nunca nomes ou planilha. O consentimento visual não substitui aprovação jurídica/institucional.
- Evolução: substituir serviços públicos por provedores aprovados ou backend Java/Quarkus quando requisitos de privacidade, auditoria, escala e contratação forem definidos.
