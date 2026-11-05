# Desempenho e navegacao do mapa

## Escopo e metodo

Medicoes em 05/11/2026, Windows, Angular 21, build de producao, navegador integrado
e Node local. Nenhum dado pessoal real, dependencia nova ou servico externo foi
utilizado nos benchmarks. Tiles e roteamento ficaram desativados.

A base inicial foi **315 testes em 22 arquivos**, todos aprovados, e build aprovado.
Nao eram 45 testes. Os 45 cenarios historicos nao representam a suite atual.

As medicoes de navegador sao amostras exploratorias locais, nao percentis nem SLA.
Incluem automacao, processamento Angular, calculos, DOM e Leaflet; nao isolam o
tempo puro de importacao ou de desenho. Heap e uma leitura aproximada de
`performance.memory.usedJSHeapSize`, nao memoria retida apos GC.

### Carga sintetica de navegador

Planilhas de 100, 1.000 e 5.000 participantes, 10% tutores, demais bolsistas,
coordenadas distintas em grade:

```text
latitude(i)  = -23 + (i % 100) * 0.01
longitude(i) = -46 + floor(i / 100) * 0.01
```

Nome sintetico por indice; sem CPF, endereco real ou municipio resolvido.
Cada execucao com pagina recarregada. A medicao de leitura vai da selecao do arquivo
ate a disponibilidade do botao de validacao. A de importacao vai do clique nesse
botao ate a primeira linha de participantes e o primeiro marcador no DOM.
`requestAnimationFrame` observa bloqueios durante a importacao.

| Participantes | Leitura XLSX inicial | Importacao ate DOM inicial | Maior intervalo de frame | Heap aproximado (MiB) | Linhas / marcadores |
|---:|---:|---:|---:|---:|---:|
| 100 | 88 ms | 204 ms | 96 ms | 22 MB | 100 / 100 |
| 1.000 | 122 ms | 850 ms | 417 ms | 49 MB | 1.000 / 1.000 |
| 5.000 | 238 ms | 13.455 ms | 7.033 ms | 354 MB | 5.000 / 5.000 |

Navegacao em pagina limpa, viewport 1280 x 900, 1.000 participantes:
3 cliques de zoom separados por 350 ms e mais 500 ms de observacao.
Resultado inicial: 94 frames em 2.047 ms, **45,9 FPS observados**, intervalo
maximo de **233 ms**. Nao e benchmark de GPU nem garantia de fluidez.
Com 5.000 pontos houve travamentos e timeouts da automacao; nao se obteve FPS
confiavel para esse volume.

Selecao do primeiro participante via botao da tabela, ate dois frames:
**504 ms**, com **2.000 insercoes e 2.000 remocoes** de marcadores observadas
por `MutationObserver` na mesma carga de 1.000 participantes.

Para gerar novas cargas equivalentes, em `frontend`:

```powershell
node scripts\generate-performance-workbooks.cjs C:\temp\mapa-perf
```

O gerador nao inclui municipio para impedir que o agrupamento municipal reduza
artificialmente a quantidade de marcadores deste teste de estresse. As medicoes
antes/depois usam os mesmos tres arquivos, mantidos fora do repositorio.
Versoes do ambiente: Node v26.13.0 e npm 11.20.0.

Para repetir no browser: iniciar `npx.cmd ng serve --configuration production`,
recarregar antes de cada arquivo, manter tiles/rotas desligados, aceitar o
mapeamento sugerido e clicar em **Validar e adicionar dados**. Contar
`.people-panel tbody tr` e `.map-host .leaflet-marker-icon`, alem dos tempos.
No ensaio de selecao, disparar o primeiro botao de `.people-panel tbody` e
observar dois `requestAnimationFrame`. No de zoom, manter a area do mapa visivel
e registrar todos os intervalos de frame durante os tres cliques.

### Bundle inicial

`npx.cmd ng build --stats-json`, sem instalar analisador adicional:

