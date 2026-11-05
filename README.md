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
3. Explore o mapa, os filtros e as relações entre participantes.

**Importante:** atualizar a página apaga os dados da sessão. Distâncias da planilha, em linha reta e rodoviárias são diferentes. Tiles e rotas externos só devem ser ativados com autorização.

## Documentação

- [Arquitetura](docs/architecture-overview.md)
- [Dados geográficos](docs/geographic-data.md)
- [Desempenho e limitações](docs/performance-report.md)
