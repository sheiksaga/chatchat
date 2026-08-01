/* ══════════════════════════════════════════════════════════════
   dom.js — Centralized DOM ID map

   Every id used by JS must be listed here.  The contract between HTML
   and JS is one readable table; a missing key is a runtime undefined
   at the call site instead of a silent null.
   ══════════════════════════════════════════════════════════════ */

const DOM = {
  /* Sidebar */
  sidebar: "sidebar",
  sidebarChatList: "sidebar-chat-list",
  sidebarToggleBtn: "sidebar-toggle-btn",
  mobileMenuBtn: "mobile-menu-btn",
  btnNewChat: "btn-new-chat",
  btnExportChats: "btn-export-chats",
  btnImportChats: "btn-import-chats",
  btnDeleteAll: "btn-delete-all",
  chatImportInput: "chat-import-input",

  /* Top bar */
  modelSelector: "model-selector",
  currentModelName: "current-model-name",
  imageModelSelector: "image-model-selector",
  currentImageModelName: "current-image-model-name",
  btnEject: "btn-eject",
  configBtn: "config-btn",
  modelDropdown: "model-dropdown",
  imageModelDropdown: "image-model-dropdown",
  configPanel: "config-panel",

  /* Config panel */
  cfgModeRow: "cfg-mode-row",
  cfgPillChat: "cfg-pill-chat",
  cfgPillStory: "cfg-pill-story",
  editStoryBtn: "edit-story-btn",
  providerRowText: "provider-row-text",
  providerDetailText: "provider-detail-text",
  providerRowImage: "provider-row-image",
  providerDetailImage: "provider-detail-image",
  helpBtn: "help-btn",
  sectionImage: "section-image",
  sectionAppearance: "section-appearance",
  sectionReference: "section-reference",

  /* Sliders */
  temperature: "temperature",
  tempValue: "temp-value",
  repetitionPenalty: "repetition-penalty",
  repValue: "rep-value",
  prefWidth: "pref-width",
  prefWidthVal: "pref-width-val",
  prefFont: "pref-font",
  prefFontVal: "pref-font-val",
  prefReset: "pref-reset",
  compressBtn: "compress-btn",

  /* Image settings */
  imageSize: "image-size",
  imageNegativePrompt: "image-negative-prompt",
  imageSteps: "image-steps",
  imageGuidance: "image-guidance",
  imageExplicit: "image-explicit",
  imageStyle: "image-style",
  imageResetCast: "image-reset-cast",

  /* System prompt + story config */
  systemPrompt: "system-prompt",
  storyConfig: "story-config",
  storyScene: "story-scene",
  storyCharactersList: "story-characters-list",
  storyTags: "story-tags",
  storyFirstPrompt: "story-first-prompt",
  btnAddChar: "btn-add-char",
  storyImportInput: "story-import-input",

  /* Story style pills */
  pillChatMode: "pill-chat-mode",
  pillStoryMode: "pill-story-mode",
  pillImageMode: "pill-image-mode",
  stylePillCyoa: "style-pill-cyoa",
  stylePillRoleplay: "style-pill-roleplay",
  stylePillGm: "style-pill-gm",
  storyPovRow: "story-pov-row",
  povPillFirst: "pov-pill-first",
  povPillThird: "pov-pill-third",
  storyDefaultPill: "story-default-pill",
  storyGeneratePill: "story-generate-pill",
  storyDefaultWrapper: "story-default-wrapper",

  /* Story action bar */
  btnExportStoryJson: "btn-export-story-json",
  btnExportStoryTxt: "btn-export-story-txt",
  btnImportStory: "btn-import-story",

  /* Hero */
  heroRegion: "hero-region",
  heroInputBox: "hero-input-box",
  heroInputText: "hero-input-text",
  heroPlaceholder: "hero-placeholder",
  heroSendBtn: "hero-send-btn",
  heroStopBtn: "hero-stop-btn",
  promptChips: "prompt-chips",
  modePills: "mode-pills",

  /* Chat */
  messages: "messages",
  chatInputBar: "chat-input-bar",
  chatInput: "chat-input",
  chatSendBtn: "chat-send-btn",
  chatStopBtn: "chat-stop-btn",

  /* Toast / overlay */
  toastContainer: "toast-container",
  toastTopContainer: "toast-top-container",
  srAnnouncer: "sr-announcer",
  storySettingsOverlay: "story-settings-overlay",
};

/**
 * Shorthand: document.getElementById(DOM[key]).
 * A missing key is a loud undefined rather than a silent null.
 * @param {string} key
 * @returns {HTMLElement|null}
 */
const $ = (key) => document.getElementById(DOM[key]);
