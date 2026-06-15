const status = document.getElementById("status");

document.getElementById("retrofy").addEventListener("click", async () => {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    status.textContent = "Set your API key in Options first.";
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    status.textContent = "Can't retro-fy this page.";
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/extract.js", "src/content.js"],
    });
    window.close();
  } catch (err) {
    status.textContent = "Injection failed: " + err.message;
  }
});

document.getElementById("options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
