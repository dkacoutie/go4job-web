import assert from "node:assert/strict";

import {
  JOB_SUGGESTION_ENTRIES,
  MAX_KEYWORD_SUGGESTIONS,
  hasSuggestionDictionaryIssues,
  suggestExcludedKeywordsFromTitle,
  suggestKeywordsFromTitle,
} from "../src/lib/jobAlertKeywordSuggestions.ts";

const bannedGenericTerms = new Set(["job", "emploi", "offre", "opportunity", "recrutement"]);

assert.equal(hasSuggestionDictionaryIssues().length, 0, hasSuggestionDictionaryIssues().join("\n"));

for (const entry of JOB_SUGGESTION_ENTRIES) {
  assert.ok(entry.keywords.length <= MAX_KEYWORD_SUGGESTIONS, `${entry.id} has too many keywords`);
  for (const keyword of entry.keywords) {
    assert.ok(!bannedGenericTerms.has(keyword.toLowerCase()), `${entry.id} includes generic keyword ${keyword}`);
  }
}

const menuisierKeywords = suggestKeywordsFromTitle("menuisier");
assert.deepEqual(menuisierKeywords.slice(0, 3), ["menuisier", "menuiserie", "ébéniste"]);
assert.ok(menuisierKeywords.length <= MAX_KEYWORD_SUGGESTIONS, "menuisier suggestions exceed scoring-friendly limit");

const commercialKeywords = suggestKeywordsFromTitle("commercial");
assert.ok(commercialKeywords.includes("prospection"), "commercial should include a discriminating sales keyword");
assert.ok(!commercialKeywords.includes("agent"), "commercial should not include weak backend terms");
assert.ok(suggestExcludedKeywordsFromTitle("commercial").includes("immobilier"), "commercial should suggest optional exclusions");

const fallbackKeywords = suggestKeywordsFromTitle("responsable emploi job offre");
assert.deepEqual(fallbackKeywords, [], "generic fallback terms should not become alert keywords");

console.log("job alert keyword suggestions: ok");
