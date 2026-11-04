/**
 * Run from anywhere: node frontend/tools/geo/generate.mjs [--download]
 * No npm packages. Only public geometries are downloaded, never workbook data.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { areaCentroid, ibgeIndex, simplifyGeometry, validateGeometry } from './geometry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cache = resolve(here, '.cache');
const output = resolve(here, '../../public/geo');
const base = 'https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR';
const sources = [
  { file: 'municipios-2022.geojson', url: `${base}?formato=application/vnd.geo+json&qualidade=maxima&intrarregiao=municipio&periodo=2022`,
    expectedSha256: '79b9d6485dc782ac91b2663c9a69bc0f32a726000c4708f9e0f127f21a8bbd67' },
  { file: 'ufs-2022.geojson', url: `${base}?formato=application/vnd.geo+json&qualidade=maxima&intrarregiao=UF&periodo=2022`,
    expectedSha256: '4435b2e0e62de6d68f5c5387e01efc31655242948ae9434b78a3b5b05582e497' },
];
const termsUrl = 'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });

async function download(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    } catch (error) { last = error; }
    if (response) {
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${url}`);
        if (response.status !== 429 && response.status < 500) throw error;
        last = error;
      } else {
        try { return Buffer.from(await response.arrayBuffer()); } catch (error) { last = error; }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw last;
}

if (process.argv.includes('--download')) {
  const terms = await download(termsUrl);
  const text = terms.toString('utf8');
  if (!text.includes('públicos') && !text.includes('p&uacute;blicos')) {
    throw new Error('Official public-data statement not found. Review terms before proceeding.');
  }
  await writeFile(resolve(cache, 'terms.html'), terms);
  const provenance = [];
  for (const source of sources) {
    const bytes = await download(source.url);
    if (sha256(bytes) !== source.expectedSha256) {
      throw new Error(`Official source changed: ${source.file}. Review edition and checksum before accepting.`);
    }
    const geo = JSON.parse(bytes.toString('utf8'));
    if (geo.type !== 'FeatureCollection' || !geo.features?.length) throw new Error('Invalid source.');
    geo.features.forEach(f => validateGeometry(f.geometry));
    await writeFile(resolve(cache, source.file), bytes);
    provenance.push({ ...source, bytes: bytes.length, sha256: sha256(bytes), retrievedAt: new Date().toISOString() });
    console.log(`Downloaded ${source.file}: ${geo.features.length} features, ${bytes.length} bytes.`);
  }
  await writeFile(resolve(cache, 'sources.json'), JSON.stringify({
    sources: provenance,
    terms: {
      url: termsUrl, sha256: sha256(terms),
      statement: 'Todos os arquivos aqui disponíveis são públicos.',
      license: 'IBGE public data; no SPDX/Creative Commons designation asserted.',
      attribution: 'Fonte: IBGE, API de Malhas Geográficas, referência 2022, qualidade máxima. Derivados calculados pelo Mapa Estratégico.',
    },
  }, null, 2) + '\n');
}

const provenance = JSON.parse(await readFile(resolve(cache, 'sources.json'), 'utf8'));
const data = [];
for (const source of provenance.sources) {
  const bytes = await readFile(resolve(cache, source.file));
  const pinned = sources.find(item => item.file === source.file);
  if (!pinned || sha256(bytes) !== pinned.expectedSha256 || sha256(bytes) !== source.sha256) {
    throw new Error(`Source checksum mismatch: ${source.file}`);
  }
  data.push(JSON.parse(bytes.toString('utf8')));
}
const [municipal, states] = data;
const index = ibgeIndex(municipal.features);
if (index.size !== 5570 || states.features.length !== 27) {
  throw new Error(`Unexpected 2022 coverage: ${index.size} municipalities, ${states.features.length} UFs. Review before changing expected counts.`);
}
const centroids = {};
let convergenceMeters = 0;
for (const [prefix, { feature }] of [...index.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const result = areaCentroid(feature.geometry);
  const [lon, lat] = result.coordinate;
  centroids[prefix] = [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
  convergenceMeters = Math.max(convergenceMeters, result.convergenceMeters);
}
let errorBoundMeters = 0;
const ufs = {
  type: 'FeatureCollection',
  features: states.features.map(feature => {
    const result = simplifyGeometry(feature.geometry, 1000);
    errorBoundMeters = Math.max(errorBoundMeters, result.errorBoundMeters);
    return {
      type: 'Feature',
      properties: { ...feature.properties, fonte: 'IBGE', referencia: 2022 },
      geometry: result.geometry,
    };
  }),
};
const outputs = {};
for (const [name, object] of [['municipal-centroids.json', centroids], ['br-ufs.geojson', ufs]]) {
  const bytes = Buffer.from(JSON.stringify(object) + '\n');
  await writeFile(resolve(output, name), bytes);
  outputs[name] = { sha256: sha256(bytes), bytes: bytes.length };
}
await writeFile(resolve(output, 'provenance.json'), JSON.stringify({
  schemaVersion: 1, referenceYear: 2022, provider: 'IBGE', ...provenance,
  crs: 'Input/output WGS84 longitude/latitude; source API coordinates derived from SIRGAS 2000, no precision beyond source asserted.',
  centroid: {
    method: 'Per-municipality spherical Lambert azimuthal equal-area, authalic radius 6371007.1809 m, projection origin bounding-box centre; signed shoelace areas by ring role; islands weighted by area, holes subtracted; inverse projection.',
    input: 'Entire downloaded maximum-quality geometry BEFORE local simplification. IBGE API itself provides simplified meshes, not the original shapefile.',
    numericalConvergenceLimitMeters: 0.5, maximumObservedConvergenceMeters: convergenceMeters,
    decimalPlaces: 6, count: index.size,
    accuracy: 'Numerical convergence only; source positional accuracy and projection-dependent centroid definition are not a survey-accuracy guarantee.',
  },
  outline: {
    method: 'Douglas-Peucker in fixed equirectangular metric projection, spherical length scale bound 1/cos(15 deg); all source vertices checked after rounding. Polygon/MultiPolygon, holes and islands retained.',
    errorLimitMeters: 1000, maximumValidatedBoundMeters: errorBoundMeters,
    topology: 'All 27 UFs checked for ring self-intersections after simplification and rounding; each invalid candidate retries at half tolerance (up to 12 attempts), then preserves the original valid ring without rounding. Invalid source rings cannot be used as fallback: absence of a simple candidate fails generation. The downloaded Amazonas source has pre-existing crossings; its emitted simplified ring passes the same check. Rings simplified independently; not a shared-edge topological dataset; unsuitable for administrative/legal boundary decisions.',
    count: ufs.features.length,
    brazil: 'Union visually represented by the collection of 27 real UF polygons, including islands. No fabricated bounding polygon.',
  },
  outputs,
}, null, 2) + '\n');
console.log(`Generated ${index.size} centroids, 27 UFs. Centroid convergence <= ${convergenceMeters.toFixed(3)} m; outline bound <= ${errorBoundMeters.toFixed(3)} m.`);