| Recurso | Bytes aproximados, sem compressao |
|---|---:|
| Inicial total | 390,10 kB |
| main | 355,63 kB |
| CSS | 33,75 kB |
| SheetJS, chunk lazy | 502,57 kB |
| Leaflet, chunk lazy | 149,55 kB |
| GeoJSON local | 308.014 B |
| Centroides locais | 180.982 B |

SheetJS e Leaflet ja sao carregados sob demanda. O maior contribuinte proprio
no main e o componente principal (~62 kB minificados, incluindo template).
Budgets existentes: inicial aviso 500 kB / erro 1 MB; estilo de componente
aviso 4 kB / erro 8 kB. O estilo principal e global, portanto o budget de
componente nao limita todo o CSS. Permanece o aviso CommonJS do Leaflet.

## Diagnostico priorizado

| Prioridade | Gargalo comprovado | Intervencao aprovada | Criterio verificavel |
|---|---|---|---|
| 1 | Milhares de linhas DOM; buscas lineares por ID; dependencias de rota invalidam geometria | Paginacao, indice por ID e separar computeds | Ate 100 linhas por tabela; exportacao completa; nenhuma reconstrucao geometrica so por atualizar rota |
| 2 | Limpeza/recriacao integral de marcadores em atualizacoes e zoom | Reutilizar camadas | Sem novos marcadores num zoom sem alteracao dos grupos; preservar selecao e deslocamento visual |
| 3 | Passagens repetidas de Haversine nas metricas | Reutilizar minima e contagens na mesma passagem | Resultados identicos, incluindo limites de 50/100 km |

Nao foram prometidos ganhos de tempo antes de medir. As metas estruturais
nao equivalem a uma meta de FPS.

## Metricas geodesicas: comparacao reproduzivel

```powershell
cd frontend
node scripts\benchmark-dashboard.cjs
```

O harness contem a referencia anterior congelada, usa o TypeScript instalado
e compara o objeto completo de estatisticas e seu SHA-256. Sao 3 aquecimentos
e 7 amostras por implementacao, no mesmo processo, com mediana:

| Tutores x bolsistas | Antes | Depois | Chamadas Haversine antes / depois |
|---:|---:|---:|---:|
| 5 x 20 | 0,073 ms | 0,019 ms | 282 / 100 |
| 50 x 500 | 6,548 ms | 2,400 ms | 73.978 / 25.000 |
| 100 x 1.000 | 25,556 ms | 6,901 ms | 295.758 / 100.000 |
| 500 x 4.500 | 516,745 ms | 151,112 ms | 6.707.354 / 2.250.000 |

Todos os resultados e checksums foram identicos. No maior caso, reducao
observada de **70,8%** na mediana e **66,5%** nas chamadas Haversine.
Nao interpretar o caso de microssegundos como ganho perceptivel ao usuario.
Os pares estao vazios neste ensaio para isolar as metricas geodesicas; nao e o
tempo total de importacao nem o custo de gerar todos os pares de proximidade.

## Camadas: criterio estrutural

Fixture de 1.000 marcadores: render inicial, zoom, resize e selecao mantiveram
**1.000 criacoes totais, zero remocoes e uma atualizacao de icone**. O teste
verifica reutilizacao e deslocamento visual em pixels; nao mede GPU/FPS.
Ha regressao para dados novos com o mesmo ID, filtro/remocao e limpeza de
listeners/popups no destroy. **Ajustar aos pontos** enquadra pontos visiveis;
**Ver Brasil** continua disponivel.

## Navegador depois da implementacao

Repeticao com os mesmos arquivos e viewport 1215 x 912, apos terminar o build:

| Participantes | Importacao antes / depois | Maior frame antes / depois | Linhas DOM antes / depois | Marcadores depois |
|---:|---:|---:|---:|---:|
| 100 | 204 / 95 ms | 96 / 25 ms | 100 / 100 | 100 |
| 1.000 | 850 / 338 ms | 417 / 183 ms | 1.000 / 100 | 1.000 |
| 5.000 | 13.455 / 5.462 ms | 7.033 / 3.054 ms | 5.000 / 100 | 5.000 |

