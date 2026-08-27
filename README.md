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

