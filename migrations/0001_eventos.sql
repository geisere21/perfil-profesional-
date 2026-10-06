-- Eventos de la landing. Sin IP, sin agente de usuario, sin identificadores.
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  tipo TEXT NOT NULL,
  origen TEXT NOT NULL,
  boton TEXT,
  q1 TEXT,
  q2 TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_creado ON eventos (creado);
CREATE INDEX IF NOT EXISTS idx_eventos_tipo ON eventos (tipo, origen);
