import { Router } from "express";
import bcrypt from "bcryptjs";
import { createUser, findUserById, findUserByUsername } from "../db/users.js";
import { signToken } from "../auth/jwt.js";
import { AuthedRequest, requireAuth } from "../http/authMiddleware.js";
import { asyncHandler } from "../http/asyncHandler.js";

const SALT_ROUNDS = 10;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

function publicUser(user: { id: number; username: string; email: string }) {
  return { id: user.id, username: user.username, email: user.email };
}

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body ?? {};

    if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username, email, and password are required" });
      return;
    }
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: "Username must be 3-32 characters (letters, numbers, underscore)" });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = await findUserByUsername(username);
    if (existing) {
      res.status(409).json({ error: "Username already taken" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      const user = await createUser(username, email, passwordHash);
      const token = signToken({ userId: user.id, username: user.username });
      res.status(201).json({ token, user: publicUser(user) });
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({ error: "Username or email already taken" });
        return;
      }
      throw err;
    }
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    const user = await findUserByUsername(username);
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const token = signToken({ userId: user.id, username: user.username });
    res.json({ token, user: publicUser(user) });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await findUserById(req.user!.userId);
    if (!user) {
      res.status(401).json({ error: "User no longer exists" });
      return;
    }
    res.json({ user: publicUser(user) });
  }),
);
