export interface EvidenceAnchorSegment {
  segmentIndex: number;
  startSeconds: number;
  text: string;
}

export interface SelectedEvidenceAnchor {
  segment: EvidenceAnchorSegment;
  matchingSegmentCount: number;
  occurrence: number;
}

export function normalizeEvidenceText(value: string): string {
  return value.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

export function selectEvidenceAnchor(
  segments: EvidenceAnchorSegment[],
  anchorPhrase: string,
  occurrence = 0,
): SelectedEvidenceAnchor {
  const normalizedPhrase = normalizeEvidenceText(anchorPhrase);

  if (normalizedPhrase.length < 3 || normalizedPhrase.length > 80) {
    throw new Error('Evidence anchor phrases must contain between 3 and 80 characters.');
  }

  if (!Number.isInteger(occurrence) || occurrence < 0) {
    throw new Error('Evidence anchor occurrence must be a non-negative integer.');
  }

  const matches = segments.filter((segment) =>
    normalizeEvidenceText(segment.text).includes(normalizedPhrase),
  );
  const selected = matches[occurrence];

  if (!selected) {
    throw new Error(
      `Evidence anchor “${anchorPhrase}” occurrence ${occurrence} was not found in ${matches.length} matching transcript segments.`,
    );
  }

  return { segment: selected, matchingSegmentCount: matches.length, occurrence };
}
