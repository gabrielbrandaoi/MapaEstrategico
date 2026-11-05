import type { Participant } from './models';

export interface AllocationConfig {
  readonly raioMaxKm: number;
  readonly minimoPorTutor: 1 | 2;
  readonly maximoPorTutor: number;
  readonly percentualDispensa: number;
}

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = Object.freeze({
  raioMaxKm: 150,
  minimoPorTutor: 1,
  maximoPorTutor: 4,
  percentualDispensa: 0.15,
});

export type TutorAllocationStatus = 'active' | 'dismissed' | 'below-minimum';

export interface AllocationLink {
  readonly tutorId: string;
  readonly fellowId: string;
  readonly straightLineKm: number;
}

export interface TutorAllocation {
  readonly tutorId: string;
  readonly status: TutorAllocationStatus;
  readonly reason: string;
  readonly fellowCount: number;
  readonly nearestFellowKm: number | null;
}

export interface UnassignedFellow {
  readonly fellowId: string;
  readonly reason: string;
}

export interface AllocationIndicators {
  readonly allocatedFellows: number;
  readonly unassignedFellows: number;
  readonly activeTutors: number;
  readonly dismissedTutors: number;
  readonly belowMinimumTutors: number;
  readonly averageStraightLineKm: number | null;
  readonly maximumStraightLineKm: number | null;
  readonly tutorsByLoad: Readonly<Record<1 | 2 | 3 | 4, number>>;
}

export interface AllocationResult {
  readonly config: AllocationConfig;
  readonly links: readonly AllocationLink[];
  readonly unassignedFellows: readonly UnassignedFellow[];
  readonly tutors: readonly TutorAllocation[];
  readonly dismissedTutorIds: readonly string[];
  readonly belowMinimumTutorIds: readonly string[];
  readonly indicators: AllocationIndicators;
  readonly distribution: AllocationDistribution;
}

export type AllocationDistributionKey =
  '0' | '1' | '2' | '3' | '4' | 'dismissed' | 'below-minimum' | 'total';

export interface AllocationDistributionRow {
  readonly key: AllocationDistributionKey;
  readonly label: string;
  readonly count: number;
  readonly percentage: number;
  /** Zero is a subtotal of dismissed and below-minimum, never added twice. */
  readonly subtotal: boolean;
}

export interface AllocationDistribution {
  readonly totalTutors: number;
  readonly rows: readonly AllocationDistributionRow[];
}

export interface AllocationComparisonRow {
  readonly key: AllocationDistributionKey;
  readonly label: string;
  readonly subtotal: boolean;
  readonly minimum1Count: number;
  readonly minimum2Count: number;
  readonly countDifference: number;
  readonly minimum1Percentage: number;
  readonly minimum2Percentage: number;
  readonly percentagePointDifference: number;
}

/** Ranking substituivel; recebe apenas participantes com coordenadas validas. */
export type TutorDistanceScore = (
  tutor: Participant,
  fellows: readonly Participant[],
) => number | null;
