/** Safe identifiers used to correlate a single request with a durable chat turn. */
export interface RequestTraceContext {
  requestId: string;
  sourceId: number;
  turnId: string;
}
