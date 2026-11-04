# Mapa Estratégico

Aplicação frontend para analisar a distribuição geográfica de médicos tutores e bolsistas. O sistema apoia o planejamento; não cria atribuições institucionais nem presume capacidades, agendas ou restrições.

## Executar

Requisitos: Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` e npm.

```powershell
cd frontend
npm ci
npm start
```

Abra `http://localhost:4200`. Para compilar e testar:

```powershell
npm run build
npm run test -- --watch=false
```

## Fluxo disponível

1. Importe um arquivo XLSX, XLS ou CSV de até 10 MB. Cadastros simples de tutores e bolsistas são acumulativos. Um novo workbook de vínculos substitui o cenário anterior, inclusive seleção, camadas e rotas.
2. Planilhas com `CPF_TUTOR`, `NOME_TUTOR`, `CPF_bolsista` e `NOME_bolsista` são reconhecidas automaticamente, incluindo variações de espaços, acentos, prefixos e ordem das colunas. Clique em **Importar tutores, bolsistas e vínculos**: o arquivo inteiro é processado, classificando suas abas pelos cabeçalhos, não pelo nome.
3. Para cadastros simples, escolha aba e linha de cabeçalho. Se não houver coluna de papel, indique se o arquivo contém tutores ou bolsistas. Mapeie nome, localização, UF, endereço, CEP e coordenadas.
4. Revise linhas inválidas, coordenadas fora de faixa, registros duplicados e participantes sem coordenadas.
5. Explore participantes, pesquisa, filtros, raios geodésicos de 50/100 km e pares de proximidade.
6. Se houver autorização institucional, confirme o envio das coordenadas e calcule uma rota individual pelo OSRM público.
7. Em **Relações e rotas**, vínculos importados têm tabela, pesquisa, ordenação por KM e exportações CSV/Excel próprias, mesmo sem coordenadas. O KM de origem é **informado pela planilha**, separado das rotas verificadas pelo sistema; não integra os KPIs de roteamento.

Tipos aceitos para participantes: `Tutor`/`Tutora`/`Médico tutor` e `Bolsista`. O sistema normaliza acentos, espaços e pontuação, sugere o mapeamento com base em sinônimos comuns e permite revisar/remapear cada coluna antes de importar. Como os cabeçalhos variam entre arquivos, revise as sugestões; cabeçalhos desconhecidos podem ser mapeados manualmente. São necessários tipo (por coluna ou escolha explícita do tipo do arquivo), nome e ao menos cidade/endereço ou o par latitude/longitude. Município/UF são referências textuais, não coordenadas; sem latitude/longitude os participantes são mantidos na análise, mas não aparecem no mapa. Colunas como tipologia territorial ou distâncias a instituições não são interpretadas como tipo de participante ou rota.

## Semântica e privacidade

- Haversine, círculos e pré-seleção de pares são **geodésicos (linha reta)**. Os pares a até 100 km são apenas uma triagem espacial.
- Uma distância ou duração **rodoviária** só aparece após resposta válida do roteador. Falha, ausência ou indisponibilidade não viram zero nem usam Haversine como substituto.
- OSRM é chamado apenas para o par selecionado, depois de confirmação explícita; somente coordenadas são transmitidas. O serviço público não tem SLA e a autorização exibida não constitui validação jurídica/LGPD.
- A base principal é um GeoJSON local do Brasil e estados. OpenStreetMap é opcional: ao ativá-lo, solicitações de mosaicos e a área visualizada são enviadas ao provedor; os dados dos marcadores não são incluídos nos pedidos de mosaico. Falhas dos tiles mantêm o contorno local.
- Planilhas, participantes e rotas permanecem apenas em memória durante a sessão. Não há armazenamento local, backend, geocodificação ou telemetria. Atualizar a página descarta os dados.
- CSV neutraliza células de texto iniciadas por caracteres associados a fórmulas. Exportações contêm nomes e cidades porque são relatórios solicitados; trate os arquivos como dados pessoais e compartilhe-os somente conforme as regras institucionais.
- CPFs e IBGEs são lidos como valores crus e normalizados para strings de 11 e 6 dígitos, respectivamente, incluindo zeros iniciais. Não há validação cadastral ou de dígitos verificadores. CPFs ficam restritos ao processamento local, não nos modelos de apresentação, logs ou exportações. O adaptador cria IDs opacos para a interface.
- CPF mascarado gera ID estável `PROV-<ibge>-<meio6>-<hash do nome normalizado>` e flag `cpfProvisorio`. O hash não anonimiza a identidade. A base auxiliar permite conciliar com CPF completo somente mediante candidato único e consistente por IBGE e os seis dígitos centrais, calculados após padding. Colisões ou divergências geram pontos de atenção, não fusão silenciosa.

