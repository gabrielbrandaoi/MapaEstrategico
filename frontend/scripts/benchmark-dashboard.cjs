#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const TYPESCRIPT_PATH = require.resolve('typescript');
const typescript = require(TYPESCRIPT_PATH);
const originalResolveFilename = Module._resolveFilename;

// Transpile the project's TypeScript sources in memory using its installed compiler.
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return originalResolveFilename.call(this, request, parent, isMain, options);
  } catch (error) {
    if (request.startsWith('.') && parent) {
      const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidate)) return candidate;
    }
    throw error;
  }
};

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const javascript = typescript.transpile(source, {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2020,
    experimentalDecorators: true,
  });
  module._compile(javascript, filename);
};

const distanceModule = require('../src/app/domain/distance.ts');
let haversineCalls = 0;
const originalHaversineKm = distanceModule.haversineKm;
distanceModule.haversineKm = (...args) => {
  haversineCalls += 1;
  return originalHaversineKm(...args);
};

const { calculateDashboardStatistics } = require('../src/app/domain/dashboard-metrics.ts');

const WARMUP_RUNS = 3;
const MEASURED_RUNS = 7;

// Frozen copy of calculateDashboardStatistics before the single-pass optimization.
function calculateDashboardStatisticsBaseline(participants, pairs) {
  const tutors = participants.filter(
    (participant) => participant.type === 'tutor' && participant.location !== null,
  );
  const fellows = participants.filter((participant) => participant.type === 'fellow');
  const locatedFellows = fellows.filter((participant) => participant.location !== null);
  const nearestDistances = locatedFellows.flatMap((fellow) => {
    const fellowLocation = fellow.location;
    if (!fellowLocation) {
      return [];
    }

    const distances = tutors.flatMap((tutor) => {
      const tutorLocation = tutor.location;
      if (!tutorLocation) {
        return [];
      }
      const straightLineKm = distanceModule.haversineKm(tutorLocation, fellowLocation);
      return straightLineKm === null ? [] : [straightLineKm];
    });
    return distances.length > 0 ? [Math.min(...distances)] : [];
  });
  const nearbyCounts = new Map();
  for (const pair of pairs) {
    nearbyCounts.set(pair.fellowId, (nearbyCounts.get(pair.fellowId) ?? 0) + 1);
  }

  const successfulRoutes = pairs.flatMap((pair) => {
    const distanceMeters = confirmedRoadDistanceMeters(pair);
    return distanceMeters === null ? [] : [distanceMeters / 1_000];
  });
  const fellowsWithRoadWithin50 = new Set(
    pairs.flatMap((pair) => {
      const distanceMeters = confirmedRoadDistanceMeters(pair);
      return distanceMeters !== null && distanceMeters <= 50_000 ? [pair.fellowId] : [];
    }),
  );
  const withinGeodesicRadius = (fellow, radiusKm) => {
    const fellowLocation = fellow.location;
    if (!fellowLocation) {
      return false;
    }

    return tutors.some((tutor) => {
      const tutorLocation = tutor.location;
      if (!tutorLocation) {
        return false;
      }
      const straightLineKm = distanceModule.haversineKm(tutorLocation, fellowLocation);
      return straightLineKm !== null && straightLineKm <= radiusKm;
    });
  };

  return {
    tutorCount: participants.filter((participant) => participant.type === 'tutor').length,
    fellowCount: fellows.length,
    locatedCount: participants.filter((participant) => participant.location !== null).length,
    withoutCoordinatesCount: participants.filter((participant) => participant.location === null)
      .length,
    locatedFellowCount: locatedFellows.length,
    geodesicWithin50Count: locatedFellows.filter((fellow) => withinGeodesicRadius(fellow, 50))
      .length,
    geodesicWithin100Count: locatedFellows.filter((fellow) => withinGeodesicRadius(fellow, 100))
      .length,
    averageNearestStraightLineKm: nearestDistances.length > 0 ? average(nearestDistances) : null,
    successfulRouteCount: successfulRoutes.length,
    averageRoadKm: successfulRoutes.length > 0 ? average(successfulRoutes) : null,
    maxRoadKm: successfulRoutes.length > 0 ? Math.max(...successfulRoutes) : null,
    fellowsWithRoadWithin50Count: fellowsWithRoadWithin50.size,
    fellowsWithMultipleNearbyTutorsCount: [...nearbyCounts.values()].filter((count) => count > 1)
      .length,
  };
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function confirmedRoadDistanceMeters(pair) {
  const distanceMeters = pair.route?.distanceMeters;
  return pair.route?.status === 'success' &&
    distanceMeters !== null &&
    distanceMeters !== undefined &&
    Number.isFinite(distanceMeters) &&
    distanceMeters >= 0
    ? distanceMeters
    : null;
}

function participant(id, type, index, salt) {
  const latitude =
    -80 + ((index * (type === 'tutor' ? 37 : 67) + salt * 13) % 16_000) / 100;
  const longitude =
    -180 + ((index * (type === 'tutor' ? 73 : 113) + salt * 29) % 36_000) / 100;
  return {
    id,
    type,
    name: id,
    city: null,
    state: null,
    address: null,
    postalCode: null,
    location: { latitude, longitude, source: 'imported' },
    sourceRow: index + 1,
  };
}

function makeInput(tutorCount, fellowCount) {
  const participants = [];
  for (let index = 0; index < tutorCount; index += 1) {
    participants.push(participant(`t${index}`, 'tutor', index, 0));
  }
  for (let index = 0; index < fellowCount; index += 1) {
    participants.push(participant(`f${index}`, 'fellow', index, 1));
  }
  return participants;
}

function median(values) {
  return [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

function checksum(result) {
  return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

function benchmark(run, participants, pairs) {
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    run(participants, pairs);
  }

  const timesMs = [];
  let result;
  for (let index = 0; index < MEASURED_RUNS; index += 1) {
    const started = process.hrtime.bigint();
    result = run(participants, pairs);
    timesMs.push(Number(process.hrtime.bigint() - started) / 1e6);
  }

  haversineCalls = 0;
  run(participants, pairs);
  const calls = haversineCalls;

  return {
    medianMs: Number(median(timesMs).toFixed(3)),
    runsMs: timesMs.map((time) => Number(time.toFixed(3))),
    haversineCalls: calls,
    checksum: checksum(result),
    result,
  };
}

const expectedChecksums = new Map([
  [5, 'c4946592617e1557b10b8b8eca875219a22ef4db69ff2b953f423fcd62a60d6d'],
  [50, 'cca8573c7e320f52104ace14c37bb47ca06a8d53c1a218b6c6f77656421e05e4'],
  [100, '9bce58cc85a882d94dbb633daee80bc139f7b3849cf40bad42a68b40b9a8d78f'],
  [500, 'f9cd4f6a698fe5de50debf48597b92509502cbaf2c1a99012d9ab89e65224078'],
]);

const results = [];
for (const [tutorCount, fellowCount] of [
  [5, 20],
  [50, 500],
  [100, 1_000],
  [500, 4_500],
]) {
  const participants = makeInput(tutorCount, fellowCount);
  const pairs = [];
  const baseline = benchmark(calculateDashboardStatisticsBaseline, participants, pairs);
  const optimized = benchmark(calculateDashboardStatistics, participants, pairs);
  if (!isDeepStrictEqual(baseline.result, optimized.result)) {
    throw new Error(`Statistics differ for ${tutorCount} tutors × ${fellowCount} fellows.`);
  }
  if (baseline.checksum !== optimized.checksum) {
    throw new Error(`Checksums differ for ${tutorCount} tutors × ${fellowCount} fellows.`);
  }
  const expectedChecksum = expectedChecksums.get(tutorCount);
  if (baseline.checksum !== expectedChecksum) {
    throw new Error(`Frozen baseline checksum changed for ${tutorCount} tutors.`);
  }

  results.push({
    tutors: tutorCount,
    fellows: fellowCount,
    baseline: {
      medianMs: baseline.medianMs,
      runsMs: baseline.runsMs,
      haversineCalls: baseline.haversineCalls,
      checksum: baseline.checksum,
    },
    optimized: {
      medianMs: optimized.medianMs,
      runsMs: optimized.runsMs,
      haversineCalls: optimized.haversineCalls,
      checksum: optimized.checksum,
    },
    equivalent: true,
  });
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      typescript: typescript.version,
      warmupRuns: WARMUP_RUNS,
      measuredRuns: MEASURED_RUNS,
      checksumMethod: 'SHA-256 of JSON.stringify(complete statistics object)',
      results,
    },
    null,
    2,
  ),
);