No maior caso, queda observada de **59,4%** no tempo ate DOM. Ainda ha bloqueio
de varios segundos: esta fatia **nao torna cargas densas instantaneas**.
Uma primeira repeticao, simultanea ao build, deu 6.933 ms para 5.000; foi
repetida sem compilacao concorrente para reduzir essa interferencia.

Leitura XLSX depois: 171 / 115 / 188 ms. Nao foi alterado o parser e nao se
declara melhoria de leitura. Heap depois: 168 / 66 / 281 MiB. O valor alto no
caso pequeno mostra interferencia de GC/reuso do processo; nao concluir ganho
de memoria ou ausencia de leaks dessas leituras.

Navegacao com 1.000 participantes e viewport 1280 x 900:

| Metrica | Antes | Depois |
|---|---:|---:|
| 3 zooms, FPS medio observado | 45,9 | 70,0 |
| Maior intervalo de frame no ensaio de zoom | 233 ms | 192 ms |
| Selecao ate dois frames | 504 ms | 61 ms |
| Marcadores inseridos / removidos durante selecao | 2.000 / 2.000 | 0 / 0 |

Sao amostras locais, nao FPS sustentado, percentis ou limite de capacidade.
Nao houve comparacao controlada de pan, GPU, celulares ou redes de terceiros.

Verificacoes manuais adicionais:

- Percorridas as dez paginas de participantes: **1.000 nomes unicos**, sem
  repeticao/perda; a mesma instancia de canvas do mapa foi preservada.
- Busca de um nome na ultima pagina retornou o registro correto; filtros
  nao deixaram uma pagina vazia fora do intervalo.
- **Ajustar aos pontos** e **Ver Brasil** responderam sem recriar o mapa.
- Teclado: Espaco no botao **Proxima** passou aos pares 101-200, manteve o foco
  no botao e outline de 3 px. Resumos tem `role="status"`. Nao foi realizado
  teste com leitor de tela real; o primeiro anuncio ao surgir a paginacao
  depende do leitor, pois o resumo so existe para mais de uma pagina.
- Exportacao CSV com 100 linhas visiveis de pares: **891 registros no Blob**,
  iguais aos 891 pares do total filtrado, nao apenas a pagina. O evento
  `download` do browser integrado nao foi emitido; verificou-se o conteudo do
  Blob sintetico, restaurando a instrumentacao imediatamente. Nao se afirma
  validacao do download em disco nesse ambiente.

### Custo de bundle depois

Inicial **398,70 kB**, contra 390,10 kB: **+8,60 kB** (cerca de 2,2%).
Transferencia estimada inicial 105,16 kB, contra 103,72 kB.
SheetJS e Leaflet continuam com os mesmos chunks lazy. O ganho desta entrega
e de runtime/DOM, nao de tamanho de download. Budgets continuam aprovados.

## Mudancas por arquivo

| Arquivo | Mudanca |
|---|---|
| [app.ts](../frontend/src/app/app.ts) | Indice derivado por ID, geometria independente das rotas, preservacao de referencias e estado/janelas de paginacao |
| [app.html](../frontend/src/app/app.html) | Tres tabelas paginadas, totais completos, controles reais e status acessivel |
| [app.scss](../frontend/src/app/app.scss) | Estilos responsivos da paginacao e estados dos controles |
| [app.spec.ts](../frontend/src/app/app.spec.ts) | 6 regressoes de paginacao, filtros/importacao, exportacao integral e dependencias dos computeds |
| [dashboard-metrics.ts](../frontend/src/app/domain/dashboard-metrics.ts) | Reutilizar menor distancia para media e limites, numa passagem por par |
| [dashboard-metrics.spec.ts](../frontend/src/app/domain/dashboard-metrics.spec.ts) | 2 regressoes com zero, ausencia de coordenadas e limites 50/50,01/100/100,01 km |
| [leaflet-layers.service.ts](../frontend/src/app/map/leaflet-layers.service.ts) | Reconciliar marcadores por chave, atualizar posicoes e limpar recursos; enquadrar pontos visiveis |
| [leaflet-layers.service.spec.ts](../frontend/src/app/map/leaflet-layers.service.spec.ts) | 6 regressoes de zoom, selecao, mesmo ID com novos dados, 1.000 marcadores, filtros e teardown |
| [leaflet-map.component.ts](../frontend/src/app/map/leaflet-map.component.ts) | Encaminhar acao de enquadramento a sessao |
| [leaflet-map.component.html](../frontend/src/app/map/leaflet-map.component.html) | Botao Ajustar aos pontos |
| [leaflet-map.component.spec.ts](../frontend/src/app/map/leaflet-map.component.spec.ts) | 1 regressao da acao de enquadramento |
| [benchmark-dashboard.cjs](../frontend/scripts/benchmark-dashboard.cjs) | Benchmark diferencial reproduzivel com referencia congelada e checksum |
| [generate-performance-workbooks.cjs](../frontend/scripts/generate-performance-workbooks.cjs) | Gerador de cargas XLSX sinteticas sem dependencias novas |
| [README](../README.md), [arquitetura](architecture-overview.md) e este relatorio | Uso, limites, medicoes e backlog |

