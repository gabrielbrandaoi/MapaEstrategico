/** Native geometry operations. Coordinates at the boundary are [longitude, latitude]. */
export const R = 6371007.1809; // WGS84 authalic sphere, metres
const RAD = Math.PI / 180;

export function position(p) {
  if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
    throw new Error('Invalid longitude/latitude.');
  }
  return p;
}

export function polygons(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error('Expected Polygon/MultiPolygon.');
}

export function validateGeometry(geometry) {
  const parts = polygons(geometry);
  if (!parts.length) throw new Error('Empty geometry.');
  for (const poly of parts) {
    if (!poly.length) throw new Error('Empty polygon.');
    for (const ring of poly) {
      if (ring.length < 4) throw new Error('Invalid linear ring.');
      ring.forEach(position);
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) {
        throw new Error('Unclosed linear ring.');
      }
    }
  }
}

export function distance(a, b) {
  const p = a[1] * RAD;
  const q = b[1] * RAD;
  const h = Math.sin((q - p) / 2) ** 2 +
    Math.cos(p) * Math.cos(q) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Per-feature spherical Lambert azimuthal equal-area (not a vertex average). */
function laea(lon0, lat0) {
  const l0 = lon0 * RAD;
  const p0 = lat0 * RAD;
  return {
    forward([lon, lat]) {
      const l = lon * RAD - l0;
      const p = lat * RAD;
      const k = Math.sqrt(2 / (1 + Math.sin(p0) * Math.sin(p) +
        Math.cos(p0) * Math.cos(p) * Math.cos(l)));
      return [R * k * Math.cos(p) * Math.sin(l),
        R * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l))];
    },
    inverse([x, y]) {
      const rho = Math.hypot(x, y);
      if (rho < 1e-10) return [lon0, lat0];
      const c = 2 * Math.asin(Math.min(1, rho / (2 * R)));
      const p = Math.asin(Math.cos(c) * Math.sin(p0) + y * Math.sin(c) * Math.cos(p0) / rho);
      const l = l0 + Math.atan2(x * Math.sin(c),
        rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
      return [l / RAD, p / RAD];
    },
  };
}

function densify(ring, stepDegrees) {
  const points = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / stepDegrees));
    for (let j = 1; j <= n; j++) {
      points.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
    }
  }
  return points;
}

function centroidAt(parts, projection, step) {
  let total = 0, sumX = 0, sumY = 0;
  for (const poly of parts) {
    for (const [index, ring] of poly.entries()) {
      const points = densify(ring, step).map(projection.forward);
      let twiceArea = 0, x = 0, y = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const cross = a[0] * b[1] - b[0] * a[1];
        twiceArea += cross;
        x += (a[0] + b[0]) * cross;
        y += (a[1] + b[1]) * cross;
      }
      if (Math.abs(twiceArea) < 1e-8) throw new Error('Degenerate ring.');
      // Ring role, not winding: holes subtract area, islands retain their area.
      const weight = Math.abs(twiceArea) * (index === 0 ? 1 : -1);
      total += weight;
      sumX += weight * x / (3 * twiceArea);
      sumY += weight * y / (3 * twiceArea);
    }
  }
  if (!(total > 0)) throw new Error('Non-positive polygon area.');
  return projection.inverse([sumX / total, sumY / total]);
}

export function areaCentroid(geometry) {
  validateGeometry(geometry);
  const parts = polygons(geometry);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of parts) for (const ring of poly) for (const [x, y] of ring) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const projection = laea((minX + maxX) / 2, (minY + maxY) / 2);
  let step = 0.01;
  let previous = centroidAt(parts, projection, step);
  for (let iteration = 0; iteration < 7; iteration++) {
    step /= 2;
    const current = centroidAt(parts, projection, step);
    const convergenceMeters = distance(previous, current);
    if (convergenceMeters <= 0.5) {
      position(current);
      return { coordinate: current, convergenceMeters, stepDegrees: step };
    }
    previous = current;
  }
  throw new Error('Centroid did not converge within 0.5 m.');
}

export function ibgeIndex(features) {
  const index = new Map();
  for (const feature of features) {
    const code = String(feature.properties?.codarea ?? feature.properties?.id ?? '');
    if (!/^\d{7}$/.test(code)) throw new Error('Municipality must have a seven-digit code.');
    const prefix = code.slice(0, 6);
    if (index.has(prefix)) {
      throw new Error(index.get(prefix).code !== code ? `IBGE6 collision: ${prefix}.` : `Duplicate municipality: ${code}.`);
    }
    index.set(prefix, { code, feature });
  }
  return index;
}

const xy = ([lon, lat]) => [lon * RAD * R * Math.cos(15 * RAD), lat * RAD * R];

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const side = value => Math.abs(value) <= 1e-14 ? 0 : Math.sign(value);
  const on = (p, q, r) => r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
  const abC = side(cross(a, b, c)), abD = side(cross(a, b, d));
  const cdA = side(cross(c, d, a)), cdB = side(cross(c, d, b));
  return (abC * abD < 0 && cdA * cdB < 0) ||
    (abC === 0 && on(a, b, c)) || (abD === 0 && on(a, b, d)) ||
    (cdA === 0 && on(c, d, a)) || (cdB === 0 && on(c, d, b));
}

/** Includes nonadjacent touches/overlaps and collapsed edges, not just crossings.
 * Longitude sweep rejects disjoint segment bounding boxes before exact tests.
 */
