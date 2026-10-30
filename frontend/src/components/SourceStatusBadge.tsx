import type { SourceStatus } from '../types/types';

const STATUS_LABELS: Record<SourceStatus, string> = {
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
};

interface Props {
  status: SourceStatus;
  compact?: boolean;
}

export function SourceStatusBadge({ status, compact = false }: Props) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}${compact ? ' status-compact' : ''}`}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
