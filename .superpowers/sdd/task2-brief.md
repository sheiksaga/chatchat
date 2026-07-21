# Task 2 Brief: Replace flat story config HTML with sectioned form

## Target file
- Modify: index.html

## What to do
Replace the old story-config div with a sectioned form including:
- "Use Default" pill centered above the form
- Section labels: Opening Scene, Characters, Tags, First Prompt
- Character rows rendered dynamically (leave empty container)
- Add Character button
- First Prompt textarea
- Export/Import action bar and hidden file input

## Old HTML to replace

```
                <!-- Story config (hidden in chat mode) -->
                <div class="story-config hidden" id="story-config">
                    <input type="text" class="story-config-input" id="story-scene" placeholder="Scene: A dark forest, a spaceship bridge, a medieval tavern...">
                    <input type="text" class="story-config-input" id="story-characters" placeholder="Characters: Captain Voss (stern), Elara (mysterious)...">
                    <input type="text" class="story-config-input" id="story-tags" placeholder="Tags: fantasy, mystery, horror, sci-fi, romance...">
                </div>
```

## New HTML

```
                <!-- Story config (hidden in chat mode) -->
                <div class="story-config hidden" id="story-config">
                    <!-- Use Default pill -->
                    <div class="story-default-wrapper" id="story-default-wrapper">
                        <button class="quick-chip story-default-pill" id="story-default-pill" onclick="useDefaultStory()">
                            <span class="quick-chip-icon">✨</span> Use Default
                        </button>
                    </div>

                    <div class="story-section-label">Opening Scene</div>
                    <input type="text" class="story-config-input" id="story-scene" placeholder="A dark forest, a spaceship bridge, a medieval tavern...">

                    <div class="story-section-label">Characters</div>
                    <div id="story-characters-list"></div>
                    <button class="btn-add-char" id="btn-add-char" onclick="addCharacterRow()">+ Add Character</button>

                    <div class="story-section-label">Tags</div>
                    <input type="text" class="story-config-input" id="story-tags" placeholder="fantasy, mystery, horror, sci-fi, romance...">

                    <div class="story-section-label">First Prompt</div>
                    <textarea class="story-first-prompt" id="story-first-prompt" placeholder="Describe the opening scene and present the first choices for the player."></textarea>

                    <!-- Export/Import bar -->
                    <div class="story-action-bar">
                        <button class="btn-story-action" onclick="exportStoryConfig('json')" title="Export as JSON">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Export JSON
                        </button>
                        <button class="btn-story-action" onclick="exportStoryConfig('txt')" title="Export as text">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            Export Text
                        </button>
                        <button class="btn-story-action" onclick="triggerStoryImport()" title="Import story config">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            Import
                        </button>
                    </div>
                    <input type="file" id="story-import-input" accept=".json,.txt" style="display:none" onchange="handleStoryImport(this)">
                </div>
```

## Verification
- Open browser → click Story Mode
- See section labels, empty character list, Add Character button, First Prompt textarea, Use Default pill, and export/import buttons
