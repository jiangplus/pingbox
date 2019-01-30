
CREATE TABLE IF NOT EXISTS accounts (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    pubkey    text NOT NULL UNIQUE,
    seq       INTEGER DEFAULT 0,
    previous  text,
    name      text,
    image     text,
    following INTEGER DEFAULT 1,
    blocking  INTEGER DEFAULT 0,
    created   INTEGER DEFAULT 0,
    updated   INTEGER DEFAULT 0,
    changed   INTEGER DEFAULT 0,
    state     text DEFAULT 'local',
    role      text DEFAULT 'user'
   );

CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source    text NOT NULL,
    target    text NOT NULL,
    following INTEGER DEFAULT 0,
    blocking  INTEGER DEFAULT 0,
    created   INTEGER DEFAULT 0
   );

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         text NOT NULL,
    sig         text NOT NULL,
    author      text NOT NULL,
    previous    text,
    msgtype     text NOT NULL,
    seq         INTEGER DEFAULT 0,
    timestamp   INTEGER DEFAULT 0,
    localtime   INTEGER DEFAULT 0,
    content     text,
    raw         text,
    views_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    blocking    INTEGER DEFAULT 0,
    top         INTEGER DEFAULT 0,
    highlight   INTEGER DEFAULT 0
   );

CREATE TABLE IF NOT EXISTS peers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    pubkey            text NOT NULL,
    host              text,
    port              text,
    ticket            text,
    state_change      INTEGER DEFAULT 0,
    local_latest      INTEGER DEFAULT 0,
    remote_latest     INTEGER DEFAULT 0,
    role              text DEFAULT 'user',
    state             text DEFAULT '{}'
   );
