# MMO 3D Navigateur

A browser-based 3D top-down (Diablo-style) multiplayer prototype.

**Milestone 1**: shared world + WASD movement. Multiple players connect to one
authoritative server room and see each other move around a flat test map in
real time. No combat, persistence, or accounts yet.

## Stack

- **Client**: Three.js + Vite + TypeScript, `colyseus.js`
- **Server**: Colyseus (authoritative Node.js rooms) + TypeScript
- **Shared**: a small workspace package with types/constants used by both

## Run it

```bash
npm install
npm run dev
```

This starts the Colyseus server on `ws://localhost:2567` and the Vite dev
client on `http://localhost:5173`. Open the client URL in two browser tabs to
see multiplayer movement sync between them.

WASD (or arrow keys) to move.


All four phases of the composable combat effects system are now complete and verified. Summary of what shipped and what I found along the way:

Core system (already built pre-summary, now confirmed working end-to-end):

EffectDef (shape + actions) drives both SpellDef.effects (additive, old spells untouched) and BossAbilityDef.effect (full replacement)
New DOT subsystem: DotStack schema on Player and Enemy, ticked every server tick, capped at 4 stacks
One resolver (resolveEffect) wired into all 4 cast paths: instant cast, windup cast, projectile landing, boss ability
Client Telegraph.ts renders circle/cone/line/randomPoints shapes generically
Two bugs found and fixed this session:

spellsRouter never registered effects as a jsonColumns entry, so saving any spell with composable effects 500'd (raw array handed to pg for a jsonb column instead of being stringified). Fixed, verified via a full admin create → DB read → reopen-and-reload round trip.
The live DB still had dungeon_boss/boss using the old raidNova/singleTargetBurst shape, which the rewritten resolveBossAbility can no longer parse — boss specials were broken. Reshaped both rows to the new EffectDef format (confirmed via git diff of the exact old semantics: raidNova was a circle centered on the caster, singleTargetBurst hit only the resolved target), with your explicit go-ahead before running the SQL.
Bonus find: enemyTypesRouter's Zod schema validated stats as z.record(string, number), but BossStats nests arrays (specialAbilities, addSpawns) — meaning saving any boss enemy-type through the admin UI has always 400'd. Loosened it to z.record(string, unknown()), matching the comment's own stated intent. Verified by round-tripping both boss rows through the real admin PATCH endpoint afterward (all fields intact).
All 3 workspaces (server/client/admin) typecheck clean. Test spell and scratchpad files cleaned up.

One item from the plan's verification list remains unconfirmed: live in-browser rendering of the new cone/line telegraph shapes specifically (the geometry math itself passed a real assertion test server-side, and typechecks client-side, but I haven't visually confirmed a cone telegraph in an actual running game session). Happy to set that up if you want it closed out, otherwise this is a good stopping point.