import { Response, NextFunction } from "express";
import { findUserRoleById } from "../db/users.js";
import { AuthedRequest } from "./authMiddleware.js";
import { asyncHandler } from "./asyncHandler.js";

// Must run after requireAuth (needs req.user). Looks up the caller's CURRENT role fresh from
// the DB on every request rather than trusting a JWT-embedded claim - a demotion takes effect
// on the very next request instead of waiting out the token's 7-day expiry.
export const requireAdmin = asyncHandler(async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const role = req.user ? await findUserRoleById(req.user.userId) : null;
  if (role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
});
