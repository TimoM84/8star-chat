#!/usr/bin/env node
"use strict";
// Checks the interface translations:
//  1. every row has an English key plus Dutch, German and French text;
//  2. no duplicate keys, no empty or untranslated cells (except a short
//     allow-list of words that are the same in that language);
//  3. every user-facing text in the client and every error message sent by
//     the server has a translation ("missing");
//  4. every key is still used somewhere ("unused").
// Exit code 1 when a problem is found. Run: npm run check:i18n
const fs = require("node:fs");
const path = require("node:path");
const { rows, languages, createTranslator } = require("../public/i18n-core.js");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const sources = {
  "public/app.js": read("public/app.js"),
  "public/i18n.js": read("public/i18n.js"),
  "public/index.html": read("public/index.html"),
  "server.js": read("server.js"),
};

// Words that are legitimately identical in a language.
const SAME_ALLOWED = {
  nl: ["Dashboard", "Open", "Moderator", "Inbox", "Team", "Nederlands", "English", "Deutsch", "Français"],
  de: ["Moderator", "Name", "Limit", "Team", "Nederlands", "English", "Deutsch", "Français"],
  fr: [
    "Question",
    "Public",
    "Page",
    "conversations",
    "messages",
    "participants",
    "Nederlands",
    "English",
    "Deutsch",
    "Français",
  ],
};
// Texts in the client that are not interface language (brand, symbols, examples).
// "Guest" and "Attendee" are fallback display names (user content).
const IGNORE_TEXT = new Set([
  "Guest",
  "Attendee",
  "8star",
  "8star Chat",
  "Chat",
  "8",
  "English",
  "Nederlands",
  "Deutsch",
  "Français",
  "https://client.example.com/logo.png",
  "Delta works, Infrastructure",
]);

function checkRows() {
  const problems = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== languages.length)
      problems.push("Row " + i + " must have " + languages.length + " columns: " + JSON.stringify(row));
    const [key] = row;
    if (seen.has(key)) problems.push("Duplicate key: " + JSON.stringify(key));
    seen.add(key);
    languages.forEach((lang, col) => {
      const value = row[col];
      if (typeof value !== "string" || !value.trim())
        problems.push("Empty " + lang + " text for " + JSON.stringify(key));
      if (col > 0 && value === key && !(SAME_ALLOWED[lang] || []).includes(key))
        problems.push("Untranslated " + lang + " text: " + JSON.stringify(key));
      if (value !== value.trim())
        problems.push("Leading/trailing space in " + lang + " text for " + JSON.stringify(key));
      // Placeholders and trailing punctuation should match the English source.
      const endPunct = (s) => (String(s).match(/[.?!…:]$/) || [""])[0].replace(":", "");
      if (col > 0 && endPunct(key) && endPunct(value) !== endPunct(key) && !/[?]$/.test(key))
        problems.push(
          "Punctuation differs in " + lang + " for " + JSON.stringify(key) + ": " + JSON.stringify(value),
        );
    });
  });
  return problems;
}

// Extract string literals from JavaScript source (good enough for this code base).
function stringLiterals(code) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g;
  let m;
  while ((m = re.exec(code))) out.push((m[1] ?? m[2]).replace(/\\(["'\\])/g, "$1"));
  return out;
}

// User-facing text fragments inside the client code: text between HTML tags,
// translatable attributes, and plain sentences passed to the UI.
function clientTexts() {
  const texts = new Set();
  const code = sources["public/app.js"] + "\n" + sources["public/i18n.js"];
  const html = sources["public/index.html"];
  const addText = (t) => {
    const v = t.replace(/&[a-z]+;|&#\d+;/g, " ").trim();
    if (!v || !/\p{L}{2,}/u.test(v) || IGNORE_TEXT.has(v)) return;
    texts.add(v);
  };
  const scanHtml = (s) => {
    for (const m of s.matchAll(/>([^<>]+)</g)) addText(m[1]);
    for (const m of s.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]+)"/g)) addText(m[1]);
    // Leading text before the first tag and trailing text after the last one.
    const lead = s.match(/^([^<>]+)</);
    if (lead) addText(lead[1]);
    const tail = s.match(/>([^<>]+)$/);
    if (tail) addText(tail[1]);
  };
  scanHtml(html);
  for (const lit of stringLiterals(code)) {
    if (lit.includes("<")) scanHtml(lit);
    // Sentences shown via textContent/alert/confirm or passed as labels.
    else if (/^[A-Z][\p{L}’' ,/().-]*[\p{L}.?!…)]$/u.test(lit) && /\s/.test(lit) && !/[#{}=;$]/.test(lit))
      addText(lit);
    else if (/^[A-Z][a-z]+(?: [a-z]+)*$/.test(lit) && lit.length > 2) addText(lit);
  }
  return [...texts];
}

function serverMessages() {
  return [...sources["server.js"].matchAll(/error:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

// A text counts as translated when the Dutch, German and French translators
// all change it (or it is allowed to stay the same in that language).
function untranslated(text) {
  const failures = [];
  for (const lang of languages.slice(1)) {
    const t = createTranslator(lang)(text);
    if (t === text && !(SAME_ALLOWED[lang] || []).includes(text)) failures.push(lang);
  }
  return failures;
}

function unusedKeys() {
  const all = Object.values(sources).join("\n");
  return rows.map((r) => r[0]).filter((key) => !all.includes(key));
}

function run() {
  const problems = checkRows();
  for (const text of clientTexts()) {
    const langs = untranslated(text);
    if (langs.length)
      problems.push(
        "Missing translation (" + langs.join(", ") + ") for client text: " + JSON.stringify(text),
      );
  }
  for (const text of serverMessages()) {
    const langs = untranslated(text);
    if (langs.length)
      problems.push(
        "Missing translation (" + langs.join(", ") + ") for server message: " + JSON.stringify(text),
      );
  }
  for (const key of unusedKeys()) problems.push("Unused translation key: " + JSON.stringify(key));
  return problems;
}

if (require.main === module) {
  const problems = run();
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error("\n" + problems.length + " translation problem(s).");
    process.exit(1);
  }
  console.log("Translations OK: " + rows.length + " entries in " + languages.join(", ") + ".");
}
module.exports = { run, clientTexts, serverMessages, unusedKeys, checkRows };
