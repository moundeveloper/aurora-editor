import { DatabaseSync } from 'node:sqlite'
import { mediaAssetSchema, type MediaAssetRecord } from '../../../shared/contracts.ts'

/**
 * The index over the blob store: what a hash is called, what kind of media it is, and what probing
 * it revealed. Blobs are the durable part — this can be rebuilt by walking `media/` — so it stays a
 * plain lookup table rather than anything the vault's integrity depends on.
 *
 * `node:sqlite` ships with Node, which keeps a native build step out of the project entirely.
 */
export class AssetIndex {
  private readonly database: DatabaseSync

  constructor(location: string) {
    this.database = new DatabaseSync(location)
    // WAL lets a read run while a write is in flight, which matters once probing happens in the
    // background while the library is being listed.
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id            TEXT PRIMARY KEY,
        hash          TEXT NOT NULL,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL,
        mimeType      TEXT NOT NULL,
        sizeBytes     INTEGER NOT NULL,
        importedAt    INTEGER NOT NULL,
        durationSeconds REAL,
        width         INTEGER,
        height        INTEGER
      );
      CREATE INDEX IF NOT EXISTS assets_hash ON assets (hash);
      CREATE INDEX IF NOT EXISTS assets_imported ON assets (importedAt DESC);
    `)
  }

  insert(record: MediaAssetRecord): MediaAssetRecord {
    const parsed = mediaAssetSchema.parse(record)
    this.database.prepare(`
      INSERT INTO assets (id, hash, name, kind, mimeType, sizeBytes, importedAt, durationSeconds, width, height)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      parsed.id, parsed.hash, parsed.name, parsed.kind, parsed.mimeType,
      parsed.sizeBytes, parsed.importedAt,
      parsed.durationSeconds ?? null, parsed.width ?? null, parsed.height ?? null,
    )
    return parsed
  }

  list(): MediaAssetRecord[] {
    const rows = this.database.prepare('SELECT * FROM assets ORDER BY importedAt DESC').all()
    return rows.map((row) => rowToRecord(row))
  }

  byId(id: string): MediaAssetRecord | null {
    const row = this.database.prepare('SELECT * FROM assets WHERE id = ?').get(id)
    return row ? rowToRecord(row) : null
  }

  /** The first record sharing a hash, used to answer an import with the existing entry. */
  byHash(hash: string): MediaAssetRecord | null {
    const row = this.database.prepare('SELECT * FROM assets WHERE hash = ? ORDER BY importedAt ASC LIMIT 1').get(hash)
    return row ? rowToRecord(row) : null
  }

  /** How many records still point at a hash — a blob may only be deleted once this reaches zero. */
  referenceCount(hash: string): number {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM assets WHERE hash = ?').get(hash) as { total?: number } | undefined
    return Number(row?.total ?? 0)
  }

  remove(id: string): boolean {
    return this.database.prepare('DELETE FROM assets WHERE id = ?').run(id).changes > 0
  }

  totals() {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS assetCount, COALESCE(SUM(sizeBytes), 0) AS bytesStored
      FROM (SELECT DISTINCT hash, sizeBytes FROM assets)
    `).get() as { assetCount?: number; bytesStored?: number } | undefined
    return { assetCount: Number(row?.assetCount ?? 0), bytesStored: Number(row?.bytesStored ?? 0) }
  }

  close() {
    this.database.close()
  }
}

function rowToRecord(row: unknown): MediaAssetRecord {
  const source = row as Record<string, unknown>
  // SQLite returns nulls for absent optionals; the schema wants them gone rather than null.
  return mediaAssetSchema.parse({
    ...source,
    durationSeconds: source.durationSeconds ?? undefined,
    width: source.width ?? undefined,
    height: source.height ?? undefined,
  })
}
