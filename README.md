# chatchat

A local chat app for llama.cpp (and any OpenAI-compatible server), with SillyTavern character
cards, lorebooks and — soon — ComfyUI image generation. It runs on your own machine, needs no
account, and the only network traffic it makes is to the model server you point it at.

- **Local first.** No cloud, no telemetry, no CDN. The browser talks only to this app.
- **LAN ready.** Start it on the desktop and use it from your phone over the same network (or Tailscale).
- **Your data stays a file.** Chats live in one SQLite database you can copy or back up.
- **Keys stay on the server.** Provider API keys live in `data/config.json` and never reach the browser.

## Start it

1. Install [Node.js 22 or newer](https://nodejs.org).
2. Start your model server — llama.cpp with `--models-dir` (router mode) is the default, LM Studio works too.
3. Double-click **`start-chatchat.bat`**. The first run installs dependencies and builds (a few
   minutes); later runs start immediately.

Then open <http://localhost:4173>.

### From a phone

Set a token before starting so other devices must present it:

```bat
set CHATCHAT_TOKEN=pick-something-long
start-chatchat.bat
```

Open `http://<this-pc-ip>:4173/login?token=pick-something-long` once per device. Without a token the
app only accepts connections from the machine it runs on.

## Configure models

**Settings** (`/settings`) lists providers, keys and the active model. Two local providers are
created on first run: llama.cpp at `127.0.0.1:8081` and LM Studio at `127.0.0.1:1234`. For llama.cpp
router mode, set **models-router.ini** on the provider so each model keeps its own sampler defaults.

## No GPU? Try the app anyway

```bat
npm run dev:fake
```

That starts a stub OpenAI-compatible model on `:8899`. Add it in Settings (kind _OpenAI-compatible_,
base URL `http://127.0.0.1:8899/v1`) and every screen works — streaming, characters, search — without
a GPU or a model download.

## Pictures

With ComfyUI running (default `http://127.0.0.1:8188`, **start it before llama.cpp** on an 8 GB card):

- type `/image a lighthouse at dusk, painterly` in the composer — the model never sees this command;
- or press **wide / medium / close-up** above the composer for "a picture of this moment", which tags the
  scene from the character card, the chat's `look` and the last turns;
- press the thumbnail to open the viewer: regenerate, regenerate with the same seed, or **edit region**
  to paint a mask and have ComfyUI repaint just that part.

Pictures live in `data/images/` with their prompt, seed and workflow in the database. If a reply writes
`[[IMG: …]]`, the transcript shows a button instead of spending GPU time unasked.

## Characters

`/characters` imports SillyTavern cards: a PNG with card data in it, a `.json` card, or a whole
selection at once. Card v1/v2/v3 are all supported, including lorebooks. To pull in an existing
SillyTavern library, run `npm run import:cards` with the old `cards/cards.js` in `legacy/`.

## If something is wrong

```bat
npm run doctor
```

It probes every configured provider, the router preset, ComfyUI, the database and the LAN token, and
prints one line per check. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) maps symptoms to causes.

## For contributors (human or AI)

| Document                                           | Purpose                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                             | invariants, where to change what, verified gotchas                   |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)       | data flow, decisions, layout                                         |
| [docs/PARITY.md](docs/PARITY.md)                   | feature-by-feature status vs the pre-rewrite app                     |
| [docs/DEPS.md](docs/DEPS.md)                       | why each dependency exists, with usage pinned to the installed major |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | symptom → probe → fix                                                |

```bat
npm run verify     :: types + lint + unit tests
npm run test:e2e   :: browser flows (Playwright, desktop + phone viewport)
```

`legacy/` holds the pre-rewrite app for reference; it is not part of the build.

Licensed under the GPL-3.0 — see [LICENSE](LICENSE).
