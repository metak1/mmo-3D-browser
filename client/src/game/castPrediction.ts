import { ClassId, getSpellCharges, SPELLS, SpellId } from "@mmo/shared";

export interface CastPredictor {
  // Per spell, cast timestamps still within their cooldown window - purely a client-side
  // prediction for the hotbar's cooldown sweep/charge badge, same as before charges existed;
  // the server (CombatEngine's own identically-shaped lastCastAt) is still the sole authority
  // and silently ignores casts that violate its own gate.
  activeCastsFor(spellId: SpellId, now: number): number[];
  // 1 base charge plus any spent extraCharges talents - identical shared helper to what
  // CombatEngine uses server-side, so this prediction stays in lockstep with the real gate.
  maxChargesFor(spellId: SpellId, classId: ClassId | null, talentRanks: Iterable<[string, number]> | undefined): number;
  // The optimistic-cooldown half of sending a cast - main.ts calls this immediately before its
  // own room?.send("cast", message), which stays there since this module has no room/network
  // access on purpose.
  pushCast(spellId: SpellId, now: number): void;
  // Undoes pushCast's optimistic cooldown push for a cast-time spell cancelled by movement, same
  // rule the server applies (CombatEngine.handleInput -> cancelPlayerCast(true)). Only valid
  // while the cast hasn't actually fired yet - once its castTimeMs has elapsed the server has (or
  // is about to) resolve it for real, so movement after that point must NOT refund the cooldown.
  cancelPendingCooldown(now: number): void;
}

export function createCastPredictor(): CastPredictor {
  const lastCastAt = new Map<SpellId, number[]>();
  // Tracks the in-flight cast-time spell so movement can undo its optimistic cooldown push
  // (mirrors CombatEngine's own pendingPlayerCast/cancelPlayerCast(refundCooldown) pairing) - kept
  // purely for the hotbar UI, since the server is still the sole authority on the real cooldown.
  let pending: { spellId: SpellId; startedAt: number } | null = null;

  function activeCastsFor(spellId: SpellId, now: number): number[] {
    const cooldownMs = SPELLS[spellId].cooldownMs;
    return (lastCastAt.get(spellId) ?? []).filter((t) => now - t < cooldownMs);
  }

  function maxChargesFor(spellId: SpellId, classId: ClassId | null, talentRanks: Iterable<[string, number]> | undefined): number {
    if (!classId || !talentRanks) return 1;
    return 1 + getSpellCharges(classId, spellId, talentRanks);
  }

  function pushCast(spellId: SpellId, now: number): void {
    const active = activeCastsFor(spellId, now);
    active.push(now);
    lastCastAt.set(spellId, active);
    if (SPELLS[spellId].castTimeMs > 0) pending = { spellId, startedAt: now };
  }

  function cancelPendingCooldown(now: number): void {
    if (!pending) return;
    const { spellId, startedAt } = pending;
    pending = null;
    if (now - startedAt >= SPELLS[spellId].castTimeMs) return;
    const active = lastCastAt.get(spellId);
    if (!active) return;
    const index = active.indexOf(startedAt);
    if (index !== -1) active.splice(index, 1);
  }

  return { activeCastsFor, maxChargesFor, pushCast, cancelPendingCooldown };
}
