import type { DeltaForQuery, QueryName, QueryParams, SnapshotForQuery } from '@eveys-console/protocol';

export interface Subscription {
  id: string;
  query: QueryName;
  params: QueryParams;
}

export interface Snapshot {
  cursor: string;
  snapshot: SnapshotForQuery;
}

export interface Delta {
  cursor: string;
  delta: DeltaForQuery;
}
