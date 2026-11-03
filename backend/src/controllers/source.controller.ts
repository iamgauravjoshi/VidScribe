import type { Request, Response } from 'express';

import {
  askSourceQuestion as generateSourceAnswer,
  getSourceConversation,
} from '../services/chat/conversation.service.js';
import {
  addSource,
  getSource,
  getSources,
  removeSource,
  retrySource,
} from '../services/sources/source.service.js';
import { toSourceDto } from '../types/source.type.js';
import {
  exportSourceTranscript as createTranscriptExport,
  getSourceTranscriptPage,
  startSourceTranscriptRefresh,
  type TranscriptExportFormat,
} from '../services/transcript/transcript.service.js';

export async function createSource(req: Request, res: Response): Promise<void> {
  const result = await addSource(req.body.url as string);

  res.status(result.created ? 202 : 200).json({
    source: toSourceDto(result.source),
    created: result.created,
  });
}

export async function listSources(_req: Request, res: Response): Promise<void> {
  const sources = await getSources();

  res.json({ sources: sources.map(toSourceDto) });
}

export async function readSource(req: Request, res: Response): Promise<void> {
  const source = await getSource(Number(req.params.sourceId));

  res.json({ source: toSourceDto(source) });
}

export async function readSourceTranscript(req: Request, res: Response): Promise<void> {
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const cursor = req.query.cursor === undefined ? undefined : Number(req.query.cursor);
  const aroundSeconds = req.query.around === undefined ? undefined : Number(req.query.around);
  const search = typeof req.query.query === 'string' ? req.query.query.trim() : undefined;
  const transcript = await getSourceTranscriptPage(Number(req.params.sourceId), {
    limit,
    cursor,
    query: search || undefined,
    aroundSeconds,
  });

  res.json({ transcript });
}

export async function rebuildSourceTranscript(req: Request, res: Response): Promise<void> {
  const transcript = await startSourceTranscriptRefresh(Number(req.params.sourceId));
  res.status(transcript.status === 'READY' ? 200 : 202).json({ transcript });
}

export async function exportSourceTranscript(req: Request, res: Response): Promise<void> {
  const format = req.query.format as TranscriptExportFormat;
  const transcript = await createTranscriptExport(Number(req.params.sourceId), format);
  res.setHeader('Content-Type', transcript.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${transcript.filename}"`);
  res.send(transcript.body);
}

export async function readSourceConversation(req: Request, res: Response): Promise<void> {
  const conversation = await getSourceConversation(Number(req.params.sourceId));

  res.json({ conversation });
}

export async function retrySourceProcessing(req: Request, res: Response): Promise<void> {
  const source = await retrySource(Number(req.params.sourceId));

  res.status(202).json({ source: toSourceDto(source) });
}

export async function deleteSource(req: Request, res: Response): Promise<void> {
  await removeSource(Number(req.params.sourceId));
  res.status(204).end();
}

export async function askSourceQuestion(req: Request, res: Response): Promise<void> {
  const sourceId = Number(req.params.sourceId);
  const turnId = req.body.requestId as string;
  const requestId = res.locals.requestId as string;
  res.locals.sourceId = sourceId;
  res.locals.turnId = turnId;

  const turn = await generateSourceAnswer({
    sourceId,
    turnId,
    question: req.body.question as string,
    requestId,
  });

  res.status(turn.status === 'PENDING' ? 202 : 200).json({ turn });
}
