(() => {
  const { languages, createTranslator } = window.chatI18nCore;
  // English is the default interface language; a language chosen with the
  // picker is remembered in this browser.
  // An embedding page can choose the language with ?lang=nl (remembered).
  let current = "en";
  const requested = new URLSearchParams(location.search).get("lang");
  try {
    if (languages.includes(requested)) localStorage.setItem("8star-language", requested);
    current = localStorage.getItem("8star-language") || "en";
  } catch {
    current = languages.includes(requested) ? requested : "en";
  }
  if (!languages.includes(current)) current = "en";
  let translateCurrent = createTranslator(current);
  const originalText = new WeakMap();
  const originalAttrs = new WeakMap();
  const attrNames = ["placeholder", "aria-label", "title", "alt"];
  const translate = (value) => translateCurrent(value);
  const skipText = (node) =>
    node.parentElement?.closest(
      "[data-user-content], .bubble p, .private-line p, .pinned-bubble p, .question > p, .stage-question, .stage-select > span:not(.pill), .brand",
    );
  const translateTextNode = (node) => {
    if (skipText(node)) return;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    const next = translate(originalText.get(node));
    if (node.nodeValue !== next) node.nodeValue = next;
  };
  const translateElement = (element) => {
    if (!(element instanceof Element)) return;
    if (!originalAttrs.has(element)) originalAttrs.set(element, {});
    const saved = originalAttrs.get(element);
    for (const name of attrNames) {
      if (!element.hasAttribute(name)) continue;
      if (!(name in saved)) saved[name] = element.getAttribute(name);
      const next = translate(saved[name]);
      if (element.getAttribute(name) !== next) element.setAttribute(name, next);
    }
  };
  const translateTree = (root) => {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) return translateTextNode(root);
    if (root.nodeType === Node.ELEMENT_NODE) translateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    if (root.nodeType === Node.ELEMENT_NODE) root.querySelectorAll("*").forEach(translateElement);
  };
  const apply = () => {
    document.documentElement.lang = current;
    translateTree(document.body);
    document.querySelectorAll("#locale-select").forEach((select) => {
      select.value = current;
    });
  };
  const picker = () =>
    '<label class="locale-switch"><span>Interface language</span><select id="locale-select" aria-label="Interface language">' +
    [
      ["nl", "Nederlands"],
      ["de", "Deutsch"],
      ["fr", "Français"],
      ["en", "English"],
    ]
      .map(
        ([code, label]) =>
          '<option value="' + code + '"' + (code === current ? " selected" : "") + ">" + label + "</option>",
      )
      .join("") +
    "</select></label>";
  document.addEventListener("change", (event) => {
    if (event.target?.id !== "locale-select") return;
    current = languages.includes(event.target.value) ? event.target.value : "en";
    translateCurrent = createTranslator(current);
    try {
      localStorage.setItem("8star-language", current);
    } catch {}
    apply();
  });
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(translateTree);
      else if (record.type === "characterData") translateTextNode(record.target);
      else if (record.type === "attributes") translateElement(record.target);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: attrNames,
  });
  window.chatI18n = {
    picker,
    translate,
    get language() {
      return current;
    },
    text(key) {
      return translate(key);
    },
  };
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (message) => nativeAlert(translate(message));
  window.confirm = (message) => nativeConfirm(translate(message));
  apply();
})();
