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
- Círculos de referência de 50/130 km e pares de pré-seleção (até o raio configurado, 150 km) são geodésicos; a unidade é km.
- Faixas rodoviárias usam somente `distanceMeters` de rota `success`: `<=50 km`, `>50 e <=100 km`, `>100 km`. `unavailable`, `error` e não calculado continuam distintos.
- “Bolsistas com rota confirmada até 50 km” conta bolsistas únicos. Médias/máximos rodoviários contam pares com rota confirmada. KPIs geodésicos usam bolsistas únicos com coordenadas como denominador.
- Os pares comparados não são atribuições. A simulação de alocação é um cenário separado, não uma atribuição institucional confirmada.

## Simulação de alocação

`domain/allocation.models.ts` define os contratos e a configuração única
`DEFAULT_ALLOCATION_CONFIG`: raio máximo geodésico de **150 km**, mínimo 1 ou 2, máximo 4 e
percentual de dispensa 0,15. `domain/allocation.ts` implementa uma função pura,
sem Angular, Leaflet, serviços externos ou alteração dos vínculos importados.
O limite é inclusivo. KM informado pela planilha e rotas não participam da
seleção nem do ranking.

**Dispensa:** o escore é a distância geodésica ao bolsista geolocalizado mais
próximo, inclusive quando está fora do raio. Esse critério mede o melhor
deslocamento possível de cada tutor, evitando que bolsistas muito remotos
distorçam uma média global. O cálculo do escore é substituível pelo parâmetro
`TutorDistanceScore`. Ordena-se do maior escore para o menor, com desempate por
ID em ordem lexical crescente. São dispensados
`Math.ceil(tutoresComCoordenadasValidas * percentualDispensa)`: por exemplo,
1 de 1, 1 de 6, 2 de 7 e 3 de 20. A dispensa precede a alocação e não depende
do mínimo selecionado.

Tutores sem coordenadas válidas não entram no denominador do ranking: não há
base para afirmar que são distantes; ficam abaixo do mínimo com motivo explícito.
Sem bolsistas com coordenadas válidas, não há ranking nem dispensa. Portanto,
15% refere-se ao conjunto geograficamente avaliável, não necessariamente ao
cadastro inteiro. Coordenadas municipais mantêm sua origem e continuam sendo
aproximações de localidades, não endereços confirmados. Identidades provisórias
são preservadas por ID, sem deduplicação especulativa por nome ou CPF mascarado.

**Estratégia:** heurística gulosa determinística. Primeiro reserva o mínimo
completo, priorizando tutores com menos candidatos disponíveis; a proximidade
e o ID resolvem empates. Um tutor que não puder completar o mínimo não recebe
parciais. Só depois distribui o excedente por proximidade entre os tutores
ativos, até o teto. Bolsistas têm vínculo único. A validação final rejeita
resultados inconsistentes, em vez de exportar ou apresentar sucesso parcial.

A heurística não garante cobertura máxima nem distância total mínima:
decisões locais podem bloquear combinações melhores. Uma evolução possível é
comparar esse baseline com atribuição por fluxo de custo mínimo com ativação
de tutores/lotes mínimos (ou programação inteira), mantendo as mesmas
restrições rígidas. Não se trata de otimização de viagens multiparada.

**Indicadores:** alocados contam IDs únicos de bolsistas; sem tutor incluem
os sem coordenadas; tutores ativos, dispensados e abaixo do mínimo particionam
os tutores. Média e máximo usam exclusivamente as distâncias geodésicas dos
vínculos da simulação, em km, e são ausentes quando não há vínculos.
A distribuição tipada no resultado é calculada em `domain/allocation-distribution.ts`.
Suas linhas são 0, 1, 2, 3, 4, dispensados, abaixo do mínimo e total.
Zero é **subtotal** de dispensados e abaixo do mínimo: não entra novamente
na soma das categorias 1–4 mais os dois status. O total equivale a todos os
tutores importados, inclusive os sem coordenadas. Percentuais usam esse total
(zero quando não há tutores); diferem, portanto, da base geolocalizada dos 15%.
A comparação usa mínimo 2 menos mínimo 1 para contagens e pontos percentuais;
exige os mesmos tutores/configurações, exceto o mínimo.

Os dois mínimos podem ser comparados com a mesma entrada, sem alterar a
planilha original, na aba **Simulações**, sem mapa. Tabela e gráfico recebem
o mesmo resultado tipado; controles, indicadores e exportações ficam no
componente standalone de `simulations/`, não no componente principal.
O gráfico mostra as cargas 0–4; a tabela mantém o detalhamento do zero por status.
Valores e séries não dependem somente de cor, e a tabela permanece acessível.

Chart.js é instalado via npm, empacotado localmente e carregado sob demanda,
sem CDN em execução. Foi escolhido pelo suporte a barras agrupadas, plugins
locais para rótulos, ciclo de vida explícito e exportação PNG, sem wrapper Angular.
O canvas é destruído ao sair da aba e recriado com dados atuais ao retornar.

A **Visão geral** mantém os indicadores da base importada. Seu seletor explícito
**Cenário do mapa** inicia na simulação de mínimo 1 e permite alternar para mínimo
2 ou vínculos importados. A seleção e a legenda correspondente são preservadas
ao visitar outras abas, substituir planilhas ou adicionar CSVs, sem modificar
os dados importados. “Limpar dados” retorna à simulação de mínimo 1.
A instância Leaflet permanece montada, mas só é visível na Visão geral.
CSV/Excel da simulação incluem configuração, status e
motivos, inclusive de tutores sem vínculos e bolsistas não alocados; não
reclassificam distâncias geodésicas como rodoviárias.
As exportações validam também a correspondência exata entre participantes e
cenário. Erros de carregamento do SheetJS ou gravação do Excel são propagados
à interface; não se anuncia sucesso antes de o escritor concluir.

## Mapa municipal offline

- `domain/mapa.models.ts` define `Coordenada`, `PontoMapa`, `VinculoMapa` e `ResumoTutor`, sem dependência de Angular ou Leaflet. Coordenadas municipais têm origem explicitamente diferente de coordenadas importadas.
- A ponte da aplicação reutiliza o mapeamento puro do workbook, valida a correspondência com o lote adaptado e só publica IDs opacos. Essa repetição foi escolhida para manter o importador intocado; exige testes de equivalência para evitar divergência futura entre projeções.
- A base municipal é servida pela própria aplicação. Códigos IBGE de sete dígitos são associados pelos seis primeiros; o gerador deve rejeitar colisões. Geometria simplificada de exibição não é a fonte dos centroides.
- Centroides representam municípios, não endereços de pessoas. Deslocamento visual de marcadores coincidentes não participa dos cálculos.
- O enquadramento nacional usa SW `[-33.75, -73.99]` e NE `[5.27, -28.85]`. Na visualização importada, a seleção de tutor enquadra todos os seus vínculos localizados, sem aplicar o raio dos candidatos de proximidade.
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

Um backend Java/Quarkus poderá assumir autenticação, persistência, auditoria, jobs e matriz de rotas quando requisitos de volume e governança forem definidos. A capacidade de 4 e o mínimo selecionável pertencem à simulação; agendas, deslocamento de ida/volta e função objetivo institucional continuam fora do modelo.
