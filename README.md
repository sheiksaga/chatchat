# ChatChat

A chat UI for talking to language models running on your own machine.

That's it, really. No accounts, no telemetry, no `npm install` that downloads
half the internet. It's a handful of HTML, CSS and JavaScript files that you
download, open in a browser, and use. Your conversations live in your browser's
localStorage and go nowhere else.[^1]

I built it because I wanted something nicer than a terminal for poking at local
models, and every other option wanted me to sign up for something.

## what you need

- **[LM Studio](https://lmstudio.ai)** (free) with at least one model downloaded
- A browser
- Python, or any other way to serve a folder of files locally

If you'd rather use a cloud model, there's a NanoGPT option built in — skip to
[using a cloud model](#using-a-cloud-model-instead) for that.

## running it locally

**1. Grab the files.**

Download the ZIP from the green *Code* button up top and unzip it, or if you're
a git person:

```bash
git clone https://github.com/<your-username>/chatchat.git
cd chatchat
```

Either way you end up with one folder containing `index.html`, `css/` and
`js/`. That folder *is* the app.

**2. Start LM Studio's server.**

Open LM Studio, go to the **Developer** tab (the little terminal icon in the
left rail), load a model, and hit **Start Server**. You want it listening on
`http://localhost:1234`, which is the default.

Leave LM Studio running in the background.

**3. Serve the folder.**

From inside the chatchat folder:

```bash
python3 -m http.server 8080
```

Then open **http://localhost:8080** in your browser.[^2]

**4. Pick a model and start typing.**

The dropdown at the top lists whatever LM Studio currently has loaded. Choose
one, type something into the box, hit enter. That's the whole setup.

## what's in the box

A few things I kept adding because I wanted them:

* **Streaming responses** — text appears as it's generated, and hitting stop
  keeps whatever arrived rather than throwing it away
* **Regenerate & cycle** — didn't like that answer? Regenerate it. Every
  version is kept, and you can flip back and forth between them
* **Story mode** — three flavours (choose-your-own-adventure, roleplay, and a
  game-master style) that build a system prompt for you from a scene, some
  characters and a few tags
* **Multiple chats** — a sidebar with the usual create / rename / delete
* **History compression** — when a conversation gets long, it can summarise the
  older turns so you don't blow past the context window
* **Sampling controls** — temperature, repetition penalty, top-p, top-k. It
  also tries to read sensible defaults off a model's Hugging Face README
* **Markdown + syntax highlighting**, with a copy button on code blocks

## using a cloud model instead

Hit the **Configuration** pill in the top right, switch the provider to
**NanoGPT**, and paste in your API key. The key is saved in localStorage on your machine — the
same place your chats live — and sent only to NanoGPT.

Any OpenAI-compatible endpoint will work if you point it somewhere else; the
provider list lives at the top of `js/state.js` and is four lines long.

## when it doesn't work

**Model dropdown is empty.** LM Studio's server isn't running, or no model is
loaded. Check the Developer tab.

**Everything looks fine but nothing sends.** Open the browser console. If you
see CORS errors, enable CORS in LM Studio's server settings — it's a toggle
right under the start button.

**You opened `index.html` by double-clicking it.** This sometimes works and
sometimes gets blocked by the browser's `file://` rules. Serving the folder
(step 3) avoids the whole question.

**A conversation got weird and won't recover.** Delete that chat from the
sidebar. Everything's in localStorage, so nothing is precious.

## poking at the code

There's no build step, no bundler, no dependencies to install. Edit a file,
refresh the browser, see the change. The three libraries it does use
(`marked`, `DOMPurify`, `highlight.js`) come from a CDN via script tags in
`index.html`.

```
index.html          # the whole app shell
css/style.css       # all of the styling
js/                 # eleven small files, one concern each
```

`PROJECT_STRUCTURE.md` has the file-by-file breakdown and load order.
`AGENTS.md` covers the bits that span multiple files — state shape,
localStorage schema, how streaming and regeneration actually work — and is
worth a read before changing anything non-trivial.

Thanks for reading. ❤️

[^1]: Other than to whichever model you're talking to, obviously. If that model
is running on your laptop, then genuinely nowhere.
[^2]: Any static server does the job. `npx serve`, VS Code's Live Server, that
one Ruby one-liner you remember from 2011 — all fine.
