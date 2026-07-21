# Task 1 Brief: Update state shape and add migration

## Target file
- Modify: js/state.js

## Step 1: Update storyConfig default shape

Find:
```
let storyConfig = { scene: '', characters: '', tags: '' };
```
Replace with:
```
let storyConfig = { scene: '', characters: [], tags: '', firstPrompt: '' };
```

## Step 2: Add migration for old storyConfig format

Inside migrateData(), after the existing `if (version < 1)` block, add:

```js
    // Migrate old flat character string to array
    const meta = JSON.parse(localStorage.getItem(CHAT_META_KEY) || '{}');
    let changed = false;
    for (const chatId in meta) {
        if (meta[chatId]?.storyConfig && typeof meta[chatId].storyConfig.characters === 'string') {
            const oldChars = meta[chatId].storyConfig.characters;
            meta[chatId].storyConfig.characters = oldChars
                .split(/[,|]/)
                .map(s => s.trim())
                .filter(Boolean)
                .map(name => ({ name, traits: '' }));
            if (!meta[chatId].storyConfig.firstPrompt) {
                meta[chatId].storyConfig.firstPrompt = '';
            }
            changed = true;
        }
    }
    if (changed) {
        localStorage.setItem(CHAT_META_KEY, JSON.stringify(meta));
    }
```

## Verification
- Open index.html in browser → no console errors
- storyConfig should default to the new shape
