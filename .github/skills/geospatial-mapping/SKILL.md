---
name: geospatial-mapping
description: Implementa Leaflet, marcadores, popups, camadas, círculos, coordenadas, geocodificação e interação geográfica.
---
Use WGS84/EPSG:4326 salvo requisito diferente. Modelo interno latitude/longitude; valide ranges e valores finitos. Registre proveniência da coordenada. Inicialize Leaflet apenas no browser; limpe listeners/layers no destroy. Reutilize grupos de camadas e considere clustering. Círculos de 50/100 km são geodésicos e não alcance rodoviário. Rota real usa geometria do provedor. Não trate geocodificação como verdade absoluta; permita confirmação/correção manual e cache. Respeite atribuição de tiles. Teste coordenadas inválidas, pontos coincidentes, filtros e lifecycle.
