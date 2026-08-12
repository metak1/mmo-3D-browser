CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(32) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(32) UNIQUE NOT NULL,
  class_id VARCHAR(16) NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  strength INTEGER NOT NULL,
  dexterity INTEGER NOT NULL,
  intellect INTEGER NOT NULL,
  vitality INTEGER NOT NULL,
  luck INTEGER NOT NULL,
  armor INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS character_items (
  id SERIAL PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id VARCHAR(32) NOT NULL,
  slot VARCHAR(16) -- NULL = sitting in inventory, else 'weapon'/'armor'/'trinket'
);

CREATE UNIQUE INDEX IF NOT EXISTS character_items_equip_slot
  ON character_items (character_id, slot) WHERE slot IS NOT NULL;