export function ringSelfIntersects(ring) {
  const count = ring.length - 1;
  const segments = [];
  for (let i = 0; i < count; i++) {
    const a = ring[i], b = ring[i + 1];
    if (a[0] === b[0] && a[1] === b[1]) return true;
    segments.push({ i, a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
      minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
  }
  segments.sort((a, b) => a.minX - b.minX);
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    for (let j = i + 1; j < segments.length && segments[j].minX <= a.maxX; j++) {
      const b = segments[j];
      if (a.maxY < b.minY || b.maxY < a.minY) continue;
      const separation = Math.abs(a.i - b.i);
      if (separation === 1 || separation === count - 1) {
        // Adjacent edges may share their endpoint, but may not backtrack/overlap.
        const shared = separation === count - 1 ? ring[0] : ring[Math.max(a.i, b.i)];
        const same = p => p[0] === shared[0] && p[1] === shared[1];
        const otherA = same(a.a) ? a.b : a.a;
        const otherB = same(b.a) ? b.b : b.a;
        const cross = (otherA[0] - shared[0]) * (otherB[1] - shared[1]) -
          (otherA[1] - shared[1]) * (otherB[0] - shared[0]);
        const dot = (otherA[0] - shared[0]) * (otherB[0] - shared[0]) +
          (otherA[1] - shared[1]) * (otherB[1] - shared[1]);
        if (Math.abs(cross) <= 1e-14 && dot > 0) return true;
        continue;
      }
      if (segmentsIntersect(a.a, a.b, b.a, b.b)) return true;
    }
  }
  return false;
}

export function validateSimpleRings(geometry) {
  validateGeometry(geometry);
  for (const [p, poly] of polygons(geometry).entries()) {
    for (const [r, ring] of poly.entries()) {
      if (ringSelfIntersects(ring)) throw new Error(`Self-intersecting ring: polygon ${p}, ring ${r}.`);
    }
  }
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Iterative Douglas-Peucker. Keeps ring roles, all islands, closure and winding. */
function simplifyRing(ring, tolerance) {
  const projected = ring.map(xy);
  // Split a closed ring in two nondegenerate chains.
  let opposite = 1;
  for (let i = 2; i < ring.length - 1; i++) {
    if (distance(ring[0], ring[i]) > distance(ring[0], ring[opposite])) opposite = i;
  }
  const keep = new Set([0, opposite, ring.length - 1]);
  const stack = [[0, opposite], [opposite, ring.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let max = tolerance, chosen = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance(projected[i], projected[start], projected[end]);
      if (d > max) { max = d; chosen = i; }
    }
    if (chosen >= 0) {
      keep.add(chosen);
      stack.push([start, chosen], [chosen, end]);
    }
  }
  let indices = [...keep].sort((a, b) => a - b);
  if (indices.length < 4) indices = ring.map((_, i) => i);
  const points = indices.map(i => ring[i].slice(0, 2).map(n => Number(n.toFixed(6))));
  // Bound in the fixed projection. Original and simplified segments are linear
  // in lon/lat (RFC 7946). Distance-to-segment is convex: testing all original
  // vertices bounds each intervening segment too. The reverse directed bound
  // holds via continuous nearest projection of each original chain.
  let maxProjectedMeters = 0;
  for (let j = 1; j < indices.length; j++) {
    const a = xy(points[j - 1]), b = xy(points[j]);
    for (let i = indices[j - 1]; i <= indices[j]; i++) {
      maxProjectedMeters = Math.max(maxProjectedMeters, segmentDistance(projected[i], a, b));
    }
  }
  return { points, maxProjectedMeters };
}

function simplifySimpleRing(ring, tolerance) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = simplifyRing(ring, tolerance);
    if (!ringSelfIntersects(result.points)) return result;
    tolerance /= 2;
  }
  // Never publish an invalid ring. Original coordinates avoid rounding damage too.
  if (ringSelfIntersects(ring)) {
    throw new Error('No simple candidate and source ring self-intersects; cannot preserve invalid source.');
  }
  return { points: ring.map(p => p.slice(0, 2)), maxProjectedMeters: 0 };
}

export function simplifyGeometry(geometry, maxErrorMeters = 1000) {
  if (!Number.isFinite(maxErrorMeters) || maxErrorMeters <= 0) {
    throw new Error('Simplification error limit must be finite and positive.');
  }
  validateGeometry(geometry);
  // Metric derivative bound on the sphere: ds <= K*ds_projected.
  const parts = polygons(geometry);
  let maxCos = 0;
  for (const poly of parts) for (const ring of poly) for (const p of ring) {
    maxCos = Math.max(maxCos, Math.cos(p[1] * RAD));
  }
  // Use 1/cos(15°), valid globally, also for interior points of all segments.
  const scaleBound = Math.max(1, 1 / Math.cos(15 * RAD), maxCos / Math.cos(15 * RAD));
  let tolerance = maxErrorMeters / scaleBound * 0.95;
  for (let attempt = 0; attempt < 8; attempt++) {
    let maximum = 0;
    const coordinates = parts.map(poly => poly.map(ring => {
      const result = simplifySimpleRing(ring, tolerance);
      maximum = Math.max(maximum, result.maxProjectedMeters * scaleBound);
      return result.points;
    }));
    const output = geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: coordinates[0] }
      : { type: 'MultiPolygon', coordinates };
    validateSimpleRings(output);
    if (maximum <= maxErrorMeters) return { geometry: output, errorBoundMeters: maximum };
    tolerance /= 2;
  }
  throw new Error('Simplification exceeded its certified error bound.');
}
