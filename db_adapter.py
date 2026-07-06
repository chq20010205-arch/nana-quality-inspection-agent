# -*- coding: utf-8 -*-
"""Small database adapter for local SQLite and hosted PostgreSQL."""

import re
import sqlite3


class DatabaseIntegrityError(Exception):
    """Raised when a database uniqueness/constraint error occurs."""


class DatabaseConnectionFactory:
    def __init__(self, database_url):
        self.database_url = database_url
        self.using_postgres = str(database_url).startswith(("postgres://", "postgresql://"))

    def connect(self):
        if not self.using_postgres:
            conn = sqlite3.connect(self.database_url)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            return conn

        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError(
                "PostgreSQL is configured, but psycopg is not installed. "
                "Install requirements.txt again."
            ) from exc

        conn = psycopg.connect(self.database_url, row_factory=dict_row)
        return PostgresConnection(conn)


class PostgresConnection:
    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=None):
        cursor = self.conn.cursor()
        query, returning_id = _translate_query(sql)
        try:
            cursor.execute(query, params or ())
            return PostgresCursor(cursor, returning_id=returning_id)
        except Exception as exc:
            self.conn.rollback()
            if _is_integrity_error(exc):
                raise DatabaseIntegrityError(str(exc)) from exc
            raise

    def executescript(self, _script):
        cursor = self.conn.cursor()
        for statement in _postgres_schema_statements():
            cursor.execute(statement)
        self.conn.commit()

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()


class PostgresCursor:
    def __init__(self, cursor, returning_id=False):
        self.cursor = cursor
        self._lastrowid = None
        if returning_id:
            row = cursor.fetchone()
            if row:
                self._lastrowid = row["id"]

    @property
    def lastrowid(self):
        return self._lastrowid

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()


def _translate_query(sql):
    query = re.sub(r"\?", "%s", sql)
    normalized = " ".join(query.strip().split()).upper()
    returning_id = (
        normalized.startswith("INSERT INTO REGULATIONS")
        or normalized.startswith("INSERT INTO CLAUSES")
    )
    if returning_id and " RETURNING " not in normalized:
        query = query.rstrip().rstrip(";") + " RETURNING id"
    return query, returning_id


def _is_integrity_error(exc):
    try:
        import psycopg

        return isinstance(exc, psycopg.IntegrityError)
    except Exception:
        return False


def _postgres_schema_statements():
    return [
        """
        CREATE TABLE IF NOT EXISTS regulations (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            full_name TEXT,
            category TEXT,
            publish_date TEXT,
            implement_date TEXT,
            is_mandatory INTEGER DEFAULT 0,
            description TEXT,
            created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS clauses (
            id SERIAL PRIMARY KEY,
            regulation_id INTEGER NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
            clause_number TEXT NOT NULL,
            clause_content TEXT NOT NULL,
            keywords TEXT,
            category TEXT,
            is_mandatory INTEGER DEFAULT 0
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS problems (
            id SERIAL PRIMARY KEY,
            description TEXT NOT NULL,
            location TEXT,
            project_name TEXT,
            inspection_date TEXT,
            matched_clauses TEXT,
            created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS notice_records (
            id SERIAL PRIMARY KEY,
            project_name TEXT,
            supervision_no TEXT,
            construction_unit TEXT,
            supervision_unit TEXT,
            construction_company TEXT,
            inspection_date TEXT,
            problems TEXT,
            created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
        )
        """,
    ]
