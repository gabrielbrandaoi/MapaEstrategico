# Base geográfica local e ponte de projeção

## Decisão e escopo

Dados reais de **geometria municipal**, não uma tabela de sedes nem coordenadas de
pessoas. Implementação restrita a `frontend/public/geo`, `frontend/tools/geo`,
`frontend/src/app/geolocation` e este documento. Sem backend, dependências novas,
mudanças no importador ou nos modelos congelados. Não acessa planilhas pessoais.

O mapa do Brasil é representado pela coleção dos **27 polígonos/multipolígonos de
UFs**, com ilhas e anéis internos preservados; não foi inventado um polígono
envolvente. As bordas externas da coleção formam o contorno nacional.

## Fonte, termos e rastreabilidade

Fonte direta oficial: [API IBGE de malhas v3](https://servicodados.ibge.gov.br/api/docs/malhas?versao=3).
Parâmetros fixados: `periodo=2022`, `qualidade=maxima`,
`formato=application/vnd.geo+json`; `intrarregiao=municipio` ou `UF`,
ambos no endpoint `/api/v3/malhas/paises/BR`.

- Municípios: **5.570** feições; 56.132.164 bytes na fonte.
- UFs: **27** feições; 1.001.279 bytes na fonte.
- Data de aquisição, URLs completas, SHA-256 das fontes, declaração de publicação
  pública e SHA-256 dos derivados: `public/geo/provenance.json`.
- O gerador fixa também os hashes das duas fontes no código; mudança na resposta
  oficial exige revisão explícita, não atualização silenciosa.
- A [publicação oficial de downloads de 2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/)
  foi consultada e declara **“Todos os arquivos aqui disponíveis são públicos.”**
  O hash da página consultada e essa declaração estão no manifesto. Esta é a
  evidência de termos disponível; **não equivale a uma identificação de licença
  CC0/CC-BY/SPDX**, e nenhuma delas é afirmada. A página específica de uso de dados
  do portal IBGE respondeu 403. Para distribuição que exija instrumento formal de
  licenciamento, a confirmação adicional com o IBGE continua necessária.
- Alternativa legítima consultada: `tbrugz/geodata-br`, com fonte IBGE declarada e
  `LICENSE.md` CC0 1.0; não foi usada porque a fonte oficial respondeu e oferece
  referência temporal explícita. Não misturamos sua licença com os dados oficiais.

**Atribuição a manter na apresentação:** “Fonte: IBGE, malhas 2022; centroides
municipais e simplificação: Mapa Estratégico.” Texto completo em
`geo/ATTRIBUTION.txt`. O serviço não injeta elementos visuais: quem renderiza deve
exibir a atribuição. Nenhum download recebe dados da planilha.

## Método dos centroides

`tools/geo/geometry.mjs` usa exclusivamente JS nativo:

1. Valida Polygon/MultiPolygon, fechamento, valores finitos e ranges de longitude
   e latitude. Exige código municipal de **sete dígitos**.
2. Indexa os seis primeiros dígitos. **Falha** se dois códigos de sete diferentes
   compartilham esse prefixo, ou se uma feição municipal é duplicada.
3. Usa **toda a geometria municipal recebida antes de qualquer simplificação
   local**, incluindo ilhas e buracos. A própria API fornece malhas simplificadas;
   não se afirma usar o shapefile original de resolução integral.
4. Projeta cada município em **Lambert azimutal equivalente esférica (LAEA)**,
   centrada no centro da sua caixa geográfica, com raio autálico WGS84
   **6.371.007,1809 m**. Não é média de vértices.
5. Calcula centroide planar por área (fórmula shoelace), soma ilhas proporcionalmente
   à área e subtrai buracos por papel do anel, independente de orientação.
6. Segmentos GeoJSON são interpolados linearmente em longitude/latitude. Densifica
   inicialmente com passo máximo 0,01°, refina pela metade e exige deslocamento
   entre soluções sucessivas **≤ 0,5 m**; falha se não convergir. Converte o
   centroide pela inversa da mesma projeção.
7. Exporta `{ "ibge6": [latitude, longitude] }`, seis casas decimais.

Entrada/saída interpretadas como coordenadas geográficas WGS84 (EPSG:4326; GeoJSON
em `[longitude, latitude]`). A origem cartográfica IBGE é SIRGAS 2000; a aproximação
WGS84 é apropriada à finalidade de visualização, não uma transformação geodésica
de alta precisão. **Convergência numérica não é acurácia da fonte.** A definição de
centroide depende da projeção; a formulação esférica não afirma área elipsoidal exata.
Malhas com quatro casas decimais e simplificação upstream limitam a precisão real.
Um centroide de área pode cair fora de um município côncavo ou sobre água. Não
representa domicílio/sede/estabelecimento nem valida deslocamento real de pessoas.

## Simplificação do contorno

Douglas–Peucker iterativo, por anel, em projeção equirretangular métrica fixa
(latitude padrão 15°). Preserva Polygon/MultiPolygon, todos os anéis e ilhas.

Após simplificar e arredondar, verifica autointerseções de **todos os anéis das
27 UFs**, incluindo cruzamentos, contatos não adjacentes e retrocessos sobre a
mesma aresta. Um candidato inválido é recalculado com metade da tolerância até
12 vezes. Se necessário, preserva o anel original **somente se ele for válido**,
sem arredondá-lo; caso contrário a geração falha. Há regressão da geometria real
do Pará (`codarea=15`) usando a fonte oficial em cache. A fonte do Amazonas
contém cruzamentos preexistentes; o anel simplificado publicado passa pela mesma
validação final. Essa verificação de anéis não substitui validação de topologia
compartilhada entre municípios/UFs ou relações de contenção de todos os polígonos.

Limite configurado: **1.000 m**, relativo à **fonte baixada**, não ao limite físico
ou ao shapefile integral. Depois de arredondar a seis casas, verifica cada vértice
original contra o segmento simplificado correspondente. A distância a um segmento
é convexa: o limite vale também para cada segmento linear original entre vértices.
A continuidade da projeção de cada cadeia sobre sua corda dá o limite dirigido
inverso. O fator global `1/cos(15°)` limita comprimento esférico pelo comprimento
no plano; assim o limite planar validado é convertido em limite conservador sobre
a esfera. Falha/refina se o limite configurado for ultrapassado.

Resultado registrado no manifesto: limite máximo validado **949,77 m**; convergência
máxima observada dos centroides **0,027 m** (apenas numérica). Anéis e fronteiras
estaduais são simplificados independentemente: **não** é uma malha topológica de
arestas compartilhadas; podem aparecer pequenas fendas/sobreposições entre UFs.
Não usar para decisões cadastrais, pertencimento legal ou análise de área precisa.

## Assets e execução

Assets runtime, todos da mesma origem:

| Caminho relativo ao `base href` | Conteúdo | Tamanho inicial |
|---|---|---:|
| `geo/municipal-centroids.json` | 5.570 entradas IBGE6 → `[lat, lon]` | 180.981 bytes |
| `geo/br-ufs.geojson` | FeatureCollection real com 27 UFs | 308.013 bytes |
| `geo/provenance.json` | Fontes, termos, métodos, checksums | ~3 kB |
| `geo/ATTRIBUTION.txt` | Atribuição e ressalvas | ~1 kB |

O frontend já publica `public/`; nenhum manifest/config precisa ser alterado.
Os arquivos derivam de geometria, sem dependência de rede externa em runtime.
Servir os estáticos localmente ou pré-disponibilizá-los no ambiente offline.
Não há service worker novo: uma primeira visita sem os estáticos disponíveis
continua sendo uma falha explícita, não uma promessa de instalação PWA/offline.

Na raiz do repositório, com Node 22 no PATH:

```powershell
node frontend/tools/geo/generate.mjs --download
node frontend/tools/geo/generate.mjs
node --test frontend/tools/geo/geometry.test.mjs
```

`--download` consulta primeiro a declaração oficial de publicação pública, baixa
somente as duas malhas e verifica hashes fixados. Sem a flag, gera a partir de
`tools/geo/.cache`, verificando checksums; a cache não é versionada.
Sem cache e sem rede, a regeneração falha claramente, mas os assets já versionados
continuam utilizáveis. Não há base demonstrativa de fallback.

## Contratos para integração

### `MunicipalBaseService`

- `carregar(): Promise<void>`: deduplica chamadas concorrentes, carrega os recursos
  independentemente e mantém os válidos. A Promise resolve inclusive na falha de
  um asset para não impedir a importação; **consultar estado e falhas é obrigatório
  para comunicar indisponibilidade**. Nova chamada tenta apenas os faltantes.
- `resolver(ibge6: string): Coordenada | null`: lookup exato de seis dígitos;
  sete dígitos/espacos/desconhecidos retornam `null`, sem inferência ou sede fallback.
- `geojson(): FeatureCollection<Polygon | MultiPolygon> | null`.
- `estado`: `nao-carregada | carregando | pronta | parcial | erro`.
- `falhas`: lista pública de mensagens estáticas, sem exceções/conteúdo pessoal.
- `origem` das coordenadas: `centroide-municipal`; `fonte` descreve método/IBGE.
- `GEO_ASSET_READER` permite substituir o leitor em testes. Implementação padrão
  usa `fetch`, mesma origem, respeita `document.baseURI`, bloqueia redirects e
  limita espera a 15 segundos. Não depende de HttpClient/TestBed de HTTP.
- O asset municipal é validado atomicamente (uma entrada inválida rejeita o todo).
  Envelope Brasil auxilia a detectar coordenadas invertidas; uma inversão que
  ainda caiba no envelope não pode ser detectada universalmente sem outra evidência.

### `MapProjectionService`

Arquivo congelado de integração: `geolocation/map-projection.service.ts`.

```ts
projetar(
  workbook: ParsedWorkbook,
  lote: ImportBatch,
  loteId: string,
): Promise<CenarioMapa>
```

Serviço só carrega a base e chama a função pura. Em falha da base, mantém pontos,
vínculos e coordenadas importadas; localizações municipais indisponíveis aparecem
em `semLocalizacao`, **nunca** em `(0,0)`. O contorno pode permanecer disponível
quando os centroides falham, e vice-versa.

### Ponte pura para validação agregada local

`geolocation/map-projection.ts` (também reexportada pelo serviço):

```ts
type ResolverCoordenada = (ibge6: string) => Coordenada | null;
projetarMapa(workbook, lote, loteId, resolverCoord): CenarioMapa
```

Não importa Angular nem lê arquivos/rede. Pode ser transpilada para Node com o
TypeScript já instalado; o chamador lê workbook/asset localmente e imprime apenas
contagens agregadas (ex.: pontos, vínculos e códigos sem cobertura), sem nomes ou
documentos. `loteId` deve seguir `lote-N` (1 a 9 dígitos numéricos).

**Nominal/estruturado:** reusa `detectarAbas`, `mapearWorkbook` e
`adaptarImportacao(replay, loteId)` sem modificar os originais. Compara o
`ImportBatch` **inteiro**, recursivamente: papéis, nomes, ordem, IDs, `sourceRow`,
localizações, metadados, vínculos, relatório e demais campos. Divergência resulta
em erro genérico, antes de chamar o resolver ou construir DTOs públicos. Somente
após igualdade integral associa as identidades privadas da mesma saída adaptada
aos IDs opacos. Não infere identidade por nome nem usa posição sem validação.
O índice privado existe apenas durante a chamada, não vira estado do serviço.

Um ponto por pessoa, todos os vínculos importados preservados, inclusive segunda
rodada acima de 100 km e critérios desconhecidos. `kmPlanilha`, regra/critério
originais sanitizados e flags correspondentes ficam em `VinculoMapa`.
Alerta é associado por `raw.tutorId`, nunca pelo nome. A função delega distâncias,
divergência e flags finais a `domain/tutor-map-metrics.calcularVinculos`; não duplica
fórmulas ou escolhe tutores. Não chama roteador; `rota` começa em `null`.

**CSV/manual simples:** usa o lote já validado pelo importador e seu mapeamento
escolhido, sem reinterpretar coordenadas, inferir município/IBGE ou apagar
localizações importadas. Coordenada válida gera origem `importada`; IBGE é `null`.
IDs do importador são preservados: **`ponto.id === participant.id`** em ambos os
fluxos. No simples, valida o formato opaco `lote-N:tutor-L`/`lote-N:fellow-L`
coerente com `sourceRow`, ou `lote-N:pM`. Vínculos existentes são validados sem
trocar os IDs de participantes.
Não há replay equivalente de CSV porque a API não recebe o mapeamento manual.
O chamador deve passar o lote da mesma operação de importação.

DTO público não inclui documento nem identidade raw; textos de nomes, municípios,
regras, alertas e fontes têm documentos completos/mascarados e controles removidos.
**Não aplica encoding HTML:** mantém literalmente `&`, apóstrofos e demais
caracteres para evitar entidades visíveis via interpolação Angular/`textContent`.
O resultado é texto, não HTML confiável: consumidores devem continuar usando
interpolação Angular ou APIs de texto seguras, nunca `innerHTML`/HTML arbitrário.
Nenhum dado pessoal é persistido/enviado.

## Validação

- Specs Angular com leitor sintético, sem `fetch` real: estado, falhas parciais,
  retry de recurso faltante, prefixo, código desconhecido, ranges/inversão,
  validação de geometria, replay integral, IDs opacos, homônimos, join de alertas,
  segunda rodada, critérios desconhecidos, ausências e CSV/manual.
- Testes Node nativos: centroide por área (não média de vértices), buracos/ilhas,
  orientação, convergência, colisões de prefixo, geometrias inválidas, simplificação
  com limite e integridade/cobertura dos assets versionados.
- As fixtures são exclusivamente sintéticas. Nenhum teste abre dados pessoais.
- Cobertura exata de uma planilha real só pode ser afirmada após validação local
  autorizada; a base fixa a edição 2022 e não supõe equivalência com códigos futuros.

Validação executada nesta entrega: **299 testes Angular em 19 arquivos**, **5
testes Node**, TypeScript estrito de aplicação e specs e build de produção
aprovados. Build mantém o aviso já existente de dependência CommonJS do Leaflet.
A regeneração sem rede a partir da cache reproduziu os checksums dos dois assets.

Correção de revisão posterior: **39 testes focados de geolocation**, **7 testes
Node** (incluindo Pará real e todas as 27 UFs) e TypeScript estrito app/spec
aprovados; a suite completa não foi repetida nessa correção. Regeneração apenas
pela cache, sem download. Centroides permanecem idênticos. Novo SHA-256 de
`br-ufs.geojson`:
`2b0c57c031a8f2be32a3fce686ab8928e5bd9ff03120384f445190d806a525ea`.
