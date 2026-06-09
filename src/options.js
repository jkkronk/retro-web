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
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith("cache::"));
  await chrome.storage.local.remove(cacheKeys);
  saved.textContent = `Cleared ${cacheKeys.length} cached page(s).`;
  setTimeout(() => (saved.textContent = ""), 3000);
});
