import { useEffect, useState } from "react";
import { getToken, me, PublicUser, setToken } from "./api";
import { Login } from "./Login";
import { ENTITIES } from "./entities";
import { EntityTable } from "./EntityTable";

export function App() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined); // undefined = still checking stored token
  const [activeEntity, setActiveEntity] = useState(ENTITIES[0].key);

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

  const schema = ENTITIES.find((e) => e.key === activeEntity)!;

  return (
    <div className="admin-layout">
      <nav className="sidebar">
        <div className="sidebar-header">MMO Admin</div>
        {ENTITIES.map((e) => (
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
      <main className="content">
        <EntityTable key={schema.key} schema={schema} />
      </main>
    </div>
  );
}
