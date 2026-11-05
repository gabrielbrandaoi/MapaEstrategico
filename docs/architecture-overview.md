# Arquitetura implementada

Aplicação Angular standalone em `frontend/`, sem backend ou banco no MVP. O fluxo funcional é: arquivos locais → escolha de aba/cabeçalho, mapeamento e tipo do arquivo quando necessário → validação por lote → cenário em memória (workbook substitui; cadastro simples acumula) → resolução municipal local → mapa e pares de proximidade → rota individual opcional → indicadores e exportação.

## Camadas e fronteiras

- `src/app/domain/`: modelos tipados, Haversine, classificação de distância rodoviária e geração de pares próximos.
- `src/app/importing/`: pipeline de leitura SheetJS, cabeçalhos, classificação, normalização, conciliação e relatório. `ImportadorPlanilhaService` encapsula o fluxo; `import-domain.adapter.ts` traduz os novos modelos de importação aos contratos existentes de apresentação.
- `src/app/geolocation/`: resolução municipal local e projeção dos dados importados para contratos do mapa, sem alterar o pipeline de importação.
- `src/app/map/`: componente e adaptador Leaflet; grupos de camadas reutilizáveis, contorno local, marcadores municipais, vínculos e círculos geodésicos. Tiles somente após consentimento.
- `src/app/routing/`: contrato `RoutingProvider` e adaptador OSRM; chamada individual com timeout, cache em memória e estados `success`/`unavailable`/`error`.
- `src/app/reports/`: exportação XLSX/CSV; valores textuais CSV são escapados contra formula injection.
- `src/app/app.ts` e `app.html`: orquestração do fluxo, estado Angular signals e apresentação. Não fazem parsing de workbook nem contêm as regras geográficas.

SheetJS é carregado sob demanda. O mapa permanece disponível sem participantes, com contorno local. Não há Nominatim/geocodificação externa, envio automático de coordenadas, persistência de planilhas ou dados demonstrativos.

As tabelas de participantes, pares e vínculos são paginadas em 100 linhas apenas
na apresentação; filtros, totais e exportações continuam usando o conjunto
completo. Um índice derivado por ID evita buscas lineares repetidas. A geometria
dos pares depende do cadastro, não das respostas de roteamento.

A sessão Leaflet reconcilia marcadores por chave. Zoom e resize atualizam posições
sem reconstruir os grupos; alteração de dados atualiza ícone, popup e seleção.
O agrupamento municipal permanece distinto de clustering espacial por zoom.
Medições, limites e próximos passos estão no
[relatório de desempenho](performance-report.md).

## Contratos e métricas

- KPIs são calculados como funções puras em `frontend/src/app/domain/dashboard-metrics.ts`, separados da apresentação Angular.
- Arquivos podem ser importados em lotes separados na mesma sessão; cada lote mantém relatório e IDs opacos próprios. No cadastro simples sem coluna de papel, a categoria do arquivo precisa ser selecionada explicitamente.
- Contratos `LinhaCrua*`, `Tutor`, `Bolsista`, `Vinculo`, `AlertaTutor` e relatório rico ficam na camada de importação, evitando modificar o Domínio nesta entrega. As funções puras não dependem de Angular ou SheetJS. Somente o leitor e a fachada usam Angular; o leitor é a fronteira SheetJS.
- O pipeline processa todas as abas por esquema de cabeçalhos. A nominal fornece participantes/vínculos; a base auxiliar ajuda a reconciliar CPF mascarado; contagens/alertas conferem a nominal sem criar vínculos extras. IDs provisórios usam IBGE, seis dígitos centrais e hash estável do nome. O cálculo de `cpf_ajustado` sempre ocorre após padding para 11 dígitos. Ambiguidades, conflitos e regras desconhecidas são reportados.
- `kmPlanilha` é adaptado para `ImportedRelationship.reportedKm`, sem produzir `RoadRoute`. CPFs não passam ao modelo de apresentação; a flag `cpfProvisorio` é adaptada a `identityUnverified`. Tutores sem bolsistas são mantidos e recebem alertas, sem posições artificiais no mapa.
- Vínculos importados são `ImportedRelationship`, separados de `ProximityPair` e `RoadRoute`: KM não é transformado em rota `success`, não altera KPIs rodoviários confirmados e não exige geocodificação. Sua tabela/exportação explicita a fonte e não exporta CPFs. Abas de agregação/alerta não são automaticamente acumuladas como participantes.
- Coordenadas são latitude/longitude WGS84 e precisam estar nos intervalos `[-90, 90]` e `[-180, 180]`.
- Círculos e pares de pré-seleção (até 100 km) são geodésicos; a unidade é km.
- Faixas rodoviárias usam somente `distanceMeters` de rota `success`: `<=50 km`, `>50 e <=100 km`, `>100 km`. `unavailable`, `error` e não calculado continuam distintos.
- “Bolsistas com rota confirmada até 50 km” conta bolsistas únicos. Médias/máximos rodoviários contam pares com rota confirmada. KPIs geodésicos usam bolsistas únicos com coordenadas como denominador.
- Os pares comparados não são atribuições. Sem restrições/função objetivo institucionais, não se gera alocação otimizada.

