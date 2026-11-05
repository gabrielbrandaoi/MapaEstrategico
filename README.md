# Mapa Estratégico

Aplicação Angular para importar planilhas de tutores e bolsistas, visualizar localizações no mapa e comparar distâncias.

## Executar

Requisitos: Node.js `^20.19.0 || ^22.12.0 || >=24.0.0` e npm.

```powershell
cd frontend
npm ci
npm start
```

Abra `http://localhost:4200`.

## Testar e compilar

Na pasta `frontend`:

```powershell
npm test -- --watch=false
npm run build
```

## Uso

1. Importe uma planilha XLSX, XLS ou CSV de até 10 MB.
2. Confira o mapeamento e os avisos da importação.
3. Explore o mapa na **Visão geral**. O seletor **Cenário do mapa** permite escolher
   uma simulação de mínimo 1 (padrão), mínimo 2 ou vínculos importados, sem modificar
   a base. Novas importações preservam o cenário escolhido e sua legenda;
   “Limpar dados” retorna ao mínimo 1.
4. Na aba **Simulações**, separada do mapa, consulte tabela e gráfico da distribuição,
   selecione mínimo 1/2 ou compare ambos com diferenças. Exporte a tabela em CSV/Excel,
   os vínculos com seus motivos e o gráfico em PNG.
   Se o gráfico não carregar, a tabela permanece disponível e o botão
   **Tentar novamente** permite refazer o carregamento sem reimportar os dados.

As simulações usam distância **geodésica**, raio máximo de **150 km**, teto de
4 bolsistas por tutor e dispensa de 15% dos tutores geolocalizados, arredondada
para cima. Não representam rotas rodoviárias nem uma distribuição ótima.
Percentuais da distribuição usam todos os tutores; a categoria zero é um
subtotal de dispensados e abaixo do mínimo, sem dupla contagem no total.
As regras e limitações estão na [arquitetura](docs/architecture-overview.md#simulação-de-alocação).

**Importante:** atualizar a página apaga os dados da sessão. Distâncias da planilha, em linha reta e rodoviárias são diferentes. Tiles e rotas externos só devem ser ativados com autorização.

## Documentação

- [Arquitetura](docs/architecture-overview.md)
- [Dados geográficos](docs/geographic-data.md)
- [Desempenho e limitações](docs/performance-report.md)
