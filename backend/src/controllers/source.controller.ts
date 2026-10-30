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
