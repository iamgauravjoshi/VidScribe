export const VideoProcessingStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export type VideoProcessingStatus =
  (typeof VideoProcessingStatus)[keyof typeof VideoProcessingStatus];
