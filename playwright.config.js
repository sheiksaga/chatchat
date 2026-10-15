const { defineConfig } = require('@playwright/test');

// Port is overridable: a stale unrelated server on the default port gets
// silently adopted otherwise, and then every locator fails against the wrong
// app. Run `PORT=8799 npm test` to sidestep a squatter.
const PORT = Number(process.env.PORT) || 8765;

module.exports = defineConfig({
  testDir: './test',
  webServer: {
    // Node, not `python -m http.server`: Python is not reliably on PATH (on
    // Windows `python3` usually resolves to the Microsoft Store stub, which
    // exits at once and leaves the webServer waiting on a port that never
    // opens). tools/serve.js is zero-dependency and always available here.
    command: `node tools/serve.js ${PORT}`,
    port: PORT,
    // Deliberately not `!process.env.CI`: reusing whatever already holds the
    // port means a busy port turns into a green run against the wrong server,
    // which is far worse than a loud failure. Opt in with PW_REUSE_SERVER=1
    // when you are intentionally keeping one running.
    reuseExistingServer: !!process.env.PW_REUSE_SERVER,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
});
