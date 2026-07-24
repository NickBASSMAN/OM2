(function (global) {
  const {
    buildModelId,
    createModelFromIdentity,
    normalizeLinkedRoomIdentity,
    normalizeModelIdentity,
    parseModelFromUrl
  } = global.OnlineModeli.sites;
  const { buildExportPayload, parseImportedModelsText } = global.OnlineModeli.modelIo;
  const MODEL_DATA_TIMEOUT_MS = 1200;

  function renderModels() {
    return global.OnlineModeli.popupRendering.renderModels();
  }

  async function addCurrentModel() {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) return;

    const parsed = parseModelFromUrl(tab.url);
    if (!parsed) return;

    const data = await browser.storage.local.get("models");
    const models = (data.models || []).map(normalizeModelIdentity).filter(Boolean);
    if (models.some((model) => model.id === buildModelId(parsed.site, parsed.username))) return;

    const modelData = await getCurrentRoomModelData(tab.id, parsed, "model");
    const model = createModelFromIdentity(parsed, modelData);
    if (!model) return;

    model.previewUrl = getInitialPreviewUrl(model, modelData);
    models.push(model);
    await browser.storage.local.set({ models });
    await renderModels();
    await updateModelAndRender(model.id, "Failed to update new model status:");
  }

  async function addCurrentRoomLinkToModel(modelId) {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url) return;

    const parsed = parseModelFromUrl(tab.url);
    if (!parsed) return;

    const data = await browser.storage.local.get("models");
    const models = (data.models || []).map(normalizeModelIdentity).filter(Boolean);
    const index = models.findIndex((model) => model.id === modelId);
    if (index === -1) return;

    const model = models[index];
    const roomId = buildModelId(parsed.site, parsed.username);
    if (model.id === roomId || (model.linkedRooms || []).some((room) => room.id === roomId)) return;

    const modelData = await getCurrentRoomModelData(tab.id, parsed, "linked room");
    const linkedRoom = normalizeLinkedRoomIdentity({
      id: roomId,
      site: parsed.site,
      username: parsed.username,
      profileUrl: parsed.url,
      displayName: parsed.username,
      thumbnailUrl: modelData.thumbnailUrl || "",
      previewUrl: getInitialPreviewUrl({ site: parsed.site, thumbnailUrl: modelData.thumbnailUrl || "" }, modelData),
      status: {
        online: Boolean(modelData.online),
        showType: modelData.showType || modelData.roomStatus || "offline",
        roomStatus: modelData.roomStatus || modelData.showType || "offline",
        viewers: Number(modelData.viewers) || 0,
        startDtUtc: modelData.startDtUtc || null,
        startTimestamp: modelData.startTimestamp || null,
        lastBroadcast: modelData.lastBroadcast || null,
        timeSinceLastBroadcast: modelData.timeSinceLastBroadcast || null
      }
    });
    if (!linkedRoom) return;

    model.linkedRooms = [...(model.linkedRooms || []), linkedRoom];
    await browser.storage.local.set({ models });
    await renderModels();
    await updateModelAndRender(model.id, "Failed to update model after adding linked room:");
  }

  async function deleteModel(modelId) {
    const data = await browser.storage.local.get("models");
    const models = (data.models || []).map(normalizeModelIdentity).filter(Boolean);
    await browser.storage.local.set({ models: models.filter((model) => model.id !== modelId) });
    await requestUpdateAllModels();
    await renderModels();
  }

  async function updateModelAndRender(modelId, errorMessage) {
    try {
      const response = await browser.runtime.sendMessage({ type: "REQUEST_UPDATE_MODEL", modelId });
      if (response?.success) await renderModels();
    } catch (error) {
      console.error(errorMessage, error);
    }
  }

  async function getCurrentRoomModelData(tabId, parsed, label = "model") {
    const fallback = createOfflineModelData(parsed);
    try {
      const response = await withTimeout(
        browser.tabs.sendMessage(tabId, { type: "GET_MODEL_DATA" }),
        MODEL_DATA_TIMEOUT_MS
      );
      if (!response || typeof response !== "object") return fallback;

      return {
        ...fallback,
        ...response,
        site: response.site || parsed.site,
        username: response.username || parsed.username,
        online: Boolean(response.online)
      };
    } catch (error) {
      console.error(`Failed to get ${label} data from content script:`, error);
      return fallback;
    }
  }

  function createOfflineModelData(parsed) {
    return {
      site: parsed.site,
      username: parsed.username,
      online: false,
      showType: "offline",
      roomStatus: "offline",
      thumbnailUrl: "",
      previewUrl: "",
      viewers: 0,
      startDtUtc: null,
      startTimestamp: null,
      lastBroadcast: null,
      timeSinceLastBroadcast: null
    };
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("Timed out while reading room data")), timeoutMs);
      Promise.resolve(promise).then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      }).catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  function getInitialPreviewUrl(model, modelData = {}) {
    const previewUrl = typeof modelData.previewUrl === "string" ? modelData.previewUrl : "";
    if (previewUrl) return previewUrl;
    return model.site === "chaturbate" ? model.thumbnailUrl || "" : "";
  }

  async function requestUpdateAllModels(options = {}) {
    try {
      const response = await browser.runtime.sendMessage({
        type: "REQUEST_UPDATE_ALL_MODELS",
        force: Boolean(options.force),
        reason: options.reason || ""
      });
      if (!response?.success) console.warn("Update all models request failed", response?.error);
    } catch (error) {
      console.error("Failed to request model updates:", error);
    }
  }

  async function importModelsFromJson() {
    const file = await pickJsonFile();
    if (!file) return;
    try {
      const importedModels = parseImportedModelsText(await file.text());
      await browser.storage.local.set({ models: importedModels });
      await renderModels();
      await requestUpdateAllModels({ force: true, reason: "import" });
    } catch (error) {
      console.warn("Import skipped:", error);
      alert(`Import failed: ${error?.message || "invalid JSON format"}.`);
    }
  }

  function openImportPage() {
    browser.tabs.create({ url: browser.runtime.getURL("popup/import.html") });
  }

  async function exportModelsToJson() {
    try {
      const data = await browser.storage.local.get("models");
      const models = (data.models || []).map(normalizeModelIdentity).filter(Boolean);
      const response = await browser.runtime.sendMessage({
        type: "EXPORT_MODELS_FILE",
        filename: `models-${getTimestampForFilename()}.json`,
        content: JSON.stringify(buildExportPayload(models), null, 2)
      });
      if (!response?.success) throw new Error(response?.error || "Unknown export error");
    } catch (error) {
      console.error("Export failed:", error);
      const message = String(error?.message || "unknown error").split("\n")[0].slice(0, 220);
      alert(`Export failed: ${message}.`);
    }
  }

  function pickJsonFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
      input.click();
    });
  }

  function getTimestampForFilename() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return `${yyyy}${mm}${dd}-${hh}${min}`;
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    popupActions: {
      addCurrentModel,
      addCurrentRoomLinkToModel,
      deleteModel,
      exportModelsToJson,
      openImportPage,
      requestUpdateAllModels
    }
  };
})(globalThis);
