/**
 * Novel coexistence build: rename the Electron app *before anything reads a
 * userData-derived path*, so this build's data lives in its own
 * `%APPDATA%/CherryStudioNovel` tree and never collides with a stock Cherry
 * Studio install.
 *
 * Why this is a side-effect module imported first: Electron caches the
 * `userData` directory the moment `app.getPath('userData')` is first called,
 * after which `app.setName()` no longer moves it. BootConfig (the very first
 * import in main/index.ts) resolves its path from userData, so the rename must
 * run before even that import. ESM evaluates imported modules in source order,
 * so importing this module on the first line guarantees it runs first.
 *
 * Packaged-only: dev keeps Electron's default name (its own `…Dev` suffixing in
 * resolveUserDataLocation is unaffected), so dev data does not move.
 */
import { app } from 'electron'

if (app.isPackaged) {
  app.setName('CherryStudioNovel')
}
