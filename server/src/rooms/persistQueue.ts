// Colyseus doesn't await onMessage handlers before processing the next message, so persistence
// calls are otherwise fire-and-forget - two rapid writes for the same session (e.g. buy then
// sell, or a loot pickup right as the player disconnects) can race and let a stale write clobber
// a newer one in the DB. Chaining every persistence call for a session through one of these makes
// them apply strictly in call order, so the last one always wins.
export class PersistQueue {
  private queues = new Map<string, Promise<void>>();

  run(sessionId: string, task: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(sessionId) ?? Promise.resolve()).then(task);
    this.queues.set(sessionId, next);
    return next;
  }

  // Call once a session's final persistence call has already settled (e.g. onLeave, after
  // awaiting the last save) - just frees the map entry, doesn't cancel anything in flight.
  clear(sessionId: string) {
    this.queues.delete(sessionId);
  }
}
