# Fontes locais do redesign

WOFF2 obtidos em 2026-11-05 da distribuição oficial Google Fonts
(`fonts.googleapis.com` / `fonts.gstatic.com`), sem conversão ou alteração.
Nenhum serviço de fontes é consultado em runtime; não é necessário instalar pacotes.
As URLs abaixo documentam a origem, não são imports da aplicação.

| Família | Distribuição | Estilo e pesos locais | Uso |
| --- | --- | --- | --- |
| Barlow Semi Condensed | Google Fonts v16 | Normal, 400/500/600/700 | Alternativa local, não usada no tema atual |
| Source Sans 3 | Google Fonts v20 | Normal, variável 200–900 | Títulos e interface |
| IBM Plex Mono | Google Fonts v20 | Normal, 400/500/600 | Números |

Todos os arquivos são do subconjunto **latin**, incluindo caracteres portugueses
precompostos (á, à, â, ã, é, ê, í, ó, ô, õ, ú, ü, ç e maiúsculas).
Não há itálicos, outros alfabetos ou todos os diacríticos combinantes.
Glifos ausentes usam o fallback do sistema; pesos não fornecidos podem ser
sintetizados pelo navegador (ou substituídos, se `font-synthesis: none`).

## Licença e atribuições

As três famílias permitem redistribuição sob **SIL Open Font License 1.1**.
`OFL.txt` reúne os avisos de copyright de cada família e o texto integral da
licença comum. Preservar esse arquivo ao redistribuir as fontes.

Avisos originais:

- Barlow: <https://raw.githubusercontent.com/google/fonts/main/ofl/barlowsemicondensed/OFL.txt>
- Source Sans 3: <https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt>
- IBM Plex Mono: <https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt>

Distribuições Fontsource autorizadas conferidas (mesmo texto integral SIL OFL
1.1, ignorando apenas espaços/quebras de linha). As cópias por família estão
incluídas neste diretório; não foi instalada nenhuma dependência:

- `barlow-semi-condensed-OFL.txt`: <https://unpkg.com/@fontsource/barlow-semi-condensed@5.3.0/LICENSE>
- `source-sans-3-OFL.txt`: <https://unpkg.com/@fontsource/source-sans-3@5.3.1/LICENSE>
- `ibm-plex-mono-OFL.txt`: <https://unpkg.com/@fontsource/ibm-plex-mono@5.3.0/LICENSE>

Preservamos também `OFL.txt` com os copyrights upstream, inclusive os nomes
reservados Source/Plex: os cabeçalhos Fontsource não substituem esses avisos.
Os binários continuam sendo os originais Google Fonts documentados abaixo.

## Origem dos binários

Consulta CSS usada para selecionar apenas os blocos `/* latin */`, com
User-Agent Chrome 120 (WOFF2):

<https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Sans+3:wght@200..900&display=swap>

| Arquivo | URL de origem |
| --- | --- |
| `barlow-semi-condensed-latin-400-normal.woff2` | <https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpvgxjLBV1hqnzfr-F8sEYMB0Yybp0mudRXeIqq.woff2> |
| `barlow-semi-condensed-latin-500-normal.woff2` | <https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfi6m_B2sl.woff2> |
| `barlow-semi-condensed-latin-600-normal.woff2` | <https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfp66_B2sl.woff2> |
| `barlow-semi-condensed-latin-700-normal.woff2` | <https://fonts.gstatic.com/s/barlowsemicondensed/v16/wlpigxjLBV1hqnzfr-F8sEYMB0Yybp0mudRfw6-_B2sl.woff2> |
| `source-sans-3-latin-wght-normal.woff2` | <https://fonts.gstatic.com/s/sourcesans3/v20/nwpStKy2OAdR1K-IwhWudF-R3w8aZQ.woff2> |
| `ibm-plex-mono-latin-400-normal.woff2` | <https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2> |
| `ibm-plex-mono-latin-500-normal.woff2` | <https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2> |
| `ibm-plex-mono-latin-600-normal.woff2` | <https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2> |

SHA-256 dos arquivos originais:

```text
d03a7a5f6b74534c80699289d4f6495fdb09a7596774a4ede79129d2f8bb67b1  barlow-semi-condensed-latin-400-normal.woff2
0d7513795eaf8fdab7f340144841bd2d9fac7d9303c03aa6b525a2c908e9b371  barlow-semi-condensed-latin-500-normal.woff2
f158417e9207b5362f9b71a2fe779ce5bb836ad972f38445c3163af39d2c998d  barlow-semi-condensed-latin-600-normal.woff2
fb958c8c20a05552ac8a85d925d96028d52565792650e941a5fe96b6997aa5cb  barlow-semi-condensed-latin-700-normal.woff2
19143dca075972bc84e3fd9eab7416dd40cc565dccb2435a044bdfabe060c7d5  source-sans-3-latin-wght-normal.woff2
08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7  ibm-plex-mono-latin-400-normal.woff2
01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22  ibm-plex-mono-latin-500-normal.woff2
0d1f0b8d0722224e32e9f28261bdc86c79115be73444ae5eceb73976a1bcdf83  ibm-plex-mono-latin-600-normal.woff2
```

Tamanho total dos oito WOFF2: **165.044 bytes**. O navegador baixa somente as
faces utilizadas, com `font-display: swap`.

## Assets e consumo

O módulo `src/design-tokens.scss` só declara fontes e variáveis `:root`.
Os estilos da interface consomem `var(--font-body)`, `var(--font-heading)`,
`var(--font-mono)` e os demais tokens.

As URLs `../public/fonts/...` são resolvidas a partir do SCSS em `src`.
O builder Angular emite cópias com hash em `media/` e reescreve as URLs do CSS
para caminhos relativos, compatíveis com publicação sob `base-href`.
O Angular também copia `public/**` para o build; portanto, os WOFF2 originais
continuam em `fonts/` além das cópias processadas. Nenhum CDN é necessário
em produção.

`--color-muted` tem contraste AA para texto normal sobre papel e superfície.
`--color-control-border: #7B8270` deve ser usado para limites de campos e
controles: contraste **3,18:1** sobre papel `#ECE5D5` e **3,41:1** sobre
superfície `#F3EDDF` (WCAG, luminância relativa sRGB, valores arredondados),
atendendo a 3:1 para informação visual não textual nesses fundos.
`--color-border`, `--color-grid` e `--color-stripe` são decorativos, não
substituem essa borda em controles. Sobre outros fundos, revalidar contraste.
Status precisam de rótulos/ícones além de cor; foco exige geometria visível
e contraste com a superfície adjacente. As combinações finais devem ser
validadas na integração, especialmente texto/foco sobre fundos coloridos.
