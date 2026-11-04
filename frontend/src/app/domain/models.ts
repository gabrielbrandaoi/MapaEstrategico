export type ParticipantType = 'tutor' | 'fellow';

export interface Location {
  latitude: number;
  longitude: number;
  source: 'imported' | 'municipal-centroid';
}

export interface Participant {
  id: string;
  type: ParticipantType;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  postalCode: string | null;
  location: Location | null;
  sourceRow: number;
  identityUnverified?: boolean;
}

export type ImportIssueSeverity = 'error' | 'warning';

export interface ImportIssue {
  rowNumber: number | null;
  severity: ImportIssueSeverity;
  code: string;
  message: string;
}

export interface ImportReport {
  totalRows: number;
  participants: Participant[];
  issues: ImportIssue[];
  invalidRows: number[];
  participantsWithoutCoordinates: number;
  relationships?: ImportedRelationship[];
  participantsWithProvisionalIdentity?: number;
}

export interface ImportedRelationship {
  tutorId: string;
  fellowId: string;
  reportedKm: number | null;
  sourceRow: number;
  sheetName: string;
  fileName: string;
}

export interface ImportBatch {
  fileName: string;
  sheetName: string;
  participantType: ParticipantType | null;
  report: ImportReport;
}

export interface ColumnMapping {
  type: number | null;
  name: number | null;
  city: number | null;
  state: number | null;
  address: number | null;
  postalCode: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
}

export type RoadRouteStatus = 'success' | 'unavailable' | 'error';

export interface RoadRoute {
  status: RoadRouteStatus;
  distanceMeters: number | null;
  durationSeconds: number | null;
  provider: string;
  calculatedAt: string;
  profile: string;
  message: string | null;
}

export type RoadDistanceBand =
  'within-50-km' | '50-to-100-km' | 'over-100-km' | 'not-calculated' | 'unavailable' | 'error';

export interface ProximityPair {
  tutorId: string;
  fellowId: string;
  straightLineKm: number;
  route: RoadRoute | null;
}
