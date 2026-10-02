"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { rows, languages, createTranslator } = require("../public/i18n-core.js");
const { run } = require("../scripts/check-i18n.js");

test("translation table is complete, used and covers all interface texts", () => {
  assert.deepEqual(run(), []);
});

test("each language column is the right language (regression: NL showed German)", () => {
  const t = Object.fromEntries(languages.map((l) => [l, createTranslator(l)]));
  assert.equal(t.en("Sign in"), "Sign in");
  assert.equal(t.nl("Sign in"), "Inloggen");
  assert.equal(t.de("Sign in"), "Anmelden");
  assert.equal(t.fr("Sign in"), "Se connecter");
  assert.equal(t.nl("To moderator"), "Naar moderator");
});

test("translated text is never translated a second time", () => {
  const nl = createTranslator("nl");
  // The Dutch result contains words that are also English keys ("in");
  // translation happens in one pass, so they are left alone.
  assert.equal(nl("Search messages, names and topics…"), "Zoeken in berichten, namen en onderwerpen…");
  assert.equal(nl("Enter a valid email address."), "Vul een geldig e-mailadres in.");
});

test("single words are only replaced as whole words and fragments keep spacing", () => {
  const nl = createTranslator("nl");
  assert.equal(nl("12 connected"), "12 verbonden");
  assert.equal(nl(" 100 participants · "), " 100 deelnemers · ");
  assert.equal(nl("Opener"), "Opener"); // "Open" must not match inside a word
  assert.equal(nl("Page 2 / 3 · 40 conversations"), "Pagina 2 / 3 · 40 gesprekken");
});

test("keys have no surrounding whitespace and are unique", () => {
  const keys = rows.map((r) => r[0]);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.equal(k, k.trim());
});
