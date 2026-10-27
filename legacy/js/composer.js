/**
 * composer.js — two-stage composer width
 *
 * The chat composer idles at a comfortable reading width (--chat-composer-min)
 * and widens to the full transcript column only once the text would wrap past
 * one line. That keeps the idle box from spanning a wide desktop window without
 * the per-keystroke reflow a content-sized box would cause.
 *
 * How the decision is made: a hidden mirror span measures the *unwrapped* width
 * of the longest line, which does not depend on the box's current width — so
 * widening the box can never change the measurement and the two widths cannot
 * oscillate. A deadband on the way back down stops text sitting exactly on the
 * boundary from flapping.
 */
(function () {
  "use strict";

  /** Slack (px) the text must fall under before the box narrows again. */
  var HYSTERESIS = 24;

  /** Read a pixel value from a custom property on :root. */
  function cssPx(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var n = parseFloat(raw);
    return isFinite(n) ? n : fallback;
  }

  function initComposerSizing() {
    var bar = document.getElementById("chat-input-bar");
    var input = document.getElementById("chat-input");
    if (!bar || !input) return;
    var box = bar.querySelector(".chat-input-box");
    if (!box) return;

    // Mirror for measuring. `white-space: pre` keeps newlines and trailing
    // spaces significant, so the measurement matches what the textarea holds.
    var mirror = document.createElement("span");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;visibility:hidden;" +
      "white-space:pre;pointer-events:none;";
    document.body.appendChild(mirror);

    var expanded = false;

    /** Width of the widest line in `text`, unwrapped. */
    function widestLine(text) {
      var lines = text.split("\n");
      var widest = 0;
      for (var i = 0; i < lines.length; i++) {
        // A blank line has no width, and an empty span collapses to 0 height.
        mirror.textContent = lines[i] || " ";
        var w = mirror.getBoundingClientRect().width;
        if (w > widest) widest = w;
      }
      return widest;
    }

    /**
     * Fit the textarea to its content, never below one line.
     *
     * `scrollHeight` on an *empty* auto-height textarea reports 0 in Chromium,
     * so a bare `height = scrollHeight` collapses the box and hides the
     * placeholder. The line height is the floor.
     */
    function settleHeight() {
      var cs = getComputedStyle(input);
      var pad =
        parseFloat(cs.paddingTop || 0) + parseFloat(cs.paddingBottom || 0);
      var border =
        parseFloat(cs.borderTopWidth || 0) +
        parseFloat(cs.borderBottomWidth || 0);
      var lineHeight =
        parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 15) * 1.5;

      input.style.height = "auto";
      input.style.height =
        Math.max(input.scrollHeight, lineHeight + pad) + border + "px";
    }

    function sync() {
      var style = getComputedStyle(input);
      // Copy the properties that affect advance width; the `font` shorthand is
      // not reliably populated by getComputedStyle across browsers.
      mirror.style.fontFamily = style.fontFamily;
      mirror.style.fontSize = style.fontSize;
      mirror.style.fontWeight = style.fontWeight;
      mirror.style.fontStyle = style.fontStyle;
      mirror.style.fontStretch = style.fontStretch;
      mirror.style.letterSpacing = style.letterSpacing;

      var barStyle = getComputedStyle(bar);
      var avail =
        bar.clientWidth -
        parseFloat(barStyle.paddingLeft || 0) -
        parseFloat(barStyle.paddingRight || 0);
      // The bar is display:none outside chat view — measuring then would pin
      // the wrong width, so leave the width state alone until it is visible.
      if (!(avail > 0)) {
        settleHeight();
        return;
      }

      var boxStyle = getComputedStyle(box);
      var chrome =
        parseFloat(boxStyle.paddingLeft || 0) +
        parseFloat(boxStyle.paddingRight || 0) +
        parseFloat(boxStyle.borderLeftWidth || 0) +
        parseFloat(boxStyle.borderRightWidth || 0) +
        parseFloat(style.paddingLeft || 0) +
        parseFloat(style.paddingRight || 0);

      var minOuter = Math.min(cssPx("--chat-composer-min", 600), avail);
      var threshold = minOuter - chrome;

      var text = input.value;
      var widest = text.trim() ? widestLine(text) : 0;

      var shouldExpand = expanded
        ? widest > threshold - HYSTERESIS
        : widest > threshold;

      if (shouldExpand !== expanded) {
        expanded = shouldExpand;
        bar.classList.toggle("is-expanded", expanded);
      }

      // Height has to be settled *after* the width, otherwise the text is still
      // wrapped for the old (narrow) box and the composer stays one line too
      // tall. The width animates, so settle again when it comes to rest.
      settleHeight();
    }

    box.addEventListener("transitionend", function (e) {
      if (e.propertyName === "width") settleHeight();
    });

    input.addEventListener("input", sync);
    input.addEventListener("focus", sync);
    // Enter sends and clears the field without dispatching `input`, so re-check
    // on the next frame — likewise for the Send button.
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) requestAnimationFrame(sync);
    });
    var sendBtn = document.getElementById("chat-send-btn");
    if (sendBtn) {
      sendBtn.addEventListener("click", function () {
        requestAnimationFrame(sync);
      });
    }
    window.addEventListener("resize", sync);

    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initComposerSizing);
  } else {
    initComposerSizing();
  }
})();
