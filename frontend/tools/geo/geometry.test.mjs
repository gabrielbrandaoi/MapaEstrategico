import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaCentroid, distance, ibgeIndex, simplifyGeometry, validateGeometry,
  ringSelfIntersects, validateSimpleRings } from './geometry.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const polygon = coordinates => ({ type: 'Polygon', coordinates });
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const feature = (code, geometry) => ({ type: 'Feature', properties: { codarea: code }, geometry });

test('area centroid is not the vertex mean, includes holes and weighted islands', () => {
  const ring = box(-50, -10, 2, 2);
  const detailed = [ring[0], [-49.9, -10], [-49.8, -10], [-49.7, -10], ...ring.slice(1)];
  const a = areaCentroid(polygon([ring]));
  const b = areaCentroid(polygon([detailed]));
  assert.ok(distance(a.coordinate, b.coordinate) < 0.1);
  assert.ok(a.convergenceMeters <= 0.5);
  const hole = areaCentroid(polygon([ring, box(-49, -10, 0.8, 0.8)]));
  assert.ok(hole.coordinate[0] < a.coordinate[0]);
  assert.ok(hole.coordinate[1] > a.coordinate[1]);
  const islands = areaCentroid({ type: 'MultiPolygon', coordinates: [[ring], [box(-45, -10, 0.1, 0.1)]] });
  assert.ok(islands.coordinate[0] > a.coordinate[0]);
  assert.ok(islands.coordinate[0] < -48.9);
  const reversed = areaCentroid(polygon([ring.toReversed()]));
  assert.ok(distance(a.coordinate, reversed.coordinate) < 0.001);
});

test('validates ranges and rejects empty, unsupported and unclosed geometries', () => {
  assert.throws(() => areaCentroid({ type: 'Point', coordinates: [0, 0] }), /Polygon/);
  assert.throws(() => validateGeometry(polygon([box(181, 0, 1, 1)])), /longitude/);
  assert.throws(() => validateGeometry(polygon([box(0, 91, 1, 1)])), /longitude/);
  assert.throws(() => validateGeometry(polygon([[[0, 0], [1, 0], [1, 1], [0, 2]]])), /Unclosed/);
  assert.throws(() => validateGeometry(polygon([])), /Empty/);
});

test('IBGE indexes only seven digits and fails different codes sharing six-digit prefix', () => {
  const shape = polygon([box(-50, -10, 1, 1)]);
  assert.deepEqual([...ibgeIndex([feature('1234567', shape)]).keys()], ['123456']);
  assert.throws(() => ibgeIndex([feature('123456', shape)]), /seven-digit/);
  assert.throws(() => ibgeIndex([feature('1234567', shape), feature('1234568', shape)]), /collision/);
  assert.throws(() => ibgeIndex([feature('1234567', shape), feature('1234567', shape)]), /Duplicate/);
});

test('simplification preserves polygons, islands, holes, closure and certified error', () => {
  const ring = box(-50, -10, 2, 2);
  ring.splice(1, 0, [-49.5, -10.0001], [-49, -10.0002]);
  const source = { type: 'MultiPolygon', coordinates: [[ring, box(-49.5, -9.5, 0.1, 0.1)], [box(-45, -10, 0.1, 0.1)]] };
  const result = simplifyGeometry(source, 1000);
  validateGeometry(result.geometry);
  assert.equal(result.geometry.type, 'MultiPolygon');
  assert.equal(result.geometry.coordinates.length, 2);
  assert.equal(result.geometry.coordinates[0].length, 2);
  assert.ok(result.geometry.coordinates[0][0].length < ring.length);
  assert.ok(result.errorBoundMeters <= 1000);
});

test('ring topology detects crossings, nonadjacent touches and adjacent backtracking', () => {
  assert.equal(ringSelfIntersects(box(-50, -10, 2, 2)), false);
  assert.equal(ringSelfIntersects([[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]), true);
  assert.equal(ringSelfIntersects([[0, 0], [2, 0], [1, 0], [1, 1], [0, 0]]), true);
  assert.equal(ringSelfIntersects([[0, 0], [2, 0], [2, 2], [1, 0], [0, 2], [0, 0]]), true);
});

test('real Pará regression: cached source and regenerated output have no self-intersections', async () => {
  const raw = JSON.parse(await readFile(new URL('.cache/ufs-2022.geojson', import.meta.url), 'utf8'));
  const para = raw.features.find(f => String(f.properties.codarea) === '15');
  assert.ok(para, 'Real official Pará source must exist in the generation cache.');
  validateSimpleRings(para.geometry);
  const output = simplifyGeometry(para.geometry);
  validateSimpleRings(output.geometry);
  assert.ok(output.errorBoundMeters <= 1000);
  const committed = JSON.parse(await readFile(new URL('../../public/geo/br-ufs.geojson', import.meta.url), 'utf8'));
  assert.deepEqual(committed.features.find(f => String(f.properties.codarea) === '15').geometry, output.geometry);
});

test('committed assets match checksums, finite Brazilian coordinates and full UF coverage', async () => {
  const base = new URL('../../public/geo/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('provenance.json', base), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.outputs)) {
    const bytes = await readFile(new URL(file, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
    assert.equal(bytes.length, expected.bytes);
  }
  const centroids = JSON.parse(await readFile(new URL('municipal-centroids.json', base), 'utf8'));
  assert.equal(Object.keys(centroids).length, 5570);
  for (const [code, [lat, lon]] of Object.entries(centroids)) {
    assert.match(code, /^\d{6}$/);
    assert.ok(Number.isFinite(lat) && lat >= -34 && lat <= 6);
    assert.ok(Number.isFinite(lon) && lon >= -74 && lon <= -28);
  }
  const ufs = JSON.parse(await readFile(new URL('br-ufs.geojson', base), 'utf8'));
  assert.equal(ufs.features.length, 27);
  assert.equal(new Set(ufs.features.map(f => f.properties.codarea)).size, 27);
  ufs.features.forEach(f => {
    assert.doesNotThrow(() => validateSimpleRings(f.geometry), `UF ${f.properties.codarea}`);
  });
  assert.ok(manifest.outline.maximumValidatedBoundMeters <= 1000);
  assert.ok(manifest.centroid.maximumObservedConvergenceMeters <= 0.5);
});
