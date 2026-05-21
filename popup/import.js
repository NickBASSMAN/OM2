const fileInput = document.getElementById("fileInput");
const importBtn = document.getElementById("importBtn");
const statusEl = document.getElementById("status");
const { normalizeImportedModels } = globalThis.OnlineModeli.modelIo;

importBtn.addEventListener("click", importModelsFile);

async function importModelsFile() {
  setStatus("", "");

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    setStatus("Choose a JSON file first.", "error");
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedModels = normalizeImportedModels(parsed);

    await browser.storage.local.set({ models: importedModels });
    requestUpdateAllModels();

    setStatus(`Imported ${importedModels.length} model(s).`, "ok");
    await closeCurrentTabAfterDelay(1500);
  } catch (error) {
    console.error("Import failed:", error);
    setStatus(`Import failed: ${error?.message || "invalid JSON format"}.`, "error");
  }
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status${cls ? ` ${cls}` : ""}`;
}

function requestUpdateAllModels() {
  browser.runtime.sendMessage({
    type: "REQUEST_UPDATE_ALL_MODELS",
    force: true,
    reason: "import"
  }).catch((error) => {
    console.error("Failed to request model updates:", error);
  });
}

async function closeCurrentTabAfterDelay(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  try {
    const currentTab = await browser.tabs.getCurrent();
    if (currentTab?.id) {
      await browser.tabs.remove(currentTab.id);
    }
  } catch (error) {
    console.error("Failed to close import tab:", error);
  }
}
