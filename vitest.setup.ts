/**
 * Runs once before any test file: give the whole suite a throwaway `data/`.
 *
 * Without this, a test that calls `db()` (rather than passing its own `:memory:` handle) would open the
 * developer's real `data/chatchat.db` — creating and deleting chats in the data they actually use. That
 * happened once: the app's folder listing grew chats that no longer existed. One line here prevents it.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = mkdtempSync(path.join(tmpdir(), 'chatchat-tests-'));
process.env.CHATCHAT_DATA_DIR = scratch;
process.env.CHATCHAT_CONFIG = path.join(scratch, 'config.json');
