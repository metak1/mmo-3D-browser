import { Router } from "express";
import { CLASSES, ClassId } from "@mmo/shared";
import { createCharacter, findCharacterByName, listCharacters } from "../db/characters.js";
import { AuthedRequest, requireAuth } from "../http/authMiddleware.js";
import { asyncHandler } from "../http/asyncHandler.js";

const NAME_RE = /^[a-zA-Z0-9_ ]{2,32}$/;

export const charactersRouter = Router();

charactersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const characters = await listCharacters(req.user!.userId);
    res.json({ characters });
  }),
);

charactersRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { name, classId } = req.body ?? {};

    if (typeof name !== "string" || !NAME_RE.test(name)) {
      res.status(400).json({ error: "Name must be 2-32 characters (letters, numbers, spaces, underscore)" });
      return;
    }
    if (typeof classId !== "string" || !Object.prototype.hasOwnProperty.call(CLASSES, classId)) {
      res.status(400).json({ error: "Invalid class" });
      return;
    }

    const existing = await findCharacterByName(name);
    if (existing) {
      res.status(409).json({ error: "Character name already taken" });
      return;
    }

    const character = await createCharacter(req.user!.userId, name, classId as ClassId);
    res.status(201).json({ character });
  }),
);
