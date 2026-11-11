/*
 * Consent, and the Google Analytics that depends on it.
 *
 * One file, loaded by every page, because sixty pages carry the analytics
 * block - seven static ones plus the generated Trifecta archive - and sixty
 * copies of a banner is sixty chances for one of them to say something
 * different from the policy.
 *
 * NOTHING REACHES GOOGLE BEFORE A YES. The consent defaults below are queued
 * into dataLayer, which is a local array and no network at all; gtag.js is
 * only injected once consent has actually been given, this visit or a
 * previous one. Google's own Consent Mode pattern is to load the tag
 * immediately with consent denied and collect cookieless pings - that is
 * defensible and it is what a certified CMP will do here when AdSense
 * arrives, but "a declined visitor is not contacted at all" is the version
 * that needs no argument, and this site can afford it.
 *
 * Cloudflare Web Analytics stays alongside, deliberately. It is cookieless,
 * needs no consent, and so keeps counting for the visitors who say no - which
 * on a banner is most of them. GA is the richer picture of the ones who say
 * yes, not a replacement for the count.
 */
(function () {
  "use strict";

  var GA_ID = "G-74FPWNG390";
  var KEY = "wordcade_consent";          // "granted" | "denied"
  var POLICY = "/privacy.html";

  // Private browsing throws on both of these rather than returning null, and
  // a thrown storage read must not take the page with it.
  function remembered() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(value) {
    try { window.localStorage.setItem(KEY, value); } catch (e) { /* fine */ }
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  // Queued before anything loads, so the tag can never run a moment with
  // storage allowed. All four signals: Consent Mode v2 wants ad_user_data
  // and ad_personalization named even on a site serving no ads, and leaving
  // them out is the usual reason a later AdSense review finds the setup
  // half-wired.
  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
    wait_for_update: 500
  });

  var loaded = false;
  function loadAnalytics() {
    if (loaded) return;
    loaded = true;
    gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    // anonymize_ip is the default in GA4 and cannot be turned off; it is not
    // set here because setting it would imply it were optional.
    gtag("config", GA_ID);
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function decide(value) {
    remember(value);
    var bar = document.getElementById("consent-bar");
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (value === "granted") loadAnalytics();
  }

  function showBanner() {
    var bar = document.createElement("div");
    bar.id = "consent-bar";
    bar.setAttribute("role", "dialog");
    bar.setAttribute("aria-label", "Cookie consent");
    bar.style.cssText = [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483000",
      "box-sizing:border-box", "padding:14px 16px",
      "background:var(--c-panel,#fff)", "color:var(--c-ink,#241f1c)",
      "border-top:1px solid var(--c-line,#ddd6cc)",
      "box-shadow:0 -2px 14px rgba(0,0,0,.10)",
      "font-size:14px", "line-height:1.45", "text-align:center"
    ].join(";");

    var text = document.createElement("div");
    text.style.cssText = "max-width:620px;margin:0 auto 10px";
    text.innerHTML = "Lexathon would like to use Google Analytics to see how people find the game. "
      + "It sets cookies. Counting visits happens either way, without them. "
      + '<a href="' + POLICY + '" style="color:var(--c-correct,#2a6b91)">Privacy Policy</a>';

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px;justify-content:center;flex-wrap:wrap";

    function button(label, value, primary) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = [
        "font:inherit", "font-weight:700", "cursor:pointer",
        "padding:9px 20px", "border-radius:8px", "min-width:116px",
        primary ? "background:var(--c-correct,#2a6b91)" : "background:transparent",
        primary ? "color:var(--c-on-accent,#fff)" : "color:var(--c-ink-3,#5d564f)",
        "border:1px solid var(--c-line,#ddd6cc)"
      ].join(";");
      b.addEventListener("click", function () { decide(value); });
      return b;
    }

    // Decline first in the DOM so it is not the one a thumb lands on by
    // accident, and the same size as Accept: a refusal that is harder to
    // click than a yes is not a choice.
    row.appendChild(button("No thanks", "denied", false));
    row.appendChild(button("Accept", "granted", true));
    bar.appendChild(text);
    bar.appendChild(row);
    document.body.appendChild(bar);
  }

  function start() {
    var choice = remembered();
    if (choice === "granted") { loadAnalytics(); return; }
    if (choice === "denied") return;
    showBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
