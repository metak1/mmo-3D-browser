import { Router } from "express";
import { asyncHandler } from "../http/asyncHandler.js";
import { getContentSnapshot } from "../db/content.js";

// No auth - the client needs this before login even happens (the class-select screen renders
// from it). See client/src/main.ts's boot-time fetch + loadGameContent() call.
export const contentRouter = Router();

contentRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await getContentSnapshot());
  }),
);
