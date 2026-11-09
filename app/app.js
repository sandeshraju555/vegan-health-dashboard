(function () {
  "use strict";

  // WhatsApp number to receive "Suggest a topic" messages (wa.me format: digits
  // only, country code first, no plus sign or spaces).
  var CONFIG = {
    whatsappNumber: "919743755522"
  };

  var KNOWLEDGE_PATHS = ["../knowledge/knowledge.json", "../knowledge/knowledge.sample.json"];
  var BOOKMARK_KEY = "vhd_bookmarks_v1";

  // Feature flag: no real "Where to buy" listings exist yet, so the filter
  // chips and results grid on that sub-page are hidden rather than shown
  // empty/placeholder. Nothing about whereToBuyCardHtml/renderWhereToBuy*
  // or the where-to-buy-filters/where-to-buy-grid markup is removed - flip
  // this to true once real listing data is added and both will render and
  // show again automatically.
  var WHERE_TO_BUY_LISTINGS_ENABLED = false;

  var data = null;
  var byId = { nutrients: {}, foods: {}, healthTopics: {}, lifeStages: {}, myths: {}, herbs: {}, sources: {} };
  var fuse = null;
  var selectedTopics = [];
  var activeFoodFilters = { group: null, origin: null };
  var activeWhereToBuyFilters = { location: null, category: null };
  var foodSortMode = "az";
  // null = "All" (every life stage card shown); otherwise a data.lifeStages[].id.
  // Shared by both #lifestages-grid (Health tab) and #more-lifestages-grid
  // (More > Life stages) - one piece of state, not two independent ones.
  var selectedLifeStageId = null;
  var compareMode = false;
  var compareSelection = [];
  var MAX_COMPARE = 4;
  // Which tab a #/<type>/<id> link's card belongs on - shared by handleHash()
  // (to open the right tab under the card) and closeDetailAndHash()'s
  // no-history fallback (to land somewhere sensible when there's nothing to
  // go back to). A type not listed here (e.g. herb) falls back to "home".
  var TAB_FOR_TYPE = { nutrient: "nutrients", food: "foods", topic: "health", lifestage: "health", myth: "more" };
  // How many hashchange events have fired since this page loaded - see
  // closeDetailAndHash()'s use of it below.
  var inAppHashChangeCount = 0;
  var didYouKnowIndex = Math.floor(Math.random() * 1000); // offset into data.didYouKnow, wrapped with %
  var bookmarks = loadBookmarks();

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------- storage (wrapped, never throws; all personal data stays in this browser) ----------
  function loadJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage unavailable (private browsing, quota, disabled) — fail silently */
    }
  }

  // ---------- theme: light, dark, or follow the phone ----------
  // The actual early application (avoiding a flash of the wrong theme) is a
  // small inline, non-deferred script in index.html's <head> reading the
  // same vhd_theme_v1 key; this is the switch UI and keeps both in sync.
  var THEME_KEY = "vhd_theme_v1";
  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }
  function setTheme(theme) {
    saveJSON(THEME_KEY, theme);
    applyTheme(theme);
    qsa(".theme-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === theme));
    });
  }

  function loadBookmarks() { return loadJSON(BOOKMARK_KEY, []); }
  function saveBookmarks() { saveJSON(BOOKMARK_KEY, bookmarks); }
  function isBookmarked(type, id) {
    return bookmarks.some(function (b) { return b.type === type && b.id === id; });
  }
  function toggleBookmark(type, id, title) {
    var idx = bookmarks.findIndex(function (b) { return b.type === type && b.id === id; });
    if (idx >= 0) { bookmarks.splice(idx, 1); } else { bookmarks.push({ type: type, id: id, title: title }); }
    saveBookmarks();
    renderRecentlyViewed();
  }

  var RECENT_KEY = "vhd_recent_v1";
  function pushRecent(type, id, title) {
    var list = loadJSON(RECENT_KEY, []);
    list = list.filter(function (r) { return !(r.type === type && r.id === id); });
    list.unshift({ type: type, id: id, title: title });
    list = list.slice(0, 6);
    saveJSON(RECENT_KEY, list);
  }
  function loadRecent() { return loadJSON(RECENT_KEY, []); }

  // ---------- recent searches (last 5, tappable chips, clearable) ----------
  var RECENT_SEARCHES_KEY = "vhd_recent_searches_v1";
  function pushRecentSearch(term) {
    term = (term || "").trim();
    if (!term) return;
    var list = loadJSON(RECENT_SEARCHES_KEY, []);
    list = list.filter(function (t) { return t.toLowerCase() !== term.toLowerCase(); });
    list.unshift(term);
    list = list.slice(0, 5);
    saveJSON(RECENT_SEARCHES_KEY, list);
    renderRecentSearches();
  }
  function loadRecentSearches() { return loadJSON(RECENT_SEARCHES_KEY, []); }
  function renderRecentSearches() {
    var box = qs("#recent-searches");
    var list = loadRecentSearches();
    if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = (
      '<span class="recent-searches-label">Recent:</span>' +
      list.map(function (t) { return '<button type="button" class="chip recent-search-chip">' + escapeHtml(t) + "</button>"; }).join("") +
      '<button type="button" class="recent-searches-clear" id="recent-searches-clear-btn">Clear</button>'
    );
    qsa(".recent-search-chip", box).forEach(function (chip) {
      chip.addEventListener("click", function () {
        qs("#search-input").value = chip.textContent;
        renderSearchResults(chip.textContent);
        qs("#search-input").focus();
      });
    });
    qs("#recent-searches-clear-btn").addEventListener("click", function () {
      saveJSON(RECENT_SEARCHES_KEY, []);
      renderRecentSearches();
    });
  }

  // ---------- remember my filters and last tab ----------
  var PREFS_KEY = "vhd_prefs_v1";
  function savePrefs() {
    saveJSON(PREFS_KEY, {
      lastTab: lastTab,
      foodFilters: activeFoodFilters,
      whereToBuyFilters: activeWhereToBuyFilters,
      foodSortMode: foodSortMode,
      selectedTopics: selectedTopics,
      lifeStageTab: selectedLifeStageId
    });
  }
  function loadPrefs() { return loadJSON(PREFS_KEY, null); }

  // ---------- toast (replaces alert() for brief, non-blocking messages) ----------
  var toastTimer = null;
  function showToast(message, ms) {
    var el = qs("#toast");
    el.textContent = message;
    el.hidden = false;
    // Reflow so the opacity transition replays even for back-to-back toasts.
    void el.offsetWidth;
    el.classList.add("show");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.classList.remove("show");
      window.setTimeout(function () { el.hidden = true; }, 220);
    }, ms || 2600);
  }

  // ---------- generic overlay stack, so the phone's Back button closes a
  // dialog instead of leaving the page (non-hash overlays: confirm, welcome).
  // Hash-routed overlays (detail panel, compare) are handled separately in
  // handleHash(), since location.hash assignment already pushes history. ----------
  var overlayCloser = null;
  function pushOverlay(onBack) {
    overlayCloser = onBack;
    try { history.pushState({ vhdOverlay: true }, "", location.href); } catch (err) { /* ignore */ }
  }
  // Closes an overlay that was opened by pushOverlay(), for a programmatic
  // close (a button inside the dialog) rather than the phone's Back button.
  // Deliberately does NOT call history.back() here: that's asynchronous, and
  // racing it against a same-tick follow-up navigation (e.g. handleImportRoute
  // redirecting to #home right after the dialog closes) left the hash
  // bouncing between two states and re-triggering whatever opened the dialog
  // in a loop. The pushed history entry is simply left in place — a later
  // Back press still closes/undoes it correctly, just with one extra no-op
  // step in the rare case where Back is pressed immediately after an
  // in-dialog button in the same spot.
  function popOverlay() {
    overlayCloser = null;
  }
  window.addEventListener("popstate", function () {
    if (overlayCloser) {
      var fn = overlayCloser;
      overlayCloser = null;
      fn();
    }
  });

  // ---------- in-page confirm dialog (replaces confirm()) ----------
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var resolved = false;
      function finish(value) {
        if (resolved) return;
        resolved = true;
        qs("#confirm-overlay").hidden = true;
        qs("#confirm-yes").removeEventListener("click", onYes);
        qs("#confirm-no").removeEventListener("click", onNo);
        resolve(value);
      }
      function onYes() { popOverlay(); finish(true); }
      function onNo() { popOverlay(); finish(false); }
      qs("#confirm-message").textContent = message;
      qs("#confirm-yes").textContent = opts.yesLabel || "Yes";
      qs("#confirm-no").textContent = opts.noLabel || "Keep";
      qs("#confirm-yes").addEventListener("click", onYes);
      qs("#confirm-no").addEventListener("click", onNo);
      qs("#confirm-overlay").hidden = false;
      qs("#confirm-yes").focus();
      pushOverlay(function () { finish(false); });
    });
  }

  // ---------- one-time welcome dialogue (replaces alert(), remembered) ----------
  var WELCOME_SEEN_KEY = "vhd_welcome_seen_v1";
  function showWelcomeDialog() {
    return new Promise(function (resolve) {
      var resolved = false;
      function finish() {
        if (resolved) return;
        resolved = true;
        qs("#welcome-overlay").hidden = true;
        qs("#welcome-gotit").removeEventListener("click", onGotIt);
        saveJSON(WELCOME_SEEN_KEY, true);
        resolve();
      }
      function onGotIt() { popOverlay(); finish(); }
      qs("#welcome-gotit").addEventListener("click", onGotIt);
      qs("#welcome-overlay").hidden = false;
      qs("#welcome-gotit").focus();
      pushOverlay(finish);
    });
  }
  // A shared card link (#/<type>/<id>) opens the detail panel before this
  // ever runs (handleHash() → openDetail(), then init() calls
  // maybeShowWelcome() after), so a first-time recipient arriving that way
  // would otherwise never see this dialog unless they separately found
  // Help/About. Deferred, not dropped: closeDetail() below fires it once
  // the card panel the viewer actually came for is out of the way, rather
  // than stacking a second overlay on top of it immediately.
  var welcomePendingAfterDetail = false;
  function maybeShowWelcome() {
    if (loadJSON(WELCOME_SEEN_KEY, false)) return;
    // Don't stack the welcome dialog on top of another overlay that opened
    // from the same page load (e.g. a first visit that's also an import
    // link, which shows its own confirm dialog) — two modals fighting for
    // attention means the one underneath can't be reached at all. This one
    // case stays a plain skip (not deferred): it's always reopenable from
    // Help/About, and the confirm dialog already resolves on its own timeline.
    var confirmOpen = qs("#confirm-overlay") && !qs("#confirm-overlay").hidden;
    if (confirmOpen) return;
    var detailOpen = qs("#detail-panel") && !qs("#detail-panel").hidden;
    if (detailOpen) { welcomePendingAfterDetail = true; return; }
    showWelcomeDialog();
  }

  // ---------- data loading ----------
  function loadKnowledge(paths) {
    if (!paths.length) return Promise.reject(new Error("No knowledge.json found"));
    return fetch(paths[0], { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("not ok");
      return res.json();
    }).catch(function () {
      return loadKnowledge(paths.slice(1));
    });
  }

  function indexById(list, bucket) {
    (list || []).forEach(function (item) { bucket[item.id] = item; });
  }

  function buildSearchIndex() {
    var docs = [];
    (data.nutrients || []).forEach(function (n) {
      docs.push({ type: "Nutrients", id: n.id, title: n.name, subtitle: "Nutrient", text: firstStatementText(n.whatItDoes), aliases: n.aliases || [], symptomTerms: n.symptomSearchTerms || [] });
    });
    (data.foods || []).forEach(function (f) {
      var localName = defaultLocalName(f);
      docs.push({ type: "Foods", id: f.id, title: f.name, subtitle: f.foodGroup, text: firstStatementText(f.pairingTips), aliases: localName ? [localName] : [] });
    });
    (data.healthTopics || []).forEach(function (t) {
      docs.push({ type: "Health", id: t.id, title: t.name, subtitle: "Health topic", text: firstStatementText(t.whyItMattersForVegans || t.whyItMatters), aliases: [] });
    });
    (data.lifeStages || []).forEach(function (l) {
      docs.push({ type: "Health", id: l.id, title: l.name, subtitle: "Life stage", text: firstStatementText(l.whyItMattersForVegans), aliases: [] });
    });
    (data.myths || []).forEach(function (m) {
      docs.push({ type: "Myths", id: m.id, title: m.claim, subtitle: "Myth — " + m.verdict, text: firstStatementText(m.explanation), aliases: [] });
    });
    (data.herbs || []).forEach(function (h) {
      docs.push({ type: "Herbs", id: h.id, title: h.name, subtitle: "Herb", text: firstStatementText(h.traditionalUse), aliases: h.aliases || [] });
    });
    // Fuse.js loads from a public CDN (BRIEF.md/ARCHITECTURE.md require this,
    // rather than bundling it). If that script didn't load — offline before
    // it was cached, a flaky network, a blocked host — degrade instead of
    // breaking the rest of the page: search silently returns no results
    // (renderSearchResults already handles fuse being null) but everything
    // else still works.
    if (typeof Fuse === "undefined") { fuse = null; return; }
    fuse = new Fuse(docs, {
      keys: ["title", "aliases", "subtitle", "text", "symptomTerms"],
      threshold: 0.38,
      ignoreLocation: true,
      includeMatches: true
    });
  }

  // ---------- rendering helpers ----------
  function evidenceClass(level) {
    if (!level) return "evidence-limited";
    var l = level.toLowerCase();
    if (l === "strong") return "evidence-strong";
    if (l === "moderate") return "evidence-moderate";
    return "evidence-limited";
  }

  function tierBadgeClass(tier) {
    if (tier === "food") return "badge-food";
    if (tier === "planning") return "badge-planning";
    return "badge-supplement";
  }
  function tierLabel(tier) {
    if (tier === "food") return "Easy from food";
    if (tier === "planning") return "Needs planning";
    return "Best from a supplement";
  }

  function cardActionsHtml(type, id, title) {
    var saved = isBookmarked(type, id);
    return (
      '<div class="card-actions">' +
      '<button class="icon-btn save-btn" data-type="' + type + '" data-id="' + id + '" data-title="' + escapeHtml(title) + '" aria-pressed="' + saved + '">' + (saved ? "★ Saved" : "☆ Save") + "</button>" +
      '<button class="icon-btn share-btn" data-type="' + type + '" data-id="' + id + '" aria-expanded="false">🔗 Share</button>' +
      '<button class="icon-btn print-btn" data-type="' + type + '" data-id="' + id + '">🖨 Print</button>' +
      "</div>"
    );
  }

  // What each evidence badge means (BRIEF.md, Evidence rules), shown when tapped.
  var EVIDENCE_EXPLANATIONS = {
    Strong: "Strong evidence: reviews, government or health bodies.",
    Moderate: "Moderate evidence: individual studies or expert books.",
    Limited: "Limited evidence: articles or single reports."
  };

  function evidenceBadgeHtml(level) {
    if (!level) return "";
    var explain = EVIDENCE_EXPLANATIONS[level] || "";
    return (
      '<button type="button" class="evidence-badge ' + evidenceClass(level) + '" data-evidence="' + escapeHtml(level) + '" ' +
      'aria-expanded="false" aria-label="' + escapeHtml(explain || level) + ', tap for what this means">' + escapeHtml(level) + "</button>"
    );
  }

  function readMoreLinkHtml(sourceId) {
    var s = byId.sources[sourceId];
    // BRIEF.md Source and evidence rules 12: only the 8 public reference
    // sources get a tappable link; the 42 cached (copyrighted) documents stay
    // plain text, marked in the schema with linkable: false (and typically a
    // placeholder link value like "your document", never a real URL).
    if (!s || !s.link || s.linkable === false) return "";
    return ' <a class="read-more-link" href="' + escapeHtml(s.link) + '" target="_blank" rel="noopener">Read more at the source ↗</a>';
  }

  // sourceQuality: "unverified" (sources.json) marks sources where no real
  // author/publisher could be confirmed — reuses the existing evidence-badge
  // look rather than introducing a new tag style.
  function unverifiedSourceTagHtml(s) {
    if (!s || s.sourceQuality !== "unverified") return "";
    return ' <span class="evidence-badge evidence-limited">Unverified source</span>';
  }

  function lastCheckedHtml(sourceIds) {
    var dates = (sourceIds || []).map(function (sid) { return byId.sources[sid] && byId.sources[sid].asOf; }).filter(Boolean);
    if (!dates.length) return "";
    dates.sort();
    return '<p class="last-checked">Last checked ' + escapeHtml(dates[dates.length - 1]) + "</p>";
  }

  // A small copy icon beside a sourced point (handled by the delegated
  // .copy-fact-btn listener in bindStaticEvents).
  function copyIconHtml(text) {
    return '<button type="button" class="copy-fact-btn" data-copy-text="' + escapeHtml(text) + '" aria-label="Copy this fact">📋</button>';
  }

  function sourceLineHtml(sourceIds) {
    var parts = (sourceIds || []).map(function (sid) {
      var s = byId.sources[sid];
      if (!s) return "";
      return evidenceBadgeHtml(s.evidenceLevel) + unverifiedSourceTagHtml(s) + readMoreLinkHtml(sid);
    });
    return '<p class="source-line">' + parts.join(" ") + "</p>" + lastCheckedHtml(sourceIds);
  }

  // ---------- labelled statement arrays ----------
  // The current content schema (BRIEF.md Source and evidence rules 2, 4, 13)
  // represents most card fields (whatItDoes, cautions, veganContext, etc.) as
  // an array of { text, label, sourceIds, conflict? } objects, one per
  // distinct sourced statement — never one flat string for the whole field.
  // Older sample content (knowledge.sample.json) still uses a single flat
  // string for some of the same field names, so every helper below accepts
  // either shape without the caller needing to know which one it got.
  var LABEL_CLASS = {
    "established fact": "label-fact",
    "official recommendation": "label-recommendation",
    "illustration": "label-illustration",
    "open question": "label-open"
  };
  // Evidence ordering (BRIEF.md rule 15, first half): established fact and
  // official recommendation sort before open question within one field.
  // Illustration keeps its original position relative to the facts. A
  // stable sort (index tiebreak) means untagged legacy entries never move.
  var LABEL_SORT_RANK = { "established fact": 0, "official recommendation": 0, "illustration": 0, "open question": 1 };
  function labelChipHtml(label) {
    if (!label) return "";
    var cls = LABEL_CLASS[label] || "label-fact";
    return '<span class="entry-label ' + cls + '">' + escapeHtml(label) + "</span>";
  }
  function labelledEntryHtml(entry) {
    if (!entry) return "";
    if (typeof entry === "string") return "<p>" + renderProse(entry) + "</p>";
    var conflict = entry.conflict ? '<p class="entry-conflict">' + renderProse(entry.conflict) + "</p>" : "";
    return (
      "<p>" + labelChipHtml(entry.label) + " " + renderProse(entry.text) + " " + copyIconHtml(entry.text) + "</p>" +
      conflict +
      sourceLineHtml(entry.sourceIds)
    );
  }
  function sortedByLabel(list) {
    return list
      .map(function (item, i) { return { item: item, i: i }; })
      .sort(function (a, b) {
        var ra = (a.item && LABEL_SORT_RANK[a.item.label]) || 0;
        var rb = (b.item && LABEL_SORT_RANK[b.item.label]) || 0;
        return ra !== rb ? ra - rb : a.i - b.i;
      })
      .map(function (x) { return x.item; });
  }
  function labelledListHtml(value) {
    if (!value) return "";
    if (Array.isArray(value)) return sortedByLabel(value).map(labelledEntryHtml).join("");
    return labelledEntryHtml(value);
  }
  // Plain-text teaser for a compact list card (never the detail view): the
  // first statement's text, whichever shape the field is in.
  function firstStatementText(value) {
    if (!value) return "";
    if (Array.isArray(value)) { value = value[0]; }
    if (value && typeof value === "object") return value.text || "";
    return value;
  }
  // A { text, sourceIds } object on its own (samplePlate, whatFoodCannotDo) —
  // the same per-statement shape as one entry of a labelled array, just not
  // wrapped in one, and never carrying a label of its own.
  function textWithSourcesHtml(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return "<p>" + renderProse(obj) + "</p>";
    return "<p>" + renderProse(obj.text) + " " + copyIconHtml(obj.text) + "</p>" + sourceLineHtml(obj.sourceIds);
  }
  // "gaps": an array of plain strings (deliberately unsourced — each one
  // documents something this project could NOT find a source for).
  function gapsHtml(list) {
    if (!list || !list.length) return "";
    return "<ul>" + list.map(function (g) { return "<li>" + renderProse(g) + "</li>"; }).join("") + "</ul>";
  }

  // ---------- Open-question gathering (BRIEF.md rule 15, second half) ----------
  // Every "open question"-labelled entry on a card - wherever among the
  // card's labelled-array fields it lives - renders in one combined section
  // instead of its own field's section: placed after the practical sections
  // and before Known gaps/Sources, with a small top-of-card cue shown only
  // when it will be non-empty. Render order only - the entry's own text,
  // label, sourceIds and conflict are untouched, and nothing is removed from
  // the underlying data. Deliberately not applied to redFlags (the doctor-flag
  // safety banner): a safety warning stays pinned and visible regardless of
  // its evidence label, never swept into a generic evidence-summary section.
  // Non-destructive (returns new arrays) since a card can be rendered more
  // than once - e.g. reopening the same detail panel.
  function splitOpenQuestions(list) {
    if (!Array.isArray(list)) return { rest: list, open: [] };
    var rest = [], open = [];
    list.forEach(function (entry) {
      if (entry && entry.label === "open question") open.push(entry); else rest.push(entry);
    });
    return { rest: rest, open: open };
  }
  function mixedEvidenceBlockHtml(openGroups) {
    var all = [].concat.apply([], openGroups);
    if (!all.length) return "";
    return detailsBlock("Where the evidence is still mixed", all.map(labelledEntryHtml).join(""));
  }
  function mixedEvidenceCueHtml(openGroups) {
    var all = [].concat.apply([], openGroups);
    return all.length ? '<p class="mixed-evidence-cue">Evidence mixed on some points — see &ldquo;Where the evidence is still mixed&rdquo; below.</p>' : "";
  }

  // ---------- Glossary tap ----------
  var glossarySorted = [];
  function buildGlossaryIndex() {
    glossarySorted = (data.glossary || []).slice().sort(function (a, b) { return b.term.length - a.term.length; });
  }
  // Wraps the first mention of each glossary term in escaped prose with a tappable
  // button. Operates on already-escaped text, so it is safe to insert as HTML.
  function renderProse(text) {
    var escaped = escapeHtml(text);
    if (!glossarySorted.length || !escaped) return escaped;
    glossarySorted.forEach(function (g) {
      var term = escapeHtml(g.term);
      var re = new RegExp("\\b(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i");
      if (re.test(escaped)) {
        escaped = escaped.replace(re, '<button type="button" class="glossary-term" data-term="' + g.id + '" aria-expanded="false">$1</button>');
      }
    });
    return escaped;
  }

  function toggleGlossaryTip(btn) {
    var next = btn.nextElementSibling;
    if (next && next.classList && next.classList.contains("glossary-tip")) {
      next.remove();
      btn.setAttribute("aria-expanded", "false");
      return;
    }
    var g = (data.glossary || []).find(function (x) { return x.id === btn.getAttribute("data-term"); });
    if (!g) return;
    var tip = document.createElement("span");
    tip.className = "glossary-tip";
    tip.setAttribute("role", "status");
    tip.textContent = g.definition;
    btn.insertAdjacentElement("afterend", tip);
    btn.setAttribute("aria-expanded", "true");
  }

  function toggleEvidenceTip(btn) {
    var next = btn.nextElementSibling;
    if (next && next.classList && next.classList.contains("evidence-tip")) {
      next.remove();
      btn.setAttribute("aria-expanded", "false");
      return;
    }
    var level = btn.getAttribute("data-evidence");
    var tip = document.createElement("span");
    tip.className = "evidence-tip";
    tip.setAttribute("role", "status");
    tip.textContent = EVIDENCE_EXPLANATIONS[level] || level;
    btn.insertAdjacentElement("afterend", tip);
    btn.setAttribute("aria-expanded", "true");
  }

  // ---------- Why am I seeing this (health-map food suggestions) ----------
  function whyLineHtml(link) {
    return (
      '<div class="why-line"><span class="why-label">Why:</span> ' + renderProse(link.reason) + " " + copyIconHtml(link.reason) + " " +
      evidenceBadgeHtml(link.evidenceGrade) + readMoreLinkHtml(link.sourceId) + "</div>"
    );
  }

  // ---------- What refers to this (backlinks) ----------
  var backlinks = {};
  function addBacklink(targetType, targetId, refType, refId, refTitle) {
    if (!targetId || !refId) return;
    var key = targetType + ":" + targetId;
    backlinks[key] = backlinks[key] || [];
    var exists = backlinks[key].some(function (b) { return b.type === refType && b.id === refId; });
    if (!exists) backlinks[key].push({ type: refType, id: refId, title: refTitle });
  }
  function buildBacklinks() {
    backlinks = {};
    (data.foods || []).forEach(function (f) {
      foodKeyNutrients(f).forEach(function (kn) { addBacklink("nutrient", kn.nutrientId, "food", f.id, f.name); });
    });
    (data.healthTopics || []).forEach(function (t) {
      (t.nutrientIds || []).forEach(function (nid) { addBacklink("nutrient", nid, "topic", t.id, t.name); });
      (t.herbIds || []).forEach(function (hid) { addBacklink("herb", hid, "topic", t.id, t.name); });
      // A topic's own embedded foodsToFavour ({foodId, note}), not only the
      // separate health_food_map.json link table some older topics still use.
      (t.foodsToFavour || []).forEach(function (ft) { addBacklink("food", ft.foodId, "topic", t.id, t.name); });
    });
    (data.lifeStages || []).forEach(function (l) {
      (l.nutrientIds || []).forEach(function (nid) { addBacklink("nutrient", nid, "lifestage", l.id, l.name); });
      (l.herbIds || []).forEach(function (hid) { addBacklink("herb", hid, "lifestage", l.id, l.name); });
      (l.linkedHealthTopics || []).forEach(function (tid) { addBacklink("topic", tid, "lifestage", l.id, l.name); });
      (l.foodsToFavour || []).forEach(function (ft) { addBacklink("food", ft.foodId, "lifestage", l.id, l.name); });
    });
    (data.myths || []).forEach(function (m) {
      (m.nutrientIds || []).forEach(function (nid) { addBacklink("nutrient", nid, "myth", m.id, m.claim); });
      (m.foodIds || []).forEach(function (fid) { addBacklink("food", fid, "myth", m.id, m.claim); });
    });
    (data.healthMap || []).forEach(function (link) {
      var t = byId.healthTopics[link.topicId];
      addBacklink("food", link.foodId, "topic", link.topicId, t ? t.name : link.topicId);
    });
  }
  function referencedByHtml(type, id) {
    var refs = backlinks[type + ":" + id] || [];
    if (!refs.length) return "";
    var chips = refs.map(function (r) {
      return '<button type="button" class="chip ref-chip" data-open-card="' + r.type + ":" + r.id + '">' + escapeHtml(r.title) + "</button>";
    }).join(" ");
    return '<div class="referenced-by"><strong>What refers to this:</strong><br>' + chips + "</div>";
  }

  // ---------- Collapsible depth ----------
  function detailsBlock(summary, bodyHtml, openByDefault) {
    if (!bodyHtml) return "";
    return (
      "<details" + (openByDefault ? " open" : "") + "><summary>" + escapeHtml(summary) + "</summary>" +
      '<div class="details-body">' + bodyHtml + "</div></details>"
    );
  }

  // ---------- Home: three-tier board ----------
  function didYouKnowCardHtml() {
    var facts = data.didYouKnow || [];
    if (!facts.length) return "";
    var f = facts[didYouKnowIndex % facts.length];
    var relatedTitle = f.relatedType && f.relatedId ? titleFor(f.relatedType, f.relatedId) : "";
    var relatedChip = relatedTitle
      ? '<p><button type="button" class="chip" data-open-card="' + f.relatedType + ":" + f.relatedId + '">See ' + escapeHtml(relatedTitle) + "</button></p>"
      : "";
    return (
      '<div class="card" id="did-you-know-card">' +
      "<h3>Did you know?</h3>" +
      "<p>" + renderProse(f.fact) + " " + copyIconHtml(f.fact) + "</p>" +
      "<p>" + evidenceBadgeHtml(f.evidenceGrade) + readMoreLinkHtml((f.sourceIds || [])[0]) + "</p>" +
      relatedChip +
      '<div class="card-actions"><button type="button" class="icon-btn" id="dyk-next-btn">Next ›</button></div>' +
      "</div>"
    );
  }

  function renderHome() {
    ["food", "planning", "supplement"].forEach(function (tier) {
      var grid = qs('[data-tier-grid="' + tier + '"]');
      var items = (data.nutrients || []).filter(function (n) { return n.tier === tier; });
      grid.innerHTML = items.map(function (n) {
        return nutrientCardHtml(n);
      }).join("") || '<p class="no-results">Not covered yet in this sample.</p>';
    });
    renderRecentlyViewed();
  }

  function renderRecentlyViewed() {
    var holder = qs("#recently-viewed");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "recently-viewed";
      var homeView = qs("#view-home");
      homeView.insertBefore(holder, homeView.firstChild.nextSibling);
    }
    var recent = loadRecent();
    var savedCount = bookmarks.length;
    var whatsCovered = data.meta && data.meta.whatsCovered
      ? '<p class="whats-covered">' + escapeHtml(data.meta.whatsCovered) + "</p>"
      : "";
    var startHere = (
      '<div class="card" id="start-here-card">' +
      "<h3>Start here</h3>" +
      "<p>New to a vegan diet? Begin with the three tiers below: what is easy from food, " +
      "what needs a little planning, and what is best covered with a supplement. " +
      'Search above for anything specific — try "B12" or "nachni".</p>' +
      "</div>"
    );
    var recentHtml = "";
    if (recent.length) {
      recentHtml = '<div class="card"><h3>Recently viewed</h3><div class="card-grid">' +
        recent.map(function (r) { return '<button class="icon-btn" style="width:100%;text-align:left;" data-open="' + r.type + ":" + r.id + '">' + escapeHtml(r.title) + "</button>"; }).join("") +
        "</div></div>";
    }
    var savedHtml = savedCount
      ? '<div class="card" id="my-saved-card"><h3>My saved (' + savedCount + ")</h3><div class=\"card-grid\">" +
        bookmarks.map(function (b) { return '<button class="icon-btn" style="width:100%;text-align:left;" data-open="' + b.type + ":" + b.id + '">' + escapeHtml(b.title) + "</button>"; }).join("") +
        "</div>" +
        '<div class="card-actions">' +
        '<button type="button" class="icon-btn" id="export-saved-text-btn">📋 Copy list as text</button>' +
        '<button type="button" class="icon-btn" id="export-saved-file-btn">⬇ Download as file</button>' +
        '<button type="button" class="icon-btn" id="move-saved-link-btn">📱 Get a move-to-another-phone link</button>' +
        '<button type="button" class="icon-btn" id="clear-saved-btn">🗑 Clear my saved list</button>' +
        "</div></div>"
      : "";
    function paint() {
      holder.innerHTML = whatsCovered + didYouKnowCardHtml() + startHere + recentHtml + savedHtml;
      qsa("[data-open-card]", holder).forEach(bindCardOpen);
      var dykNext = qs("#dyk-next-btn", holder);
      if (dykNext) {
        dykNext.addEventListener("click", function () { didYouKnowIndex++; paint(); });
      }
      qsa("[data-open]", holder).forEach(function (btn) {
        btn.addEventListener("click", function () {
          var parts = btn.getAttribute("data-open").split(":");
          location.hash = "#/" + parts[0] + "/" + parts[1];
        });
      });
      if (savedCount) {
        qs("#export-saved-text-btn").addEventListener("click", exportSavedAsText);
        qs("#export-saved-file-btn").addEventListener("click", exportSavedAsFile);
        qs("#move-saved-link-btn").addEventListener("click", copyMoveListLink);
        qs("#clear-saved-btn").addEventListener("click", clearSavedList);
      }
    }
    paint();
  }

  // ---------- export / move / clear my saved list ----------
  function savedListAsText() {
    var lines = ["My saved — Vegan Health Dashboard (" + bookmarks.length + " cards)", ""];
    bookmarks.forEach(function (b) {
      lines.push("- " + b.title + " — " + cardUrl(b.type, b.id));
    });
    lines.push("", "General information, not medical advice.");
    return lines.join("\n");
  }
  function exportSavedAsText() {
    copyTextToClipboard(savedListAsText()).then(function () {
      showToast("Copied " + bookmarks.length + " saved card(s) as text.");
    }).catch(function () {
      showToast("Could not copy automatically — try downloading as a file instead.");
    });
  }
  function exportSavedAsFile() {
    var blob = new Blob([savedListAsText()], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "vegan-health-dashboard-saved.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("Downloaded as a file.");
  }

  function base64UrlEncode(str) {
    var b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function base64UrlDecode(str) {
    var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return decodeURIComponent(escape(atob(b64)));
  }
  function moveListLink() {
    var payload = bookmarks.map(function (b) { return { type: b.type, id: b.id, title: b.title }; });
    return location.origin + location.pathname + "#/import/" + base64UrlEncode(JSON.stringify(payload));
  }
  function copyMoveListLink() {
    var link = moveListLink();
    copyTextToClipboard(link).then(function () {
      showToast("Move link copied — open it on your other phone to add these " + bookmarks.length + " card(s).");
    }).catch(function () { showToast(link); });
  }
  function handleImportRoute(encoded) {
    var list = null;
    try { list = JSON.parse(base64UrlDecode(decodeURIComponent(encoded))); } catch (err) { list = null; }
    if (!Array.isArray(list) || !list.length) {
      try { history.replaceState(null, "", location.pathname + "#home"); } catch (err) { location.hash = "#home"; }
      closeDetail();
      showTab("home");
      return;
    }
    showConfirm(
      "Add " + list.length + " saved card" + (list.length === 1 ? "" : "s") + " from that link to My saved on this phone?",
      { yesLabel: "Add", noLabel: "Cancel" }
    ).then(function (ok) {
      if (ok) {
        var added = 0;
        list.forEach(function (item) {
          if (item && item.type && item.id && !isBookmarked(item.type, item.id)) {
            bookmarks.push({ type: item.type, id: item.id, title: item.title || item.id });
            added++;
          }
        });
        if (added) { saveBookmarks(); }
        showToast(added ? "Added " + added + " card(s) to My saved." : "Nothing new to add — already saved.");
        renderHome();
      }
      // Replace this entry's URL with #home instead of pushing a new one: a
      // pushed #home would leave the #/import/... entry one Back press away,
      // re-triggering this same import (and re-showing the confirm dialog)
      // the moment the viewer presses Back after a successful import.
      try { history.replaceState(null, "", location.pathname + "#home"); } catch (err) { location.hash = "#home"; }
      closeDetail();
      showTab("home");
    });
  }
  function clearSavedList() {
    var count = bookmarks.length;
    showConfirm("Clear my saved list? This removes all " + count + " saved card" + (count === 1 ? "" : "s") + " from this browser.", { yesLabel: "Clear", noLabel: "Keep" })
      .then(function (ok) {
        if (!ok) return;
        bookmarks = [];
        saveBookmarks();
        showToast("Saved list cleared.");
        renderHome();
        renderNutrients();
        renderFoods();
        renderLifeStages();
        renderHerbs();
        renderMyths();
        renderWhereToBuy();
        renderHealthView();
      });
  }

  function nutrientCardHtml(n) {
    return (
      '<article class="card" data-open-card="nutrient:' + n.id + '">' +
      '<span class="badge ' + tierBadgeClass(n.tier) + '">' + tierLabel(n.tier) + "</span>" +
      "<h3>" + escapeHtml(n.name) + "</h3>" +
      "<p>" + renderProse(firstStatementText(n.whatItDoes)) + "</p>" +
      '<p><strong>One action:</strong> ' + renderProse(n.oneLineAction || n.action) + "</p>" +
      cardActionsHtml("nutrient", n.id, n.name) +
      "</article>"
    );
  }

  function renderNutrients() {
    qs("#nutrients-grid").innerHTML = (data.nutrients || []).map(nutrientCardHtml).join("");
  }

  // ---------- Foods ----------
  // Foods have two depths in the current schema (BRIEF.md Completeness rule
  // 5): a "rich" card's amounts are per everyday portion
  // (keyNutrientsPerPortion: amountPerPortion/unit/approxPctAdultRDA); a
  // "basic" card's are per 100 g (keyNutrientsPer100g: amountPer100g/unit,
  // no RDA%). Older sample content used a flatter keyNutrients/note shape.
  function foodKeyNutrients(f) {
    return f.keyNutrientsPerPortion || f.keyNutrients || f.keyNutrientsPer100g || [];
  }
  function keyNutrientAmountText(kn) {
    if (kn.amountPerPortion !== undefined) {
      return kn.amountPerPortion + (kn.unit ? " " + kn.unit : "") +
        (kn.approxPctAdultRDA !== undefined ? " (about " + kn.approxPctAdultRDA + "% of an adult's daily target)" : "") +
        " per portion";
    }
    if (kn.amountPer100g !== undefined) {
      return kn.amountPer100g + (kn.unit ? " " + kn.unit : "") + " per 100 g";
    }
    return kn.note || "";
  }
  // everydayPortion is the current field name; portion is the legacy one.
  function foodPortion(f) { return f.everydayPortion || f.portion || ""; }
  // Local names are per-language (BRIEF.md Local food names rule 6) and only
  // shown once approved for that food in that language. Kannada is the
  // default display language (rule 5) — the per-viewer language switch and
  // per-card tap-to-cycle control are a separate feature, not built here.
  function defaultLocalName(f) { return (f.localNames && f.localNames.kn) || f.localName || ""; }

  function foodCardHtml(f) {
    var nutrientChips = foodKeyNutrients(f).map(function (kn) {
      var n = byId.nutrients[kn.nutrientId];
      return n ? '<span class="badge ' + tierBadgeClass(n.tier) + '">' + escapeHtml(n.name) + "</span>" : "";
    }).join(" ");
    var checked = compareSelection.indexOf(f.id) >= 0;
    var compareControl = (
      '<label class="compare-pick"><input type="checkbox" class="compare-check" data-food-id="' + f.id + '"' +
      (checked ? " checked" : "") + "> Compare</label>"
    );
    var localName = defaultLocalName(f);
    return (
      '<article class="card" data-open-card="food:' + f.id + '">' +
      compareControl +
      "<h3>" + escapeHtml(f.name) + (localName ? " <small>(" + escapeHtml(localName) + ")</small>" : "") + "</h3>" +
      "<p>" + escapeHtml(f.foodGroup) + " · " + escapeHtml(f.indianOrGlobal) + (foodPortion(f) ? " · " + escapeHtml(foodPortion(f)) : "") + "</p>" +
      "<p>" + nutrientChips + "</p>" +
      cardActionsHtml("food", f.id, f.name) +
      "</article>"
    );
  }

  function renderFoodFilters() {
    var groups = Array.from(new Set((data.foods || []).map(function (f) { return f.foodGroup; }))).sort();
    var html = '<button class="chip origin-chip" data-origin="Indian" aria-pressed="false">Indian</button>' +
      '<button class="chip origin-chip" data-origin="Global" aria-pressed="false">Global</button>' +
      groups.map(function (g) { return '<button class="chip group-chip" data-group="' + escapeHtml(g) + '" aria-pressed="false">' + escapeHtml(g) + "</button>"; }).join("");
    qs("#food-filters").innerHTML = html;
    qsa(".origin-chip", qs("#food-filters")).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-origin");
        activeFoodFilters.origin = activeFoodFilters.origin === v ? null : v;
        renderFoodFilters();
        renderFoods();
      });
    });
    qsa(".group-chip", qs("#food-filters")).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-group");
        activeFoodFilters.group = activeFoodFilters.group === v ? null : v;
        renderFoodFilters();
        renderFoods();
      });
    });
    if (activeFoodFilters.origin) qs('.origin-chip[data-origin="' + activeFoodFilters.origin + '"]').setAttribute("aria-pressed", "true");
    if (activeFoodFilters.group) qs('.group-chip[data-group="' + activeFoodFilters.group + '"]').setAttribute("aria-pressed", "true");
  }

  function sortFoods(items) {
    var sorted = items.slice();
    if (foodSortMode === "indian-first") {
      sorted.sort(function (a, b) {
        if (a.indianOrGlobal !== b.indianOrGlobal) return a.indianOrGlobal === "Indian" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } else if (foodSortMode.indexOf("nutrient:") === 0) {
      var nutrientId = foodSortMode.slice("nutrient:".length);
      var nutrientAmountFor = function (f) {
        var kn = foodKeyNutrients(f).find(function (x) { return x.nutrientId === nutrientId; });
        if (!kn) return null;
        var raw = kn.amountPerPortion !== undefined ? kn.amountPerPortion : kn.amountPer100g;
        if (raw === undefined) return null;
        var match = String(raw).match(/-?\d*\.?\d+/);
        return match ? parseFloat(match[0]) : null;
      };
      sorted.sort(function (a, b) {
        var aAmount = nutrientAmountFor(a);
        var bAmount = nutrientAmountFor(b);
        var aHas = aAmount !== null;
        var bHas = bAmount !== null;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas && aAmount !== bAmount) return bAmount - aAmount;
        return a.name.localeCompare(b.name);
      });
    } else {
      sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
    }
    return sorted;
  }

  // One-time explainer for the Rank-by/Compare naming, shown under the
  // toolbar until the viewer actually uses either control once, then never
  // again - own localStorage key, not sharing WHATS_NEW_SEEN_KEY/
  // SHARE_TIP_SEEN_KEY/foodSortMode or any other existing one.
  var FOODS_TOOLBAR_TIP_SEEN_KEY = "vhd_foods_toolbar_tip_seen_v1";
  function showFoodsToolbarTipIfNew() {
    var tip = qs("#foods-toolbar-tip");
    if (tip && !loadJSON(FOODS_TOOLBAR_TIP_SEEN_KEY, false)) tip.hidden = false;
  }
  function dismissFoodsToolbarTip() {
    var tip = qs("#foods-toolbar-tip");
    if (tip && !tip.hidden) {
      tip.hidden = true;
      saveJSON(FOODS_TOOLBAR_TIP_SEEN_KEY, true);
    }
  }

  function renderSortOptions() {
    var select = qs("#food-sort");
    var extra = (data.nutrients || []).map(function (n) {
      return '<option value="nutrient:' + n.id + '">Rank by: ' + escapeHtml(n.name) + "</option>";
    }).join("");
    select.insertAdjacentHTML("beforeend", extra);
    select.value = foodSortMode;
    select.addEventListener("change", function () {
      foodSortMode = select.value;
      dismissFoodsToolbarTip();
      renderFoods();
    });
    showFoodsToolbarTipIfNew();
  }

  // Natural combined description of whichever food filter chip(s) are
  // active right now (origin and/or group - the only two activeFoodFilters
  // keys) e.g. "Fermented foods", "Indian Spices, herbs and condiments"
  // when both are on at once. Group names are already nouns ("Fermented
  // foods", "Fruits"), but origin alone ("Indian"/"Global") is a bare
  // adjective, so "foods" is appended only when there's no group to
  // supply one. Empty string when neither is active.
  function activeFoodFilterLabel() {
    if (activeFoodFilters.origin && activeFoodFilters.group) {
      return activeFoodFilters.origin + " " + activeFoodFilters.group;
    }
    if (activeFoodFilters.group) return activeFoodFilters.group;
    if (activeFoodFilters.origin) return activeFoodFilters.origin + " foods";
    return "";
  }

  // "Compare these N X" nudge above the grid: only when a filter is active
  // AND it narrows the grid to 2+ foods (so there's something real to
  // compare), and not while already in Compare mode (the compare bar at
  // the bottom already covers that case). One tap turns Compare mode on
  // via the existing toggleCompareMode()/MAX_COMPARE mechanism - it does
  // not build a second comparison path or auto-pick foods, it just leaves
  // the already-filtered grid's checkboxes available to pick from.
  function renderCompareNudge(filteredCount) {
    var nudge = qs("#compare-nudge");
    var label = activeFoodFilterLabel();
    if (compareMode || !label || filteredCount < 2) {
      nudge.hidden = true;
      nudge.textContent = "";
      return;
    }
    nudge.hidden = false;
    nudge.textContent = "Compare these " + filteredCount + " " + label + " →";
  }

  // Shared by renderFoods() and the "Pick foods to compare" picker, so the
  // picker's default (no-search) list always matches the same active
  // origin/group chips as the main grid instead of drifting out of sync.
  function filteredFoods() {
    return (data.foods || []).filter(function (f) {
      if (activeFoodFilters.origin && f.indianOrGlobal !== activeFoodFilters.origin) return false;
      if (activeFoodFilters.group && f.foodGroup !== activeFoodFilters.group) return false;
      return true;
    });
  }

  function renderFoods() {
    var items = sortFoods(filteredFoods());
    var grid = qs("#foods-grid");
    grid.classList.toggle("compare-mode", compareMode);
    grid.innerHTML = items.map(foodCardHtml).join("") || '<p class="no-results">No foods match these filters yet.</p>';
    qsa(".compare-check", grid).forEach(function (cb) {
      cb.addEventListener("change", function () { onCompareCheck(cb); });
    });
    renderCompareNudge(items.length);
    savePrefs();
  }

  // ---------- Compare foods ----------
  function onCompareCheck(cb) {
    var id = cb.getAttribute("data-food-id");
    if (cb.checked) {
      if (compareSelection.length >= MAX_COMPARE) {
        cb.checked = false;
        announce("You can compare up to " + MAX_COMPARE + " foods at a time.");
        return;
      }
      compareSelection.push(id);
    } else {
      compareSelection = compareSelection.filter(function (x) { return x !== id; });
    }
    updateCompareBar();
  }

  function updateCompareBar() {
    var bar = qs("#compare-bar");
    bar.hidden = !compareMode;
    qs("#compare-count").textContent = compareSelection.length + " selected (2 to " + MAX_COMPARE + ")";
    qs("#compare-view-btn").disabled = compareSelection.length < 2;
  }

  // A compact search + checklist alternative to scrolling the whole grid to
  // find and tick foods (Baymard Institute: "severe difficulties selecting
  // items to compare on a product list"). Reuses compareSelection/
  // onCompareCheck()/MAX_COMPARE/announce() as-is, same as a food card's own
  // checkbox - no separate selection mechanism. With an empty search box it
  // defaults to the page's active origin/group filter scope (filteredFoods()),
  // same as the main grid; typing a query searches every food regardless of
  // that scope, so the active filter chip never hard-locks what's reachable.
  function renderComparePickerList() {
    var query = qs("#compare-picker-search").value.trim().toLowerCase();
    var pool = query ? (data.foods || []) : filteredFoods();
    var items = (query
      ? pool.filter(function (f) { return f.name.toLowerCase().indexOf(query) >= 0; })
      : pool.slice()
    ).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var note = qs("#compare-picker-scope-note");
    var scopeLabel = activeFoodFilterLabel();
    if (!query && scopeLabel) {
      note.hidden = false;
      note.textContent = "Showing " + scopeLabel + " — search to pick from every food.";
    } else {
      note.hidden = true;
    }

    var list = qs("#compare-picker-list");
    list.innerHTML = items.length ? items.map(function (f) {
      var checked = compareSelection.indexOf(f.id) >= 0;
      return (
        '<li><label class="compare-pick"><input type="checkbox" class="compare-check" data-food-id="' + f.id + '"' +
        (checked ? " checked" : "") + "> " + escapeHtml(f.name) +
        " <small>" + escapeHtml(f.foodGroup) + "</small></label></li>"
      );
    }).join("") : '<li class="no-results">No foods match.</li>';
    qsa(".compare-check", list).forEach(function (cb) {
      cb.addEventListener("change", function () {
        onCompareCheck(cb);
        // Re-render the main grid too, so its own checkboxes and the sticky
        // compare bar's count stay correct once the picker closes - cheap
        // enough since this only runs on a checkbox toggle, not per keystroke.
        renderFoods();
      });
    });
  }

  function openComparePicker() {
    dismissFoodsToolbarTip();
    qs("#compare-picker-search").value = "";
    renderComparePickerList();
    qs("#compare-picker-overlay").hidden = false;
    qs("#compare-picker-search").focus();
    pushOverlay(closeComparePicker);
  }

  function closeComparePicker() {
    qs("#compare-picker-overlay").hidden = true;
  }

  function toggleCompareMode() {
    dismissFoodsToolbarTip();
    compareMode = !compareMode;
    if (!compareMode) { compareSelection = []; }
    updateCompareBar();
    renderFoods();
  }

  // Reads the same foodKeyNutrients()/keyNutrientAmountText() helpers used
  // everywhere else foods render (see the comment above foodKeyNutrients),
  // so a "rich" food's keyNutrientsPerPortion and a "basic" food's
  // keyNutrientsPer100g are both handled correctly side by side in one
  // table - never the older flat keyNutrients/note shape. Every cell is
  // built so a food with no data for a given row shows "—", never a blank
  // cell or "undefined", and foods.length < 2 (0 or 1 picked) short-
  // circuits before building any table at all.
  function compareTableHtml() {
    var foods = compareSelection.map(function (id) { return byId.foods[id]; }).filter(Boolean);
    if (foods.length < 2) return '<p class="no-results">Pick at least 2 foods to compare.</p>';
    var nutrientIds = [];
    foods.forEach(function (f) {
      foodKeyNutrients(f).forEach(function (kn) {
        if (nutrientIds.indexOf(kn.nutrientId) === -1) nutrientIds.push(kn.nutrientId);
      });
    });
    var headRow = "<tr><th>Nutrient</th>" + foods.map(function (f) { return "<th>" + escapeHtml(f.name) + "</th>"; }).join("") + "</tr>";
    var rows = nutrientIds.length ? nutrientIds.map(function (nid) {
      var n = byId.nutrients[nid];
      var cells = foods.map(function (f) {
        var kn = foodKeyNutrients(f).find(function (x) { return x.nutrientId === nid; });
        return "<td>" + (kn ? renderProse(keyNutrientAmountText(kn)) : "—") + "</td>";
      }).join("");
      return "<tr><th>" + escapeHtml(n ? n.name : nid) + "</th>" + cells + "</tr>";
    }).join("") : (
      '<tr><td colspan="' + (foods.length + 1) + '">No nutrient data recorded yet for these foods.</td></tr>'
    );
    var portionRow = "<tr><th>Portion</th>" + foods.map(function (f) { return "<td>" + (foodPortion(f) ? escapeHtml(foodPortion(f)) : "—") + "</td>"; }).join("") + "</tr>";
    var groupRow = "<tr><th>Food group</th>" + foods.map(function (f) { return "<td>" + escapeHtml(f.foodGroup) + " · " + escapeHtml(f.indianOrGlobal) + "</td>"; }).join("") + "</tr>";
    return (
      '<div class="compare-table-wrap"><table class="compare-table">' +
      "<thead>" + headRow + "</thead><tbody>" + groupRow + portionRow + rows + "</tbody>" +
      "</table></div>"
    );
  }

  function openCompareView() {
    qs("#detail-body").innerHTML = "<div class=\"card\"><h2>Compare foods</h2>" + compareTableHtml() + "</div>";
    qs("#detail-panel").hidden = false;
  }

  // ---------- Where to buy ----------
  function whereToBuyCardHtml(w) {
    return (
      '<article class="card">' +
      "<h3>" + escapeHtml(w.name) + "</h3>" +
      "<p>" + escapeHtml(w.category) + " · " + escapeHtml(w.location) + "</p>" +
      "<p>" + escapeHtml(w.itemsCarried) + "</p>" +
      "<p><small>Listed " + escapeHtml(w.asOf) + "</small></p>" +
      '<div class="card-actions"><a class="icon-btn" href="' + escapeHtml(w.link) + '" target="_blank" rel="noopener">↗ Visit</a></div>' +
      "</article>"
    );
  }

  function renderWhereToBuyFilters() {
    var categories = Array.from(new Set((data.whereToBuy || []).map(function (w) { return w.category; }))).sort();
    var html = '<button class="chip wtb-location-chip" data-location="In Bengaluru" aria-pressed="false">In Bengaluru</button>' +
      '<button class="chip wtb-location-chip" data-location="Online to Bengaluru" aria-pressed="false">Online to Bengaluru</button>' +
      categories.map(function (c) { return '<button class="chip wtb-category-chip" data-category="' + escapeHtml(c) + '" aria-pressed="false">' + escapeHtml(c) + "</button>"; }).join("");
    qs("#where-to-buy-filters").innerHTML = html;
    qsa(".wtb-location-chip", qs("#where-to-buy-filters")).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-location");
        activeWhereToBuyFilters.location = activeWhereToBuyFilters.location === v ? null : v;
        renderWhereToBuyFilters();
        renderWhereToBuy();
      });
    });
    qsa(".wtb-category-chip", qs("#where-to-buy-filters")).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-category");
        activeWhereToBuyFilters.category = activeWhereToBuyFilters.category === v ? null : v;
        renderWhereToBuyFilters();
        renderWhereToBuy();
      });
    });
    if (activeWhereToBuyFilters.location) qs('.wtb-location-chip[data-location="' + activeWhereToBuyFilters.location + '"]').setAttribute("aria-pressed", "true");
    if (activeWhereToBuyFilters.category) qs('.wtb-category-chip[data-category="' + activeWhereToBuyFilters.category + '"]').setAttribute("aria-pressed", "true");
  }

  function renderWhereToBuy() {
    var items = (data.whereToBuy || []).filter(function (w) {
      if (activeWhereToBuyFilters.location && w.location !== activeWhereToBuyFilters.location) return false;
      if (activeWhereToBuyFilters.category && w.category !== activeWhereToBuyFilters.category) return false;
      return true;
    });
    qs("#where-to-buy-grid").innerHTML = items.map(whereToBuyCardHtml).join("") || '<p class="no-results">No listings match these filters yet.</p>';
    savePrefs();
  }

  // ---------- Health map ----------
  function topicFoodLinks(topicId, relation) {
    return (data.healthMap || []).filter(function (m) { return m.topicId === topicId && m.relation === relation; });
  }

  function renderTopicPicker() {
    var html = (data.healthTopics || []).map(function (t) {
      var pressed = selectedTopics.indexOf(t.id) >= 0;
      return '<button class="chip topic-chip" data-topic="' + t.id + '" aria-pressed="' + pressed + '">' + escapeHtml(t.name) + "</button>";
    }).join("");
    qs("#topic-picker").innerHTML = html;
    qsa(".topic-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var id = chip.getAttribute("data-topic");
        var idx = selectedTopics.indexOf(id);
        if (idx >= 0) {
          selectedTopics.splice(idx, 1);
        } else if (selectedTopics.length < 3) {
          selectedTopics.push(id);
        }
        renderTopicPicker();
        renderHealthView();
      });
    });
  }

  // Chips linking to other cards by id (used for a herb's linked health
  // topics, and a topic's related herbs — both are plain arrays of ids).
  function idChipsHtml(type, ids, lookup) {
    if (!ids || !ids.length) return "";
    return ids.map(function (id) {
      var item = lookup[id];
      return '<button type="button" class="chip" data-open-card="' + type + ":" + id + '">' + escapeHtml(item ? item.name : id) + "</button>";
    }).join(" ");
  }
  function herbChipsHtml(herbIds) { return idChipsHtml("herb", herbIds, byId.herbs || {}); }
  function topicChipsHtml(topicIds) { return idChipsHtml("topic", topicIds, byId.healthTopics); }

  function topicCardHtml(t) {
    var favourLinks = topicFoodLinks(t.id, "supports");
    var watchLinks = topicFoodLinks(t.id, "watch");
    var favourHtml = favourLinks.map(function (l) {
      var f = byId.foods[l.foodId];
      return '<li><button class="icon-btn" data-open-card="food:' + l.foodId + '">' + escapeHtml(f ? f.name : l.foodId) + "</button>" + whyLineHtml(l) + "</li>";
    }).join("");
    // A topic's own embedded foodsToFavour ({foodId, note}) — simpler than a
    // health_food_map.json row (no evidence grade/sourceId of its own); every
    // topic built after that separate link table was simplified uses this.
    favourHtml += (t.foodsToFavour || []).map(function (ft) {
      var f = byId.foods[ft.foodId];
      var note = ft.note ? ' <span class="favour-note">' + renderProse(ft.note) + "</span>" : "";
      return '<li><button class="icon-btn" data-open-card="food:' + ft.foodId + '">' + escapeHtml(f ? f.name : ft.foodId) + "</button>" + note + "</li>";
    }).join("");
    var watchHtml = watchLinks.map(function (l) {
      var f = byId.foods[l.foodId];
      return '<li><button class="icon-btn" data-open-card="food:' + l.foodId + '">' + escapeHtml(f ? f.name : l.foodId) + "</button>" + whyLineHtml(l) + "</li>";
    }).join("");
    // pairings is an object keyed by kind (absorption, protein, ...), each a
    // labelled-entry array — not one flat string.
    var openGroups = [];
    var topicWim = splitOpenQuestions(t.whyItMattersForVegans || t.whyItMatters); openGroups.push(topicWim.open);
    var topicWtf = splitOpenQuestions(t.whatToFocusOn); openGroups.push(topicWtf.open);
    var topicFohw = splitOpenQuestions(t.foodsOrHabitsToWatch); openGroups.push(topicFohw.open);
    var topicPrep = splitOpenQuestions(t.preparation); openGroups.push(topicPrep.open);
    var topicAas = splitOpenQuestions(t.allergensAndSensitivities); openGroups.push(topicAas.open);
    var topicTwc = splitOpenQuestions(t.testsWorthConsidering); openGroups.push(topicTwc.open);
    var topicLl = splitOpenQuestions(t.lifestyleLinks); openGroups.push(topicLl.open);
    var pairingsHtml = "";
    if (t.pairings && typeof t.pairings === "object") {
      pairingsHtml = Object.keys(t.pairings).map(function (k) {
        var pairingSplit = splitOpenQuestions(t.pairings[k]);
        openGroups.push(pairingSplit.open);
        return "<p><strong>" + escapeHtml(k.charAt(0).toUpperCase() + k.slice(1)) + ":</strong></p>" + labelledListHtml(pairingSplit.rest);
      }).join("");
    } else if (t.pairings) {
      pairingsHtml = "<p>" + renderProse(t.pairings) + "</p>";
    }
    return (
      '<article class="card" data-open-card="topic:' + t.id + '">' +
      "<h3>" + escapeHtml(t.name) + "</h3>" +
      mixedEvidenceCueHtml(openGroups) +
      labelledListHtml(topicWim.rest) +
      "<p><strong>Focus on:</strong></p>" + labelledListHtml(topicWtf.rest) +
      "<p><strong>Foods to favour:</strong></p><ul>" + (favourHtml || "<li>Not covered yet.</li>") + "</ul>" +
      (watchHtml ? "<p><strong>Foods to watch:</strong></p><ul>" + watchHtml + "</ul>" : "") +
      detailsBlock("Foods and habits to watch", labelledListHtml(topicFohw.rest)) +
      (t.redFlags ? '<div class="doctor-flag">' + labelledListHtml(t.redFlags) + "</div>" : "") +
      detailsBlock("Pairings", pairingsHtml) +
      detailsBlock("Preparation", labelledListHtml(topicPrep.rest)) +
      detailsBlock("Allergens and sensitivities", labelledListHtml(topicAas.rest)) +
      detailsBlock("Tests worth considering", labelledListHtml(topicTwc.rest)) +
      detailsBlock("Sample plate", textWithSourcesHtml(t.samplePlate)) +
      detailsBlock("Lifestyle links", labelledListHtml(topicLl.rest)) +
      detailsBlock("What food cannot do", textWithSourcesHtml(t.whatFoodCannotDo)) +
      (t.herbIds && t.herbIds.length ? "<p><strong>Related herb" + (t.herbIds.length > 1 ? "s" : "") + ":</strong> " + herbChipsHtml(t.herbIds) + "</p>" : "") +
      mixedEvidenceBlockHtml(openGroups) +
      detailsBlock("Sources", sourceLineHtml(t.sourceIds)) +
      referencedByHtml("topic", t.id) +
      cardActionsHtml("topic", t.id, t.name) +
      "</article>"
    );
  }

  function renderHealthView() {
    var singleHolder = qs("#health-single");
    var combineHolder = qs("#health-combine");
    if (selectedTopics.length === 0) {
      singleHolder.hidden = false;
      combineHolder.hidden = true;
      singleHolder.innerHTML = (data.healthTopics || []).map(function (t) {
        return '<article class="card"><h3>' + escapeHtml(t.name) + '</h3><p>' + renderProse(firstStatementText(t.whyItMattersForVegans || t.whyItMatters)) +
          '</p><button class="icon-btn" data-select-topic="' + t.id + '">View this topic</button></article>';
      }).join("");
      qsa("[data-select-topic]", singleHolder).forEach(function (btn) {
        btn.addEventListener("click", function () {
          selectedTopics = [btn.getAttribute("data-select-topic")];
          renderTopicPicker();
          renderHealthView();
        });
      });
    } else if (selectedTopics.length === 1) {
      singleHolder.hidden = false;
      combineHolder.hidden = true;
      var t = byId.healthTopics[selectedTopics[0]];
      singleHolder.innerHTML = t ? topicCardHtml(t) : "";
    } else {
      singleHolder.hidden = true;
      combineHolder.hidden = false;
      renderCombineView();
    }
    qsa("[data-open-card]").forEach(bindCardOpen);
    savePrefs();
  }

  function renderCombineView() {
    var topicSets = selectedTopics.map(function (id) {
      var supports = topicFoodLinks(id, "supports").map(function (l) { return l.foodId; });
      return new Set(supports);
    });
    var common = Array.from(topicSets[0]).filter(function (foodId) {
      return topicSets.every(function (s) { return s.has(foodId); });
    });

    var conflicts = [];
    selectedTopics.forEach(function (topicA) {
      topicFoodLinks(topicA, "watch").forEach(function (watchLink) {
        selectedTopics.forEach(function (topicB) {
          if (topicB === topicA) return;
          var supportsB = topicFoodLinks(topicB, "supports").some(function (l) { return l.foodId === watchLink.foodId; });
          if (supportsB) {
            conflicts.push({ foodId: watchLink.foodId, watchTopic: topicA, supportTopic: topicB, reason: watchLink.reason });
          }
        });
      });
    });

    var names = selectedTopics.map(function (id) { return byId.healthTopics[id] ? byId.healthTopics[id].name : id; });
    var html = "<article class=\"card\"><h3>Foods that help " + names.map(escapeHtml).join(" + ") + "</h3>";
    if (common.length) {
      html += '<ul>' + common.map(function (foodId) {
        var f = byId.foods[foodId];
        var whyAll = selectedTopics.map(function (topicId) {
          var link = topicFoodLinks(topicId, "supports").find(function (l) { return l.foodId === foodId; });
          var topicName = byId.healthTopics[topicId] ? byId.healthTopics[topicId].name : topicId;
          return link ? '<div class="why-line"><span class="why-label">Why (' + escapeHtml(topicName) + "):</span> " + renderProse(link.reason) + " " + evidenceBadgeHtml(link.evidenceGrade) + readMoreLinkHtml(link.sourceId) + "</div>" : "";
        }).join("");
        return '<li><button class="icon-btn" data-open-card="food:' + foodId + '">' + escapeHtml(f ? f.name : foodId) + "</button>" + whyAll + "</li>";
      }).join("") + "</ul>";
    } else {
      html += '<p class="no-results">No single food in this sample supports all of these topics yet.</p>';
    }
    if (conflicts.length) {
      html += '<h4>Conflicts flagged</h4><ul>' + conflicts.map(function (c) {
        var f = byId.foods[c.foodId];
        return "<li>" + escapeHtml(f ? f.name : c.foodId) + " — " + escapeHtml(c.reason) + " (watch for " + escapeHtml(byId.healthTopics[c.watchTopic].name) + ")</li>";
      }).join("") + "</ul>";
    }
    html += '<p class="doctor-flag">Talk to your doctor before changing your diet for more than one condition at once, especially if you take medicines.</p>';
    html += "</article>";
    qs("#health-combine").innerHTML = html;
  }

  function lifeStageChipsHtml(lifeStageIds) { return idChipsHtml("lifestage", lifeStageIds, byId.lifeStages || {}); }

  function lifeStageCardHtml(l) {
    // Life stage cards use the same rich schema as health topics (see
    // topicCardHtml) - not the older flat group/whatChanges/extraNeeds shape.
    var favourHtml = (l.foodsToFavour || []).map(function (ft) {
      var f = byId.foods[ft.foodId];
      var note = ft.note ? ' <span class="favour-note">' + renderProse(ft.note) + "</span>" : "";
      return '<li><button class="icon-btn" data-open-card="food:' + ft.foodId + '">' + escapeHtml(f ? f.name : ft.foodId) + "</button>" + note + "</li>";
    }).join("");
    var openGroups = [];
    var lsWim = splitOpenQuestions(l.whyItMattersForVegans); openGroups.push(lsWim.open);
    var lsWtf = splitOpenQuestions(l.whatToFocusOn); openGroups.push(lsWtf.open);
    var lsFohw = splitOpenQuestions(l.foodsOrHabitsToWatch); openGroups.push(lsFohw.open);
    var lsPrep = splitOpenQuestions(l.preparation); openGroups.push(lsPrep.open);
    var lsAas = splitOpenQuestions(l.allergensAndSensitivities); openGroups.push(lsAas.open);
    var lsTwc = splitOpenQuestions(l.testsWorthConsidering); openGroups.push(lsTwc.open);
    var lsLl = splitOpenQuestions(l.lifestyleLinks); openGroups.push(lsLl.open);
    var pairingsHtml = "";
    if (l.pairings && typeof l.pairings === "object") {
      pairingsHtml = Object.keys(l.pairings).map(function (k) {
        var pairingSplit = splitOpenQuestions(l.pairings[k]);
        openGroups.push(pairingSplit.open);
        return "<p><strong>" + escapeHtml(k.charAt(0).toUpperCase() + k.slice(1)) + ":</strong></p>" + labelledListHtml(pairingSplit.rest);
      }).join("");
    }
    return (
      '<article class="card" data-open-card="lifestage:' + l.id + '">' +
      "<h3>" + escapeHtml(l.name) + "</h3>" +
      mixedEvidenceCueHtml(openGroups) +
      labelledListHtml(lsWim.rest) +
      "<p><strong>Focus on:</strong></p>" + labelledListHtml(lsWtf.rest) +
      "<p><strong>Foods to favour:</strong></p><ul>" + (favourHtml || "<li>Not covered yet.</li>") + "</ul>" +
      detailsBlock("Foods and habits to watch", labelledListHtml(lsFohw.rest)) +
      (l.redFlags && l.redFlags.length ? '<div class="doctor-flag">' + labelledListHtml(l.redFlags) + "</div>" : "") +
      detailsBlock("Pairings", pairingsHtml) +
      detailsBlock("Preparation", labelledListHtml(lsPrep.rest)) +
      detailsBlock("Allergens and sensitivities", labelledListHtml(lsAas.rest)) +
      detailsBlock("Tests worth considering", labelledListHtml(lsTwc.rest)) +
      detailsBlock("Sample plate", textWithSourcesHtml(l.samplePlate)) +
      detailsBlock("Lifestyle links", labelledListHtml(lsLl.rest)) +
      detailsBlock("What food cannot do", textWithSourcesHtml(l.whatFoodCannotDo)) +
      (l.linkedHealthTopics && l.linkedHealthTopics.length ? "<p><strong>Related health topic" + (l.linkedHealthTopics.length > 1 ? "s" : "") + ":</strong> " + topicChipsHtml(l.linkedHealthTopics) + "</p>" : "") +
      (l.herbIds && l.herbIds.length ? "<p><strong>Related herb" + (l.herbIds.length > 1 ? "s" : "") + ":</strong> " + herbChipsHtml(l.herbIds) + "</p>" : "") +
      mixedEvidenceBlockHtml(openGroups) +
      detailsBlock("Sources", sourceLineHtml(l.sourceIds)) +
      referencedByHtml("lifestage", l.id) +
      cardActionsHtml("lifestage", l.id, l.name) +
      "</article>"
    );
  }

  // "Jump to a life stage" tab chips above both life-stage grids. Pure JS
  // show/hide of the already-rendered cards (same as the Foods origin/group
  // filter chips) - deliberately NOT a location.hash route, so the router's
  // own #/lifestage/<id> deep-link/modal mechanism (used from search results
  // and related-topic chips) stays completely untouched and still opens
  // correctly regardless of which tab is selected. One shared
  // selectedLifeStageId, not two independent ones - picking a stage in
  // either location re-renders both chip rows and both grids' visibility.
  function lifeStageTabRowHtml() {
    var chips = '<button type="button" class="chip lifestage-tab-chip" data-lifestage="all" aria-pressed="' +
      (selectedLifeStageId === null) + '">All</button>';
    (data.lifeStages || []).forEach(function (l) {
      chips += '<button type="button" class="chip lifestage-tab-chip" data-lifestage="' + escapeHtml(l.id) +
        '" aria-pressed="' + (selectedLifeStageId === l.id) + '">' + escapeHtml(l.name) + "</button>";
    });
    return chips;
  }

  function applyLifeStageVisibility() {
    ["#lifestages-grid", "#more-lifestages-grid"].forEach(function (sel) {
      var grid = qs(sel);
      if (!grid) return;
      qsa('[data-open-card^="lifestage:"]', grid).forEach(function (card) {
        var id = card.getAttribute("data-open-card").split(":")[1];
        card.hidden = !(selectedLifeStageId === null || selectedLifeStageId === id);
      });
    });
  }

  // Scrolls the just-picked stage's card into view from its top, in
  // whichever of the two grids the chip was actually clicked in (the other
  // grid may be on a currently-hidden tab, so there's nothing useful to
  // scroll there). Only on picking a specific stage - "All" reveals several
  // cards at once, so there's no single "newly shown" card to jump to.
  function scrollLifeStageIntoView(id, grid) {
    if (!id || !grid) return;
    var card = grid.querySelector('[data-open-card="lifestage:' + id + '"]');
    if (card) card.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function selectLifeStage(id, triggerGrid) {
    selectedLifeStageId = id;
    renderLifeStageTabs();
    applyLifeStageVisibility();
    savePrefs();
    scrollLifeStageIntoView(id, triggerGrid);
  }

  function bindLifeStageTabRow(rowSel, gridSel) {
    var row = qs(rowSel);
    if (!row) return;
    var grid = qs(gridSel);
    qsa(".lifestage-tab-chip", row).forEach(function (chip) {
      chip.addEventListener("click", function () {
        var v = chip.getAttribute("data-lifestage");
        selectLifeStage(v === "all" ? null : v, grid);
      });
    });
  }

  function renderLifeStageTabs() {
    var html = lifeStageTabRowHtml();
    var row1 = qs("#lifestage-tabs");
    if (row1) row1.innerHTML = html;
    var row2 = qs("#more-lifestage-tabs");
    if (row2) row2.innerHTML = html;
    bindLifeStageTabRow("#lifestage-tabs", "#lifestages-grid");
    bindLifeStageTabRow("#more-lifestage-tabs", "#more-lifestages-grid");
  }

  function renderLifeStages() {
    var html = (data.lifeStages || []).map(lifeStageCardHtml).join("");
    qs("#lifestages-grid").innerHTML = html;
    // Same 4 cards, reachable a second way via the More > Life stages sub-page.
    var moreGrid = qs("#more-lifestages-grid");
    if (moreGrid) moreGrid.innerHTML = html;
    renderLifeStageTabs();
    applyLifeStageVisibility();
  }

  // ---------- Herbs ----------
  // No dedicated tab until this More-tab restructuring (5 Nov 2026) - a herb
  // was previously only reachable via a topic/lifestage's "Related herbs"
  // chips, search, backlinks, or a direct #/herb/<id> link. Preview card
  // mirrors nutrientCardHtml/lifeStageCardHtml's pattern (headline info,
  // opens the full detail panel on tap), not the Myths deck's flip card -
  // herbs have no claim/evidence two-sided structure to flip between.
  function herbCardHtml(h) {
    return (
      '<article class="card" data-open-card="herb:' + h.id + '">' +
      "<h3>" + escapeHtml(h.name) + (h.aliases && h.aliases.length ? " <small>(" + escapeHtml(h.aliases.join(", ")) + ")</small>" : "") + "</h3>" +
      "<p>" + renderProse(firstStatementText(h.traditionalUse)) + "</p>" +
      cardActionsHtml("herb", h.id, h.name) +
      "</article>"
    );
  }

  function renderHerbs() {
    qs("#herbs-grid").innerHTML = (data.herbs || []).map(herbCardHtml).join("");
  }

  // ---------- Myths ----------
  function renderMyths() {
    qs("#myths-grid").innerHTML = (data.myths || []).map(function (m) {
      var mythSplit = splitOpenQuestions(m.explanation);
      return (
        '<div class="myth-card" data-myth="' + m.id + '">' +
        '<div class="myth-card-inner">' +
        '<div class="myth-face myth-front"><p><strong>Claim:</strong> ' + renderProse(m.claim) + '</p>' +
        '<button class="myth-flip-btn" data-flip="' + m.id + '">Flip for evidence</button></div>' +
        '<div class="myth-face myth-back"><p><strong>Verdict:</strong> ' + renderProse(m.verdict) + "</p>" +
        mixedEvidenceCueHtml([mythSplit.open]) +
        labelledListHtml(mythSplit.rest) +
        mixedEvidenceBlockHtml([mythSplit.open]) +
        sourceLineHtml(m.sourceIds) +
        cardActionsHtml("myth", m.id, m.claim) +
        '<button class="myth-flip-btn" data-flip="' + m.id + '">Back to claim</button></div>' +
        "</div></div>"
      );
    }).join("");
    qsa("[data-flip]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        qs('.myth-card[data-myth="' + btn.getAttribute("data-flip") + '"]').classList.toggle("flipped");
      });
    });
  }

  // ---------- Sources ----------
  var SOURCE_TYPE_GROUPS = ["Government or health body", "Study or review", "Book", "Article or blog", "Internal project policy"];
  function sourceCardHtml(s) {
    return (
      '<div class="card">' +
      "<h4>" + escapeHtml(s.title) + "</h4>" +
      "<p>" + escapeHtml(s.author) + " · " + escapeHtml(String(s.year)) + " · " + escapeHtml(s.type) + "</p>" +
      '<span class="evidence-badge ' + evidenceClass(s.evidenceLevel) + '">' + escapeHtml(s.evidenceLevel) + "</span> " +
      unverifiedSourceTagHtml(s) + " " +
      "<span>As of " + escapeHtml(s.asOf) + "</span>" +
      (s.status ? "<p><em>" + escapeHtml(s.status) + "</em></p>" : "") +
      "</div>"
    );
  }
  function renderSources() {
    var sources = data.sources || [];
    var byType = {};
    sources.forEach(function (s) {
      (byType[s.type] = byType[s.type] || []).push(s);
    });
    var groupKeys = SOURCE_TYPE_GROUPS.concat(Object.keys(byType).filter(function (t) {
      return SOURCE_TYPE_GROUPS.indexOf(t) === -1;
    }));
    qs("#sources-list").innerHTML = groupKeys.map(function (type) {
      var entries = byType[type];
      if (!entries || !entries.length) return "";
      var cards = entries.map(sourceCardHtml).join("");
      return detailsBlock(type + " (" + entries.length + ")", cards, false);
    }).join("");
  }

  // ---------- WhatsApp suggest ----------
  function whatsappLink(message) {
    if (!CONFIG.whatsappNumber) return null;
    return "https://wa.me/" + CONFIG.whatsappNumber + "?text=" + encodeURIComponent(message);
  }

  function renderWhatsApp() {
    var link = qs("#whatsapp-suggest");
    var href = whatsappLink("Hi! I'd like to suggest a topic for the Vegan Health Dashboard: ");
    if (href) {
      link.href = href;
    } else {
      link.href = "#";
      link.addEventListener("click", function (e) {
        e.preventDefault();
        showToast("The WhatsApp number has not been set yet. Add it to CONFIG.whatsappNumber in app.js.");
      });
    }
    var isSample = !!(data && data.meta && data.meta.status === "SAMPLE - to be replaced");
    qs("#about-sample-note").textContent = isSample
      ? "This copy of the dashboard is running on sample content (" + data.meta.note + ")."
      : "";
    // Top-of-page banner and welcome-dialog note: only ever shown when the
    // loaded knowledge file is really the SAMPLE one (see KNOWLEDGE_PATHS),
    // never on real compiled content - same data.meta.status check as the
    // About-page note above.
    qs("#sample-banner").hidden = !isSample;
    qs("#welcome-sample-note").hidden = !isSample;
  }

  // ---------- trust and status: version badge, as-of date, What's new ----------
  function renderStatusLine() {
    var m = data.meta || {};
    var bits = [];
    if (m.contentVersion) bits.push(m.contentVersion);
    if (m.asOf) bits.push("as of " + m.asOf);
    qs("#status-line").textContent = bits.join(" · ");
  }

  var WHATS_NEW_SEEN_KEY = "vhd_whatsnew_seen_v1";
  function latestWhatsNewDate() {
    var entries = (data.meta && data.meta.whatsNew) || [];
    if (!entries.length) return null;
    return entries.slice().sort(function (a, b) { return b.date < a.date ? -1 : 1; })[0].date;
  }
  function renderWhatsNewBell() {
    var latest = latestWhatsNewDate();
    var seen = loadJSON(WHATS_NEW_SEEN_KEY, null);
    qs("#whats-new-dot").hidden = !latest || (seen && seen >= latest);
  }
  function whatsNewViewHtml() {
    var entries = ((data.meta && data.meta.whatsNew) || []).slice().sort(function (a, b) { return b.date < a.date ? -1 : 1; });
    var rows = entries.map(function (e) {
      return "<li><strong>" + escapeHtml(e.date) + ":</strong> " + renderProse(e.summary) + "</li>";
    }).join("");
    return '<div class="card"><h2>What\'s new</h2><ul>' + (rows || "<li>Nothing logged yet.</li>") + "</ul></div>";
  }
  function openWhatsNewView() {
    qs("#detail-body").innerHTML = whatsNewViewHtml();
    qs("#detail-panel").hidden = false;
    var latest = latestWhatsNewDate();
    if (latest) { saveJSON(WHATS_NEW_SEEN_KEY, latest); }
    renderWhatsNewBell();
  }

  // ---------- integrity check: SHA-256 fingerprint over the record arrays,
  // verified with SubtleCrypto on load. A mismatch or missing records shows a
  // quiet notice — never an alarming one, per the calm-language rule. ----------
  function bufferToHex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  function verifyIntegrity(knowledge) {
    var notice = qs("#integrity-notice");
    var integrity = knowledge.meta && knowledge.meta.integrity;
    if (!integrity || !integrity.fingerprint) { notice.hidden = true; return; }
    if (!window.crypto || !window.crypto.subtle || typeof window.VHDIntegrity === "undefined") {
      notice.hidden = true; // can't verify in this browser — fail quietly, don't alarm
      return;
    }
    var countsMatch = (integrity.fields || []).every(function (key) {
      var expected = integrity.recordCounts && integrity.recordCounts[key];
      var actual = (knowledge[key] || []).length;
      return expected === actual;
    });
    var payload = window.VHDIntegrity.recordsPayload(knowledge);
    window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)).then(function (buf) {
      var hex = bufferToHex(buf);
      var ok = countsMatch && hex === integrity.fingerprint;
      notice.hidden = ok;
      if (!ok) {
        notice.textContent = "Content check: this copy may not exactly match what was last published.";
      }
    }).catch(function () {
      notice.hidden = true; // fail quietly
    });
  }

  // ---------- detail panel ----------
  // Herbs (Phase 2 module, added 31 Oct 2026) have no dedicated tab yet —
  // reachable today via a topic's "Related herbs" chips, search, backlinks,
  // and a direct #/herb/<id> link, same as every other card type.
  function preparationFormsHtml(h) {
    if (!h.preparationForms || !h.preparationForms.length) return "";
    var caveat = h.preparationFormsCaveat ? '<p class="entry-conflict">' + renderProse(h.preparationFormsCaveat) + "</p>" : "";
    var rows = h.preparationForms.map(function (pf) {
      return "<p><strong>" + escapeHtml(pf.form) + ":</strong> " + renderProse(pf.note) + "</p>" + sourceLineHtml(pf.sourceIds);
    }).join("");
    return caveat + rows;
  }
  function herbDetailHtml(h) {
    var openGroups = [];
    var herbTu = splitOpenQuestions(h.traditionalUse); openGroups.push(herbTu.open);
    var herbWes = splitOpenQuestions(h.whatEvidenceShows); openGroups.push(herbWes.open);
    var herbHuv = splitOpenQuestions(h.howToUseVegan); openGroups.push(herbHuv.open);
    var herbCau = splitOpenQuestions(h.cautions); openGroups.push(herbCau.open);
    return (
      '<div class="card">' +
      "<h2>" + escapeHtml(h.name) + (h.aliases && h.aliases.length ? " <small>(" + escapeHtml(h.aliases.join(", ")) + ")</small>" : "") + "</h2>" +
      mixedEvidenceCueHtml(openGroups) +
      labelledListHtml(herbTu.rest) +
      detailsBlock("What the evidence shows", labelledListHtml(herbWes.rest)) +
      detailsBlock("How to use it, staying vegan", labelledListHtml(herbHuv.rest)) +
      detailsBlock("Preparation forms", preparationFormsHtml(h)) +
      detailsBlock("Cautions", labelledListHtml(herbCau.rest)) +
      (h.redFlags && h.redFlags.length ? '<div class="doctor-flag">' + labelledListHtml(h.redFlags) + "</div>" : "") +
      (h.linkedHealthTopics && h.linkedHealthTopics.length ? "<p><strong>Linked health topic" + (h.linkedHealthTopics.length > 1 ? "s" : "") + ":</strong> " + topicChipsHtml(h.linkedHealthTopics) + "</p>" : "") +
      (h.crossCautionLinks && h.crossCautionLinks.length ? "<p><strong>Also relevant to:</strong> " + topicChipsHtml(h.crossCautionLinks) + "</p>" : "") +
      mixedEvidenceBlockHtml(openGroups) +
      detailsBlock("Sources", sourceLineHtml(h.sourceIds)) +
      referencedByHtml("herb", h.id) +
      cardActionsHtml("herb", h.id, h.name) +
      "</div>"
    );
  }

  function detailHtmlFor(type, id) {
    if (type === "nutrient") { var n = byId.nutrients[id]; return n ? nutrientDetailHtml(n) : ""; }
    if (type === "food") { var f = byId.foods[id]; return f ? foodDetailHtml(f) : ""; }
    if (type === "topic") { var t = byId.healthTopics[id]; return t ? topicCardHtml(t) : ""; }
    if (type === "lifestage") { var l = byId.lifeStages[id]; return l ? lifeStageCardHtml(l) : ""; }
    if (type === "herb") { var h = byId.herbs[id]; return h ? herbDetailHtml(h) : ""; }
    if (type === "myth") {
      var m = byId.myths[id];
      if (!m) return "";
      var mythSplit = splitOpenQuestions(m.explanation);
      return (
        '<div class="card"><p><strong>Claim:</strong> ' + renderProse(m.claim) + "</p><p><strong>Verdict:</strong> " + renderProse(m.verdict) + "</p>" +
        mixedEvidenceCueHtml([mythSplit.open]) +
        labelledListHtml(mythSplit.rest) +
        mixedEvidenceBlockHtml([mythSplit.open]) +
        sourceLineHtml(m.sourceIds) + referencedByHtml("myth", m.id) + cardActionsHtml("myth", m.id, m.claim) + "</div>"
      );
    }
    return "";
  }

  function titleFor(type, id) {
    if (type === "nutrient") return byId.nutrients[id] && byId.nutrients[id].name;
    if (type === "food") return byId.foods[id] && byId.foods[id].name;
    if (type === "topic") return byId.healthTopics[id] && byId.healthTopics[id].name;
    if (type === "lifestage") return byId.lifeStages[id] && byId.lifeStages[id].name;
    if (type === "herb") return byId.herbs[id] && byId.herbs[id].name;
    if (type === "myth") return byId.myths[id] && byId.myths[id].claim;
    return "";
  }

  // Typical daily range: current schema is dailyRangeByGroup, an array of
  // { group, amount, label, sourceIds, conflict? } rows, one per life stage
  // or group — not a single adult figure. Legacy sample content still uses
  // dailyRange.adult / dailyRange.pregnancy, flat strings keyed by group.
  function dailyRangeHtml(n) {
    if (Array.isArray(n.dailyRangeByGroup) && n.dailyRangeByGroup.length) {
      return n.dailyRangeByGroup.map(function (r) {
        var conflict = r.conflict ? '<p class="entry-conflict">' + renderProse(r.conflict) + "</p>" : "";
        return (
          "<p><strong>" + escapeHtml(r.group) + ":</strong> " + renderProse(r.amount) + " " + copyIconHtml(r.group + ": " + r.amount) + "</p>" +
          conflict + sourceLineHtml(r.sourceIds)
        );
      }).join("");
    }
    if (n.dailyRange) {
      return Object.keys(n.dailyRange).map(function (k) {
        return "<p><strong>" + escapeHtml(k) + ":</strong> " + renderProse(n.dailyRange[k]) + "</p>";
      }).join("");
    }
    return "";
  }

  function nutrientDetailHtml(n) {
    var openGroups = [];
    var nutWid = splitOpenQuestions(n.whatItDoes); openGroups.push(nutWid.open);
    var nutVc = splitOpenQuestions(n.veganContext); openGroups.push(nutVc.open);
    var nutAt = splitOpenQuestions(n.absorptionTips); openGroups.push(nutAt.open);
    var nutCau = splitOpenQuestions(n.cautions); openGroups.push(nutCau.open);
    var nutWtt = splitOpenQuestions(n.whenToTest); openGroups.push(nutWtt.open);
    return (
      '<div class="card">' +
      '<span class="badge ' + tierBadgeClass(n.tier) + '">' + tierLabel(n.tier) + "</span>" +
      "<h2>" + escapeHtml(n.name) + "</h2>" +
      mixedEvidenceCueHtml(openGroups) +
      labelledListHtml(nutWid.rest) +
      '<p class="one-line-action"><strong>One action:</strong> ' + renderProse(n.oneLineAction || n.action) + "</p>" +
      detailsBlock("Typical daily range", dailyRangeHtml(n)) +
      detailsBlock("What this means for vegans", labelledListHtml(nutVc.rest)) +
      detailsBlock("Absorption tips", labelledListHtml(nutAt.rest)) +
      detailsBlock("Cautions", labelledListHtml(nutCau.rest)) +
      detailsBlock("When to test", labelledListHtml(nutWtt.rest)) +
      mixedEvidenceBlockHtml(openGroups) +
      detailsBlock("Known gaps", gapsHtml(n.gaps)) +
      detailsBlock("Sources", sourceLineHtml(n.sourceIds)) +
      referencedByHtml("nutrient", n.id) +
      cardActionsHtml("nutrient", n.id, n.name) +
      "</div>"
    );
  }

  // A one-off nested shape so far used only on composite dishes with no
  // gram-level ingredient breakdown (e.g. khichdi): a measured figure as
  // traditionally prepared (which may not be vegan — ghee is common) next to
  // a vegan-adapted estimate that may say plainly it could not be built.
  // Rendered defensively: only the sub-fields actually present are shown.
  function veganPreparationHtml(vp) {
    if (!vp) return "";
    var parts = [];
    if (vp.traditionalPreparation) {
      var tp = vp.traditionalPreparation;
      parts.push(
        "<p><strong>" + escapeHtml(tp.label || "Traditional preparation") + ":</strong> " + renderProse(tp.note) + "</p>" +
        (tp.evidenceGrade ? evidenceBadgeHtml(tp.evidenceGrade) : "")
      );
    }
    if (vp.veganAdaptedEstimate) {
      var ve = vp.veganAdaptedEstimate;
      parts.push("<p><strong>" + escapeHtml(ve.label || "Vegan-adapted estimate") + ":</strong> " + renderProse(ve.status || ve.note) + "</p>");
    }
    return parts.join("");
  }

  function foodDetailHtml(f) {
    var links = (data.healthMap || []).filter(function (m) { return m.foodId === f.id; });
    var topicChips = links.map(function (l) {
      var t = byId.healthTopics[l.topicId];
      if (!t) return "";
      return (
        '<div class="helps-with-row"><button type="button" class="chip" data-open-topic="' + t.id + '">' +
        escapeHtml(t.name) + " (" + escapeHtml(l.relation) + ")</button>" + whyLineHtml(l) + "</div>"
      );
    }).join("");
    var nutrientList = foodKeyNutrients(f).map(function (kn) {
      var n = byId.nutrients[kn.nutrientId];
      return '<li><button type="button" class="chip" data-open-card="nutrient:' + kn.nutrientId + '">' + (n ? escapeHtml(n.name) : kn.nutrientId) + "</button> — " + renderProse(keyNutrientAmountText(kn)) + "</li>";
    }).join("");
    var localName = defaultLocalName(f);
    var portion = foodPortion(f);
    var openGroups = [];
    var foodPt = Array.isArray(f.pairingTips) ? splitOpenQuestions(f.pairingTips) : { rest: f.pairingTips, open: [] };
    openGroups.push(foodPt.open);
    var foodPn = splitOpenQuestions(f.preparationNotes); openGroups.push(foodPn.open);
    return (
      '<div class="card">' +
      "<h2>" + escapeHtml(f.name) + (localName ? " <small>(" + escapeHtml(localName) + ")</small>" : "") + "</h2>" +
      mixedEvidenceCueHtml(openGroups) +
      "<p>" + escapeHtml(f.foodGroup) + " · " + escapeHtml(f.indianOrGlobal) + "</p>" +
      (portion ? "<p><strong>Everyday portion:</strong> " + escapeHtml(portion) + "</p>" : "") +
      (f.oneLineAction ? '<p class="one-line-action"><strong>One action:</strong> ' + renderProse(f.oneLineAction) + "</p>" : "") +
      (Array.isArray(f.pairingTips)
        ? (foodPt.rest.length ? "<p><strong>Pairing tip" + (foodPt.rest.length > 1 ? "s" : "") + ":</strong></p>" + labelledListHtml(foodPt.rest) : "")
        : (f.pairingTips ? "<p><strong>Pairing tip:</strong> " + renderProse(f.pairingTips) + "</p>" : "")) +
      detailsBlock("Key nutrients", nutrientList ? "<ul>" + nutrientList + "</ul>" : "") +
      detailsBlock("Preparation", labelledListHtml(foodPn.rest)) +
      detailsBlock("As traditionally prepared", veganPreparationHtml(f.veganPreparation)) +
      detailsBlock("Notes", f.notes ? "<p>" + renderProse(f.notes) + "</p>" : "") +
      detailsBlock("Helps with", topicChips) +
      mixedEvidenceBlockHtml(openGroups) +
      detailsBlock("Sources", sourceLineHtml(f.sourceIds)) +
      referencedByHtml("food", f.id) +
      cardActionsHtml("food", f.id, f.name) +
      "</div>"
    );
  }

  function openDetail(type, id) {
    var html = detailHtmlFor(type, id);
    if (!html) return;
    qs("#detail-body").innerHTML = html;
    qs("#detail-panel").hidden = false;
    pushRecent(type, id, titleFor(type, id));
    qsa("[data-open-card]", qs("#detail-body")).forEach(bindCardOpen);
    qsa("[data-open-topic]", qs("#detail-body")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeDetail();
        location.hash = "#/topic/" + btn.getAttribute("data-open-topic");
      });
    });
  }
  function closeDetail() {
    qs("#detail-panel").hidden = true;
    if (welcomePendingAfterDetail) {
      welcomePendingAfterDetail = false;
      maybeShowWelcome();
    }
  }
  // For an explicit, in-page close (X button, tapping the backdrop, Escape) —
  // as opposed to the phone's Back button, which handleHash already reacts
  // to — also step the URL back off its #/type/id or #/compare hash, so the
  // address bar and history stay consistent with what is on screen.
  function closeDetailAndHash() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("/") === 0) {
      // history.back() normally lands on whatever hash was open before this
      // card (a search result list, a related-topic chip, etc.). But when
      // this card's hash was the tab's very first navigation - a first-time
      // visitor opening a shared card link directly, with nothing earlier in
      // this session to go back to - history.back() silently does nothing,
      // leaving the panel stuck open. inAppHashChangeCount > 0 is this app's
      // own, reliable signal for "a same-document hash transition has
      // actually happened here" (history.length isn't trustworthy - it
      // counts entries outside this document too); below that, close
      // directly and land on the card's own tab instead (same mapping
      // handleHash() uses to open it).
      if (inAppHashChangeCount > 0) { history.back(); return; }
      var parts = hash.split("/").filter(Boolean);
      var type = parts[0];
      var tab = TAB_FOR_TYPE[type] || "home";
      try { history.replaceState(null, "", location.pathname + "#" + tab); } catch (err) { location.hash = "#" + tab; }
      closeDetail();
      showTab(tab);
      if (type === "myth") showMoreSection("myths");
      return;
    }
    closeDetail();
  }

  function bindCardOpen(el) {
    el.addEventListener("click", function (e) {
      // Self-contained interactive controls nested inside a card — never
      // let a click on one of these also open or re-open the card.
      if (e.target.closest(".card-actions, .evidence-badge, .glossary-term, .glossary-tip, .evidence-tip, .read-more-link, details summary, .compare-pick, .copy-fact-btn")) return;
      // A card can nest other data-open-card elements (a food chip inside a
      // topic card, a nutrient chip inside a food card, a "referenced by"
      // chip). Only the innermost one — the actual click target's closest
      // match — should open; otherwise a click on the nested chip would also
      // bubble up and re-open the outer card, overwriting the detail panel.
      if (e.target.closest("[data-open-card]") !== el) return;
      var val = el.getAttribute("data-open-card").split(":");
      openDetail(val[0], val[1]);
    });
  }

  // ---------- copy to clipboard (wrapped, with a textarea fallback) ----------
  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error("copy failed"));
      } catch (err) { reject(err); }
    });
  }

  function announce(msg) { showToast(msg); }

  // ---------- share menu on every card: Web Share, WhatsApp, Copy link ----------
  function cardUrl(type, id) {
    return location.origin + location.pathname + "#/" + type + "/" + id;
  }
  function closeOpenShareMenus() {
    qsa(".share-menu").forEach(function (m) { m.remove(); });
    qsa('.share-btn[aria-expanded="true"]').forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  // Shown inline in the share menu, once ever, so whoever is sharing knows
  // what the recipient actually gets (a link to the live page for this one
  // card, not an image/snapshot) before they send it.
  var SHARE_TIP_SEEN_KEY = "vhd_share_tip_seen_v1";
  function toggleShareMenu(btn) {
    var next = btn.nextElementSibling;
    if (next && next.classList && next.classList.contains("share-menu")) {
      closeOpenShareMenus();
      return;
    }
    closeOpenShareMenus();
    var type = btn.getAttribute("data-type"), id = btn.getAttribute("data-id");
    var url = cardUrl(type, id);
    var title = titleFor(type, id) || "this card";
    var waHref = whatsappLink(
      "Check this out on the Vegan Health Dashboard — " + title + ": " + url +
      "\n(General information, not medical advice.)"
    );
    var showTip = !loadJSON(SHARE_TIP_SEEN_KEY, false);
    var menu = document.createElement("div");
    menu.className = "share-menu";
    menu.innerHTML = (
      (showTip ? '<p class="share-tip">This shares a link, not an image — your recipient will see the live page, opened straight to this card.</p>' : "") +
      (navigator.share ? '<button type="button" class="icon-btn share-native-btn">📤 Share…</button>' : "") +
      (waHref ? '<a class="icon-btn whatsapp-btn" href="' + escapeHtml(waHref) + '" target="_blank" rel="noopener">💬 Share on WhatsApp</a>' : "") +
      '<button type="button" class="icon-btn share-copy-btn">🔗 Copy link</button>'
    );
    if (showTip) saveJSON(SHARE_TIP_SEEN_KEY, true);
    btn.insertAdjacentElement("afterend", menu);
    btn.setAttribute("aria-expanded", "true");
    var nativeBtn = menu.querySelector(".share-native-btn");
    if (nativeBtn) {
      nativeBtn.addEventListener("click", function () {
        navigator.share({ title: title, url: url }).catch(function () {});
        closeOpenShareMenus();
      });
    }
    menu.querySelector(".share-copy-btn").addEventListener("click", function () {
      copyTextToClipboard(url).then(function () { showToast("Link copied."); }).catch(function () { showToast(url); });
      closeOpenShareMenus();
    });
  }

  function printCard(type, id) {
    var area = qs("#print-area");
    if (!area) {
      area = document.createElement("div");
      area.id = "print-area";
      area.className = "print-only";
      document.body.appendChild(area);
    }
    area.innerHTML = "<h1>Vegan Health Dashboard</h1>" + detailHtmlFor(type, id) + "<p>General information, not medical advice.</p>";
    window.print();
  }

  // ---------- search ----------
  function renderSearchResults(query) {
    var box = qs("#search-results");
    if (!query) { box.hidden = true; box.innerHTML = ""; return; }
    var results = fuse ? fuse.search(query, { limit: 20 }) : [];
    if (!results.length) {
      box.hidden = false;
      var askHref = whatsappLink('Hi! I searched for "' + query + '" on the Vegan Health Dashboard and did not find it. Could you add it?');
      var askBtn = askHref
        ? '<a class="icon-btn whatsapp-btn" href="' + escapeHtml(askHref) + '" target="_blank" rel="noopener">💬 Ask for "' + escapeHtml(query) + '" on WhatsApp</a>'
        : "";
      box.innerHTML = '<p class="no-results">Not covered yet. Try another word, or:</p><p>' + askBtn + "</p>";
      return;
    }
    var grouped = {};
    results.forEach(function (r) {
      var displaySubtitle = r.item.subtitle;
      if (r.item.type === "Nutrients" && r.matches && r.matches.some(function (m) { return m.key === "symptomTerms"; })) {
        displaySubtitle = r.item.subtitle + " — matched your search '" + query + "'";
      }
      grouped[r.item.type] = grouped[r.item.type] || [];
      grouped[r.item.type].push({ item: r.item, displaySubtitle: displaySubtitle });
    });
    var html = "";
    Object.keys(grouped).forEach(function (group) {
      html += '<div class="search-group-label">' + escapeHtml(group) + "</div>";
      html += grouped[group].map(function (entry) {
        var item = entry.item;
        return '<button class="search-result-item" data-result-type="' + mapGroupToType(group, item) + '" data-result-id="' + item.id + '">' +
          escapeHtml(item.title) + "<small>" + escapeHtml(entry.displaySubtitle || "") + "</small></button>";
      }).join("");
    });
    box.innerHTML = html;
    box.hidden = false;
    qsa("[data-result-type]", box).forEach(function (btn) {
      btn.addEventListener("click", function () {
        pushRecentSearch(query);
        location.hash = "#/" + btn.getAttribute("data-result-type") + "/" + btn.getAttribute("data-result-id");
        box.hidden = true;
        qs("#search-input").value = "";
      });
    });
  }
  function mapGroupToType(group, item) {
    if (group === "Nutrients") return "nutrient";
    if (group === "Foods") return "food";
    if (group === "Myths") return "myth";
    if (group === "Herbs") return "herb";
    if (group === "Health") return byId.healthTopics[item.id] ? "topic" : "lifestage";
    return "nutrient";
  }

  // ---------- tabs & routing ----------
  var TABS = ["home", "nutrients", "foods", "health", "more"];
  var lastTab = "home";
  function showTab(tab) {
    if (TABS.indexOf(tab) < 0) tab = "home";
    lastTab = tab;
    TABS.forEach(function (t) {
      qs("#view-" + t).hidden = t !== tab;
    });
    qsa("nav.tabs button").forEach(function (btn) {
      btn.setAttribute("aria-current", String(btn.getAttribute("data-tab") === tab));
    });
    savePrefs();
  }

  // ---------- More tab: short menu + sub-pages (5 Nov 2026 restructuring) ----------
  // Appearance and Suggest a topic stay inline on the menu itself; everything
  // else that used to be one long stacked More page is now its own sub-page,
  // routed as #/more/<section>, with Herbs and Life stages added as two new
  // sub-pages (previously reachable only via cross-links, search or a direct
  // #/herb or #/lifestage URL). Glossary deliberately has no row here yet -
  // still an open decision, out of scope for this change.
  var MORE_SECTIONS = ["help", "myths", "herbs", "lifestages", "buy", "sources", "about"];
  function showMoreSection(section) {
    var valid = section && MORE_SECTIONS.indexOf(section) >= 0;
    qs("#more-menu").hidden = valid;
    MORE_SECTIONS.forEach(function (s) {
      var el = qs("#more-sub-" + s);
      if (el) el.hidden = !(valid && s === section);
    });
  }
  // Same back/forward pattern as closeDetailAndHash: a sub-page hash
  // (#/more/<section>) is always reached via a hash change, which the
  // browser has already pushed to history, so an explicit Back button just
  // unwinds it with history.back() — the phone's native Back button gets
  // this for free, since it fires the same hashchange/popstate handleHash()
  // already listens for. The plain hash fallback covers the (unexpected)
  // case of landing here with nothing to go back to.
  function moreBackButtonClick() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("/") === 0) { history.back(); } else { location.hash = "#more"; }
  }

  function handleHash() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("/") === 0) {
      var parts = hash.split("/").filter(Boolean);
      if (parts.length === 1 && parts[0] === "compare") {
        openCompareView();
        return;
      }
      if (parts.length === 1 && parts[0] === "whatsnew") {
        openWhatsNewView();
        return;
      }
      if (parts.length === 2 && parts[0] === "import") {
        handleImportRoute(parts[1]);
        return;
      }
      if (parts.length === 2 && parts[0] === "more") {
        closeDetail();
        showTab("more");
        showMoreSection(parts[1]);
        return;
      }
      if (parts.length === 2) {
        var type = parts[0], id = parts[1];
        showTab(TAB_FOR_TYPE[type] || "home");
        // A shared myth link routes to the More tab (see TAB_FOR_TYPE above) -
        // make sure it lands inside the Myths sub-page, not the bare menu.
        if (type === "myth") showMoreSection("myths");
        if (type === "topic" && selectedTopics.indexOf(id) < 0) {
          selectedTopics = [id];
          renderTopicPicker();
          renderHealthView();
        }
        openDetail(type, id);
        return;
      }
    }
    // Any other hash (including the phone's Back button landing on a plain
    // tab hash) means no card or compare view should be showing any more.
    closeDetail();
    var tab = hash || "home";
    showTab(tab);
    if (tab === "more") showMoreSection(null);
  }

  // ---------- init ----------
  function bindStaticEvents() {
    renderRecentSearches();
    qsa("nav.tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        location.hash = "#" + btn.getAttribute("data-tab");
      });
    });
    qsa("[data-more-section]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        location.hash = "#/more/" + btn.getAttribute("data-more-section");
      });
    });
    qsa("[data-more-back]").forEach(function (btn) {
      btn.addEventListener("click", moreBackButtonClick);
    });
    qs("#detail-close").addEventListener("click", closeDetailAndHash);
    qs("#detail-panel").addEventListener("click", function (e) {
      if (e.target === qs("#detail-panel")) closeDetailAndHash();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDetailAndHash();
    });
    var input = qs("#search-input");
    input.addEventListener("input", function () { renderSearchResults(input.value.trim()); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && input.value.trim()) pushRecentSearch(input.value.trim());
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".search-wrap")) qs("#search-results").hidden = true;
    });
    // "/" focuses search on a laptop, unless already typing somewhere else.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (document.activeElement && document.activeElement.isContentEditable)) return;
      e.preventDefault();
      qs("#search-input").focus();
    });
    // Delegated taps: glossary terms and evidence badges appear all over the
    // page (grids, detail panel, combine view), so one document-level
    // listener handles them instead of rebinding after every render.
    document.addEventListener("click", function (e) {
      var glossaryBtn = e.target.closest(".glossary-term");
      if (glossaryBtn) { toggleGlossaryTip(glossaryBtn); return; }
      var evidenceBtn = e.target.closest(".evidence-badge");
      if (evidenceBtn) { toggleEvidenceTip(evidenceBtn); return; }
      var copyBtn = e.target.closest(".copy-fact-btn");
      if (copyBtn) {
        copyTextToClipboard(copyBtn.getAttribute("data-copy-text") || "").then(function () {
          showToast("Copied.");
        }).catch(function () { showToast("Could not copy — select and copy the text instead."); });
        return;
      }
      var saveBtn = e.target.closest(".save-btn");
      if (saveBtn) {
        var sType = saveBtn.getAttribute("data-type"), sId = saveBtn.getAttribute("data-id");
        toggleBookmark(sType, sId, saveBtn.getAttribute("data-title"));
        var nowSaved = isBookmarked(sType, sId);
        qsa('.save-btn[data-type="' + sType + '"][data-id="' + sId + '"]').forEach(function (b) {
          b.setAttribute("aria-pressed", nowSaved);
          b.textContent = nowSaved ? "★ Saved" : "☆ Save";
        });
        return;
      }
      var printBtn = e.target.closest(".print-btn");
      if (printBtn) { printCard(printBtn.getAttribute("data-type"), printBtn.getAttribute("data-id")); return; }
      var shareBtn = e.target.closest(".share-btn");
      if (shareBtn) { toggleShareMenu(shareBtn); return; }
      if (!e.target.closest(".share-menu")) { closeOpenShareMenus(); }
    });
    window.addEventListener("hashchange", function () {
      // hashchange only fires for a transition AFTER this page already
      // loaded - never for a hash the URL already had at load time (a
      // shared link) - so this is the real signal closeDetailAndHash()
      // needs for "is there a same-document state to go back to."
      inAppHashChangeCount++;
      handleHash();
    });

    // The nudge is only ever shown while compareMode is off (see
    // renderCompareNudge), so this always turns Compare mode on - the only
    // way in, now that the standalone Compare button is gone.
    qs("#compare-nudge").addEventListener("click", toggleCompareMode);
    qs("#compare-view-btn").addEventListener("click", function () { location.hash = "#/compare"; });
    qs("#whats-new-bell").addEventListener("click", function () { location.hash = "#/whatsnew"; });
    // Clear is also the only way back out of Compare mode now, so it both
    // empties the selection and turns compareMode off (was selection-only).
    qs("#compare-clear-btn").addEventListener("click", function () {
      compareSelection = [];
      compareMode = false;
      updateCompareBar();
      renderFoods();
    });
    qs("#compare-pick-btn").addEventListener("click", openComparePicker);
    qs("#compare-picker-close").addEventListener("click", function () { popOverlay(); closeComparePicker(); });
    qs("#compare-picker-search").addEventListener("input", renderComparePickerList);
    qs("#replay-welcome-btn").addEventListener("click", showWelcomeDialog);
    qs("#replay-welcome-btn-2").addEventListener("click", showWelcomeDialog);
    qsa(".theme-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { setTheme(btn.getAttribute("data-theme-choice")); });
    });
    qsa(".theme-btn").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-theme-choice") === loadJSON(THEME_KEY, "system")));
    });

    // Back to top, on long views.
    var topBtn = qs("#back-to-top-btn");
    window.addEventListener("scroll", function () {
      topBtn.hidden = window.scrollY < 400;
    }, { passive: true });
    topBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function renderAll() {
    renderHome();
    renderNutrients();
    renderSortOptions();
    renderFoodFilters();
    renderFoods();
    updateCompareBar();
    renderTopicPicker();
    renderHealthView();
    renderLifeStages();
    renderHerbs();
    renderMyths();
    qs("#where-to-buy-filters").hidden = !WHERE_TO_BUY_LISTINGS_ENABLED;
    qs("#where-to-buy-grid").hidden = !WHERE_TO_BUY_LISTINGS_ENABLED;
    if (WHERE_TO_BUY_LISTINGS_ENABLED) {
      renderWhereToBuyFilters();
      renderWhereToBuy();
    }
    renderSources();
    renderWhatsApp();
    renderStatusLine();
    renderWhatsNewBell();
    qsa("[data-open-card]").forEach(bindCardOpen);
  }

  function init() {
    bindStaticEvents();
    loadKnowledge(KNOWLEDGE_PATHS).then(function (json) {
      data = json;
      indexById(data.nutrients, byId.nutrients);
      indexById(data.foods, byId.foods);
      indexById(data.healthTopics, byId.healthTopics);
      indexById(data.lifeStages, byId.lifeStages);
      indexById(data.myths, byId.myths);
      indexById(data.herbs, byId.herbs);
      indexById(data.sources, byId.sources);
      buildSearchIndex();
      buildGlossaryIndex();
      buildBacklinks();
      verifyIntegrity(data);
      // Remember my filters and last tab: restored before the first render so
      // every view opens already showing what the viewer left it on.
      var prefs = loadPrefs();
      if (prefs) {
        if (prefs.foodFilters) activeFoodFilters = prefs.foodFilters;
        if (prefs.whereToBuyFilters) activeWhereToBuyFilters = prefs.whereToBuyFilters;
        if (prefs.foodSortMode) foodSortMode = prefs.foodSortMode;
        if (Array.isArray(prefs.selectedTopics)) {
          selectedTopics = prefs.selectedTopics.filter(function (id) { return byId.healthTopics[id]; });
        }
        if (prefs.lifeStageTab && byId.lifeStages[prefs.lifeStageTab]) {
          selectedLifeStageId = prefs.lifeStageTab;
        }
      }
      renderAll();
      if (!location.hash && prefs && prefs.lastTab && prefs.lastTab !== "home") {
        location.hash = "#" + prefs.lastTab;
      } else {
        handleHash();
      }
      document.body.setAttribute("data-loaded", "true");
      maybeShowWelcome();
    }).catch(function (err) {
      qs("main").innerHTML = '<p class="no-results">Could not load knowledge.json. ' + escapeHtml(err.message) + "</p>";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Offline support: registration is wrapped so a browser that blocks or
  // lacks service workers (an insecure context, a locked-down setting) just
  // skips it quietly — nothing else here depends on it having run.
  // Skipped entirely on a local dev host: the SW's cache-first strategy is
  // what makes an edit-and-reload dev loop keep showing stale app.js/
  // styles.css no matter how the HTTP/browser cache is cleared (recurring
  // dev-preview caching quirk, hit repeatedly - see CHECKPOINT.md). This is
  // an exclusion list, not a production allowlist, so real hosting (or a
  // future change to it) is unaffected either way.
  var LOCAL_DEV_HOSTNAMES = ["localhost", "127.0.0.1", "::1"];
  if ("serviceWorker" in navigator && LOCAL_DEV_HOSTNAMES.indexOf(location.hostname) === -1) {
    try {
      // updateViaCache: "none" makes the browser always fetch sw.js itself
      // fresh over the network when checking for an update, ignoring any
      // HTTP cache headers on it - GitHub Pages serves sw.js with
      // Cache-Control: max-age=600 by default, which otherwise means a
      // visitor's browser can go on believing an old service worker (and
      // everything it cache-first-serves, including styles.css/app.js) is
      // current for up to 10 minutes after a real deploy, with no normal
      // reload able to fix it - this is what that actually looked like.
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(function () { /* fail quietly */ });
    } catch (err) { /* fail quietly */ }
  }

  window.__vhd = {
    getData: function () { return data; },
    showConfirm: showConfirm,
    showToast: showToast,
    showWelcomeDialog: showWelcomeDialog
  };
})();