## Validacao integrada

Executados no diretorio `frontend`, depois dos tres blocos:

```powershell
npx.cmd ng test --watch=false
npx.cmd ng build --stats-json
node scripts\benchmark-dashboard.cjs
```

- **330/330 testes em 22 arquivos aprovados**, 15 regressoes novas.
- **Build de producao aprovado, exit code 0**; permanece o aviso Leaflet CommonJS.
- Benchmark diferencial: quatro tamanhos com resultados/checksums equivalentes.
- Gerador XLSX executado e arquivos relidos: 100/1.000/5.000 registros e 10%
  tutores confirmados; argumento de diretorio ausente falha explicitamente.
- Os agentes executaram testes e build apos seus blocos. Erros transitorios
  durante edicoes concorrentes foram resolvidos antes da suite integrada.
- Sem script de lint existente; nenhum linter ou pacote foi adicionado.
- Roteamento externo e download em disco nao foram revalidados manualmente;
  os testes existentes de OSRM e exportacao integram a suite aprovada.

## Fora desta fatia

- **Indice espacial:** `buildProximityPairs` continua dependendo de tutores x
  bolsistas e da quantidade de pares retornados. Em carga densa, o proprio
  resultado pode ser quadratico; um indice nao elimina o custo de materializa-lo.
- **Worker:** avaliar apos reduzir trabalho redundante; parsing e calculos longos
  ainda podem bloquear a thread principal. Incluir custo de transferencia,
  cancelamento e descarte de resultado obsoleto no benchmark.
- **Clustering espacial por zoom:** o agrupamento municipal existente nao e
  clusterizacao espacial generica. Marcadores `divIcon` continuam no DOM;
  `preferCanvas` so beneficia as geometrias, nao esses icones.
- **Rede:** tiles opcionais preservam base local, mas falta mensagem especifica
  de falha de tiles; endpoint OSRM fixo, timeout de 15 s, cache em memoria sem
  limite/expiracao e sem retry automatico. Configuracao de provedores deve manter
  autorizacao explicita e atribuicao. Nao substituir falha rodoviaria por Haversine.
- **Persistencia:** nao foi adicionado IndexedDB (banco local) nem armazenamento
  automatico. Preferir estudar arquivo de sessao versionado, validado e opcional,
  com IDs opacos, sem CPF cru e consentimentos externos restaurados desligados.
  Exportacoes CSV/XLSX existentes sao relatorios, nao backup de sessao.
- **Arquitetura:** OnPush e Signals ja existem. Nao se extraiu uma store global
  nem se adotou roteamento novo apenas para reorganizar arquivos.
- **Java/Quarkus:** considerar quando houver necessidade de sessao duravel,
  colaboracao multiusuario, autenticacao, auditoria, jobs cancelaveis, matrizes
  rodoviarias extensas ou volumes que ultrapassem memoria/latencia aceitavel nos
  dispositivos-alvo. Definir SLOs e governanca/LGPD antes da migracao; nao inferir
  um limite universal de linhas deste benchmark local.

KM informado, distancia geodesica e distancia rodoviaria permanecem metricas
independentes. Pares exploratorios nao representam alocacao institucional.
