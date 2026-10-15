/* ══════════════════════════════════════════════════════════════
   view.js — Hero / chat view toggle
   ══════════════════════════════════════════════════════════════ */

/** Show the hero/landing view, hide chat and clear messages */
function showHeroView() {
  document.getElementById("messages").innerHTML = "";
  document.getElementById("hero-region").classList.remove("hidden");
  document.getElementById("messages").classList.add("hidden");
  document.getElementById("chat-input-bar").classList.add("hidden");
}

/** Show the chat messages and input bar */
function showChatView() {
  document.getElementById("hero-region").classList.add("hidden");
  document.getElementById("messages").classList.remove("hidden");
  document.getElementById("chat-input-bar").classList.remove("hidden");
  // The transcript only has a height once it is displayed, so the image height
  // cap has to be recomputed here rather than at boot.
  if (typeof updateGeneratedImageHeight === "function") {
    updateGeneratedImageHeight();
  }
}