## Importação do workbook de tutores e bolsistas

O pipeline separado da interface é: SheetJS (`raw: true`, `defval: null`, linhas físicas preservadas) → normalização de cabeçalhos → detecção de esquemas → mapeamento e conciliação → `{ dados, relatorio }`. `ImportadorPlanilhaService` é a única fachada de importação usada pelo componente. Domínio, Mapa e `RoutingProvider` mantêm seus contratos.

| Estrutura detectada                         | Tratamento                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nominal, com nomes/CPFs de tutor e bolsista | Tutores únicos e vínculos. Tutor sem campos de bolsista é preservado com lista vazia e alerta.  |
| Resumo por tutor/IBGE                       | `NOME_bolsista` é quantidade, não nome. Confronta a contagem com a nominal.                     |
| Base de bolsistas com `cpf_ajustado`        | Auxilia a identificação de máscaras; divergências do valor recalculado são relatadas.           |
| Alertas com `MOTIVO`                        | Reconhece ausência de município vizinho e extrai a quantidade de “Apenas N bolsistas alocados”. |
| Alertas com `n_bolsistas`                   | Preserva alertas da segunda rodada e confere contagens.                                         |

Índices sem cabeçalho são ignorados. A nominal é obrigatória no modo multiabas; abas opcionais ausentes e abas desconhecidas são informadas. CSV/cadastro simples continua com mapeamento manual.

O relatório mostra abas/tipos, linhas lidas/aceitas/rejeitadas, totais, CPFs provisórios, CNES ausentes, avisos/erros com aba/linha/coluna e divergências. Regras não reconhecidas viram `RegraDesconhecida` com aviso. Distâncias negativas/inválidas não viram zero; CNES vazio é aceito.

### Validação manual da planilha real

1. Abra a aplicação e deixe desativadas as opções de mapa externo e roteamento.
2. Selecione o XLSX/XLS multiabas. Não deve ser necessário classificar os papéis ou escolher cada aba.
3. Importe e confira no relatório os cinco tipos detectados, as linhas físicas de origem e o confronto das contagens.
4. Confira os tutores sem bolsistas na lista de alertas e no mapa, quando seu município constar da base local. Eles contam como tutores, mas não criam bolsistas ou distâncias.
5. Confira `KM = 0`, KM ausente e identidades provisórias na tabela de vínculos; exporte CSV/Excel e verifique a sinalização, sem CPF completo.
6. Revise todos os pontos de atenção, especialmente `cpf_ajustado`, regras desconhecidas e divergências. Não trate o total provisório como identidade cadastral confirmada.
7. Limpe os dados ao terminar. Os dados ficam somente na memória da página e não são persistidos.

Baseline da importação: 190 testes Vitest aprovados e build de produção aprovado antes da evolução do mapa municipal. Os 45 cenários anteriores foram preservados; os testes cobrem normalização, classificação, conciliação, relatório e integração XLS/XLSX. Não há script de lint configurado.

### Mapa municipal e distâncias

