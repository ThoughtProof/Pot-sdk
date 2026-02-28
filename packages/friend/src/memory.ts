/**
 * SQLite-backed memory store for the Friend critic.
 *
 * Uses Node.js built-in `node:sqlite` (available since Node 22.5+).
 * No native compilation required.
 *
 * This approximates familiarity through pattern recognition.
 * It is not true relationship. See ROADMAP.md for jas's challenge.
 */
import { DatabaseSync } from 'node:sqlite';
import type { FriendMemory } from './types.js';

export class FriendMemoryStore {
  private db: DatabaseSync;

  constructor(dbPath: string = '.pot-friend.db') {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS friend_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        claim_hash TEXT NOT NULL,
        claim TEXT NOT NULL,
        verdict TEXT NOT NULL,
        objections TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        domain TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_session ON friend_memory(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_ts ON friend_memory(session_id, timestamp);
    `);
  }

  save(entry: FriendMemory): void {
    const stmt = this.db.prepare(`
      INSERT INTO friend_memory
        (session_id, claim_hash, claim, verdict, objections, confidence, timestamp, domain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.sessionId,
      entry.claimHash,
      entry.claim,
      entry.verdict,
      JSON.stringify(entry.objections),
      entry.confidence,
      entry.timestamp,
      entry.domain ?? null,
    );
  }

  getRecentBySession(sessionId: string, limit: number = 20): FriendMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM friend_memory
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(sessionId, limit) as any[];
    return rows.map(this.rowToEntry);
  }

  getRecurringObjections(sessionId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT objections FROM friend_memory WHERE session_id = ?
    `);
    const rows = stmt.all(sessionId) as { objections: string }[];

    const freq = new Map<string, number>();
    for (const row of rows) {
      const objections: string[] = JSON.parse(row.objections);
      for (const obj of objections) {
        const key = obj.trim().toLowerCase();
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }

    return Array.from(freq.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([phrase]) => phrase);
  }

  getSimilarClaims(claimHash: string, sessionId: string): FriendMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM friend_memory
      WHERE session_id = ?
        AND confidence < 0.5
        AND claim_hash != ?
      ORDER BY timestamp DESC
      LIMIT 10
    `);
    const rows = stmt.all(sessionId, claimHash) as any[];
    return rows.map(this.rowToEntry);
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: any): FriendMemory {
    return {
      sessionId: row.session_id,
      claimHash: row.claim_hash,
      claim: row.claim,
      verdict: row.verdict,
      objections: JSON.parse(row.objections),
      confidence: row.confidence,
      timestamp: row.timestamp,
      domain: row.domain ?? undefined,
    };
  }
}
