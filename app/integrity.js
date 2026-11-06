// Shared between scripts/update-integrity.js (Node, writes the fingerprint)
// and app.js (browser, checks it with SubtleCrypto on load). Deliberately
// has no Node-only or browser-only calls itself, so the same file runs in
// both places unchanged.
(function (root) {
  "use strict";

  // The record arrays covered by the fingerprint. "meta" (including the
  // integrity block itself) is never included, so updating it never
  // invalidates the fingerprint.
  var RECORD_KEYS = ["sources", "nutrients", "foods", "healthTopics", "lifeStages", "myths", "herbs", "healthMap", "whereToBuy", "glossary", "didYouKnow"];

  function canonicalize(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(canonicalize).join(",") + "]";
    }
    if (value && typeof value === "object") {
      var keys = Object.keys(value).sort();
      return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + canonicalize(value[k]); }).join(",") + "}";
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function recordsPayload(knowledge) {
    var picked = {};
    RECORD_KEYS.forEach(function (k) { picked[k] = knowledge[k] || []; });
    return canonicalize(picked);
  }

  function recordCounts(knowledge) {
    var counts = {};
    RECORD_KEYS.forEach(function (k) { counts[k] = (knowledge[k] || []).length; });
    return counts;
  }

  var api = {
    RECORD_KEYS: RECORD_KEYS,
    canonicalize: canonicalize,
    recordsPayload: recordsPayload,
    recordCounts: recordCounts
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.VHDIntegrity = api;
  }
})(typeof window !== "undefined" ? window : this);