- **Ver Brasil** enquadra o território completo; selecionar um tutor enquadra seus bolsistas localizados. Desselecionar restaura o enquadramento nacional.
- Os pontos municipais representam centroides, não endereços. A lista de municípios sem localização permite revisar o que ficou fora do mapa.
- Bolsistas no mesmo município são agrupados; o afastamento visual dos símbolos não altera as coordenadas de cálculo.
- Conexões aparecem somente para o tutor selecionado e não representam estradas. Cada distância conserva seu rótulo: planilha, geodésica entre centroides ou rota do provedor.
- A comparação sinaliza `abs(kmPlanilha - geodesicaKm) > max(15 km, 20% da geodesicaKm)`. Isso é um ponto de atenção, não prova de erro na distância de origem.
- A regra de 50 km sinaliza excedentes na planilha ou geodésica; a segunda rodada permanece uma exceção esperada. Vínculos distantes não são excluídos pela triagem de candidatos de 100 km.
- Círculos de 50/100 km têm raio em metros no solo. Não equivalem a alcance rodoviário.

Checklist visual: abrir sem dados e sem internet externa; importar e conferir Brasil inteiro; selecionar tutor de segunda rodada com vínculo distante; selecionar tutor com bolsistas no mesmo município e conferir zero km; testar camadas, desseleção, troca de abas e **Ver Brasil**; substituir o workbook e confirmar ausência de camadas antigas.

Base local: **5.570 centroides municipais e 27 UFs**, referência IBGE 2022, sem API geográfica em tempo de execução. Os dois assets principais somam aproximadamente 489 kB. O método de cálculo, a simplificação, os checksums e as ressalvas de uso/licença estão em [Dados geográficos](docs/geographic-data.md). A declaração pública oficial foi verificada; não se presume licença CC/SPDX. Centroides derivam da malha disponibilizada pela API, que já possui simplificação de origem.

Validação do mapa municipal: **309 testes Angular/Vitest e 7 testes Node aprovados**, além do build de produção. Os 190 cenários anteriores seguem passando; duas expectativas de interface foram atualizadas para distinguir zero entre centroides de coordenadas importadas coincidentes. Sem script de lint; permanece o aviso CommonJS do Leaflet.

## Arquitetura

Angular standalone + TypeScript estrito; domínio puro para coordenadas, faixas e pares; SheetJS para leitura/escrita local; Leaflet para camadas geográficas; interface `RoutingProvider` com implementação OSRM substituível. Nenhum componente executa parsing de Excel ou lógica de distância. O app e o roteador são fronteiras adequadas para posterior migração de processamento para Java/Quarkus.

Consulte [docs/architecture-overview.md](./docs/architecture-overview.md), [docs/product-brief.md](./docs/product-brief.md) e as decisões em [docs/decisions/](./docs/decisions/).

## Limitações e decisões pendentes

- Não há geocodificação; endereço/cidade são validados apenas quanto à presença e não são convertidos em coordenadas.
- O cálculo rodoviário é individual, sob demanda, sem matriz, lote, otimização de rota multiparada ou garantia de serviço.
- A comparação ordena pares observados; não aloca bolsistas nem otimiza capacidade. Regras de capacidade, múltiplos tutores, agenda, especialidade, viagem de retorno, território e função objetivo precisam de decisão institucional.
- A aplicação não persiste histórico, cenários ou auditoria e não implementa autenticação.
- A deduplicação e conciliação valem para o workbook importado, não entre cadastros independentes. Outro workbook substitui o cenário; cadastros simples acrescentam lotes. As regras importadas descrevem a fonte, não executam nova alocação.
- Tutor sem bolsista permanece nos totais, alertas e mapa quando localizado. IBGE é resolvido apenas na base municipal local; código desconhecido não gera coordenada artificial nem chamada externa.
- O pacote oficial SheetJS é instalado do CDN do fornecedor, pois o pacote `xlsx` publicado no npm está desatualizado. Consulte `frontend/package.json` e a documentação oficial do fornecedor.

## Agent Kit

Perfis, instruções e skills do Copilot estão em `.github/`. Eles orientam contribuições futuras, mas não são necessários para executar a aplicação.
