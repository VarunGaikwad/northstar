import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import * as notesService from "./notes.service";
import type { NoteResponse } from "./notes.types";
import {
  parseCreateNote,
  parseIfMatch,
  parseImageOrder,
  parseListNotesQuery,
  parsePatchNote,
  parseRouteId,
  parseUploadIntent,
} from "./notes.validation";

function requireUserId(req: Request): string {
  const userId = req.user?.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new ApiError("Unauthorized", 401);
  }
  return userId;
}

function getNoteId(req: Request): string {
  return parseRouteId(req.params.noteId, "noteId");
}

function getImageId(req: Request): string {
  return parseRouteId(req.params.imageId, "imageId");
}

function getExpectedVersion(req: Request): number {
  return parseIfMatch(req.headers["if-match"]);
}

function sendNote(res: Response, note: NoteResponse, statusCode = 200): void {
  res.setHeader("ETag", `"${note.version}"`);
  res.status(statusCode).json({ success: true, data: note });
}

export async function createNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const input = parseCreateNote(req.body);
  const note = await notesService.createNote(userId, input);
  sendNote(res, note, 201);
}

export async function listNotes(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const query = parseListNotesQuery(req.query);
  const page = await notesService.listNotes(userId, query);
  res.status(200).json({ success: true, data: page });
}

export async function getNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.getNote(userId, getNoteId(req));
  sendNote(res, note);
}

export async function patchNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const noteId = getNoteId(req);
  const input = parsePatchNote(req.body);
  const expectedVersion = getExpectedVersion(req);
  const note = await notesService.patchNote(
    userId,
    noteId,
    input,
    expectedVersion,
  );
  sendNote(res, note);
}

export async function archiveNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.archiveNote(
    userId,
    getNoteId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}

export async function unarchiveNote(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.unarchiveNote(
    userId,
    getNoteId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}

export async function trashNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.trashNote(
    userId,
    getNoteId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}

export async function restoreNote(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.restoreNote(
    userId,
    getNoteId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}

export async function permanentlyDeleteNote(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  await notesService.permanentlyDeleteNote(
    userId,
    getNoteId(req),
    getExpectedVersion(req),
  );
  res.status(202).json({
    success: true,
    message: "Note deletion accepted",
  });
}

export async function createImageUploadIntent(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  const input = parseUploadIntent(req.body);
  const intent = await notesService.createImageUploadIntent(
    userId,
    getNoteId(req),
    input,
  );
  res.status(201).json({ success: true, data: intent });
}

export async function confirmNoteImage(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.confirmNoteImage(
    userId,
    getNoteId(req),
    getImageId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}

export async function reorderNoteImages(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  const noteId = getNoteId(req);
  const input = parseImageOrder(req.body);
  const expectedVersion = getExpectedVersion(req);
  const note = await notesService.reorderNoteImages(
    userId,
    noteId,
    input,
    expectedVersion,
  );
  sendNote(res, note);
}

export async function deleteNoteImage(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireUserId(req);
  const note = await notesService.deleteNoteImage(
    userId,
    getNoteId(req),
    getImageId(req),
    getExpectedVersion(req),
  );
  sendNote(res, note);
}
