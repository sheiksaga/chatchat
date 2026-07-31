const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  webServer: {
    command: 'python -m http.server 8765',
    port: 8765,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:8765',
  },
});
