const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("model");
const saved = document.getElementById("saved");

chrome.storage.local.get(["apiKey", "model"]).then((stored) => {
  apiKeyInput.value = stored.apiKey || "";
  modelSelect.value = stored.model || "claude-opus-4-8";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiKey: apiKeyInput.value.trim(),
    model: modelSelect.value,
  });
  saved.textContent = "Saved!";
  setTimeout(() => (saved.textContent = ""), 2000);
});

document.getElementById("clearCache").addEventListener("click", async () => {
  // getKeys() (Chrome 130+) lists keys without loading every cached page's
  // full HTML; fall back to get(null) on older Chrome.
  const keys = chrome.storage.local.getKeys
    ? await chrome.storage.local.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  // The LRU index (cache::__index) is bookkeeping, not a page — clear it too
  // but don't count it.
  const cacheKeys = keys.filter(
    (k) => k.startsWith("cache::") && k !== "cache::__index",
  );
  await chrome.storage.local.remove([...cacheKeys, "cache::__index"]);
  saved.textContent = `Cleared ${cacheKeys.length} cached page(s).`;
  setTimeout(() => (saved.textContent = ""), 3000);
});
