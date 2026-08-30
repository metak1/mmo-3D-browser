import { useEffect, useState } from "react";
import { getToken, me, PublicUser, setToken } from "./api";
import { Login } from "./Login";
import { ENTITIES } from "./entities";
import { EntityTable } from "./EntityTable";
import { TalentTreeEditor } from "./TalentTreeEditor";
import { MapEditor } from "./mapEditor/MapEditor";
import { EnemyEditor } from "./enemyEditor/EnemyEditor";
import { SpellEditor } from "./SpellEditor";

const MAP_EDITOR_KEY = "__map_editor__";

export function App() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined); // undefined = still checking stored token
  const [activeEntity, setActiveEntity] = useState<string>(MAP_EDITOR_KEY);

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    me()
      .then((res) => setUser(res.user))
      .catch(() => {
        setToken(null);
        setUser(null);
      });
  }, []);

  function handleLogout() {
    setToken(null);
    setUser(null);
  }

  if (user === undefined) return <div className="center-message">Loading…</div>;
  if (user === null) return <Login onLoggedIn={setUser} />;
  if (user.role !== "admin") {
    return (
      <div className="center-message">
        <p>{user.username} is not an admin.</p>
        <button onClick={handleLogout}>Log out</button>
      </div>
    );
  }

  const schema = activeEntity === MAP_EDITOR_KEY ? undefined : ENTITIES.find((e) => e.key === activeEntity)!;

  return (
    <div className="admin-layout">
      <nav className="sidebar">
        <div className="sidebar-header">MMO Admin</div>
        <button
          className={activeEntity === MAP_EDITOR_KEY ? "nav-item active" : "nav-item"}
          onClick={() => setActiveEntity(MAP_EDITOR_KEY)}
        >
          Map Editor
        </button>
        {ENTITIES.filter((e) => !e.hidden).map((e) => (
          <button
            key={e.key}
            className={e.key === activeEntity ? "nav-item active" : "nav-item"}
            onClick={() => setActiveEntity(e.key)}
          >
            {e.label}
          </button>
        ))}
        <button className="nav-item logout" onClick={handleLogout}>
          Log out ({user.username})
        </button>
      </nav>
      <main className={!schema || schema.key === "enemy-types" || schema.key === "spells" ? "content content-full" : "content"}>
        {schema ? (
          schema.key === "talents" ? (
            <TalentTreeEditor key={schema.key} schema={schema} />
          ) : schema.key === "enemy-types" ? (
            <EnemyEditor key={schema.key} />
          ) : schema.key === "spells" ? (
            <SpellEditor key={schema.key} />
          ) : (
            <EntityTable key={schema.key} schema={schema} />
          )
        ) : (
          <MapEditor />
        )}
      </main>
    </div>
  );
}