## Mapa municipal offline

- `domain/mapa.models.ts` define `Coordenada`, `PontoMapa`, `VinculoMapa` e `ResumoTutor`, sem dependência de Angular ou Leaflet. Coordenadas municipais têm origem explicitamente diferente de coordenadas importadas.
- A ponte da aplicação reutiliza o mapeamento puro do workbook, valida a correspondência com o lote adaptado e só publica IDs opacos. Essa repetição foi escolhida para manter o importador intocado; exige testes de equivalência para evitar divergência futura entre projeções.
- A base municipal é servida pela própria aplicação. Códigos IBGE de sete dígitos são associados pelos seis primeiros; o gerador deve rejeitar colisões. Geometria simplificada de exibição não é a fonte dos centroides.
- Centroides representam municípios, não endereços de pessoas. Deslocamento visual de marcadores coincidentes não participa dos cálculos.
- O enquadramento nacional usa SW `[-33.75, -73.99]` e NE `[5.27, -28.85]`. Seleção de tutor enquadra seus vínculos localizados, sem aplicar o corte de 100 km dos candidatos de proximidade.
- Linhas são conexões entre localidades, não trajetos rodoviários. O contrato atual de roteamento não fornece geometria.
- Comparação entre planilha e geodésica: alerta quando `abs(kmPlanilha - distanciaGeodesicaKm) > max(15, 0.20 * distanciaGeodesicaKm)`. O critério usa ambos os limites para evitar alertas percentuais excessivos perto de zero. Ausências não participam da comparação.
- A regra de 50 km sinaliza excedentes na planilha ou geodésica; segunda rodada é uma exceção esperada, identificada separadamente.
- Resumos por tutor apresentam mínimo, média e máximo de cada métrica separadamente, contando apenas valores disponíveis. Falha de roteamento não substitui nem apaga as outras distâncias.
- Um novo workbook substitui o cenário ativo; cadastros simples continuam acumulativos. As respostas assíncronas antigas não podem repovoar um cenário substituído.

## Serviços externos

- OpenStreetMap: tiles Leaflet padrão, atribuídos, desativados por padrão. Consentimento informa que o provedor recebe pedidos de mosaicos/área visualizada.
- OSRM público: `https://router.project-osrm.org/route/v1/driving/{lon},{lat};{lon},{lat}?overview=false&steps=false`; envia apenas as coordenadas do par depois de confirmação explícita. Timeout de 15 s, uma chamada por clique e cache apenas em memória. Sem retry automático ou SLA.
- Não há geocodificação. Endereços/cidades não são enviados nem considerados coordenadas verificadas.

Autorização institucional, finalidade, base legal, contratos e política de privacidade precisam ser avaliados pelos responsáveis; a interface não declara conformidade LGPD.

## Evolução

Um backend Java/Quarkus poderá assumir autenticação, persistência, auditoria, jobs e matriz de rotas quando requisitos de volume e governança forem definidos. Capacidades, agendas, múltiplos vínculos, deslocamento de ida/volta e função objetivo permanecem decisões pendentes; não estão simulados por heurística.
