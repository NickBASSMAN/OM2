// Background script for Online Modeli
const actionApi = browser.action || browser.browserAction;
const {
  buildModelId,
  normalizeModelIdentity,
  normalizeModelStatus
} = globalThis.OnlineModeli.sites;
const siteAdapters = globalThis.OnlineModeli.backgroundAdapters;
const bongaApi = globalThis.OnlineModeli.bongaApi || {};

let updateAllInFlight = null;
let updateAllQueued = false;

function getSiteAdapter(site) {
  return siteAdapters[site] || null;
}

async function updateModelStatus(model) {
  const adapter = getSiteAdapter(model?.site);
  if (!adapter?.updateModel) return model;
  return adapter.updateModel(model);
}

async function enrichModelsBasic(models) {
  return Promise.all((models || []).map(async (model) => {
    const adapter = getSiteAdapter(model?.site);
    if (!adapter?.enrichModelBasic) return model;
    return adapter.enrichModelBasic(model);
  }));
}

async function enrichOnlineModels(models) {
  let nextModels = models;

  for (const adapter of Object.values(siteAdapters)) {
    if (adapter?.enrichOnlineModels) {
      nextModels = await adapter.enrichOnlineModels(nextModels);
    }
  }

  return nextModels;
}

function getModelsIdentityKey(models) {
  return (models || []).map((model) => model?.id || "").join("|");
}

async function performUpdateAllModelsOnce() {
  const startData = await browser.storage.local.get("models");
  const startModels = (startData.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);
  const startKey = getModelsIdentityKey(startModels);

  const phaseOneModels = await enrichModelsBasic(startModels);

  const latestData = await browser.storage.local.get("models");
  const latestModels = (latestData.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);
  const latestKey = getModelsIdentityKey(latestModels);

  if (latestKey !== startKey) {
    return { skipped: true, reason: "models_changed" };
  }

  await browser.storage.local.set({ models: phaseOneModels });

  const phaseTwoModels = await enrichOnlineModels(phaseOneModels);
  const latestAfterPhaseOneData = await browser.storage.local.get("models");
  const latestAfterPhaseOneModels = (latestAfterPhaseOneData.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);
  const latestAfterPhaseOneKey = getModelsIdentityKey(latestAfterPhaseOneModels);

  if (latestAfterPhaseOneKey !== startKey) {
    return { updated: true, phaseOneOnly: true, count: phaseOneModels.length };
  }

  await browser.storage.local.set({ models: phaseTwoModels });
  return { updated: true, count: phaseTwoModels.length };
}

async function runUpdateAllQueue() {
  if (updateAllInFlight) {
    updateAllQueued = true;
    return updateAllInFlight;
  }

  updateAllInFlight = (async () => {
    do {
      updateAllQueued = false;
      await performUpdateAllModelsOnce();
    } while (updateAllQueued);
  })();

  try {
    await updateAllInFlight;
  } finally {
    updateAllInFlight = null;
  }
}

async function updateOnlineBadge() {
  if (!actionApi?.setBadgeText) return;

  try {
    const data = await browser.storage.local.get("models");
    const models = data.models || [];
    const onlineCount = models.filter((model) => model?.status?.online === true).length;

    await actionApi.setBadgeText({
      text: onlineCount > 0 ? String(onlineCount) : ""
    });

    if (actionApi.setBadgeBackgroundColor) {
      await actionApi.setBadgeBackgroundColor({ color: "#d32f2f" });
    }
  } catch (error) {
    console.error("Failed to update badge:", error);
  }
}

async function updateModelFromContentMessage(message) {
  const { site, username } = message;
  const modelId = message.modelId || buildModelId(site, username);
  const data = await browser.storage.local.get("models");
  const models = (data.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);
  const model = models.find((item) => item.id === modelId);

  if (!model) return;

  const thumbnailUrl = sanitizeModelMediaUrl(message.thumbnailUrl);
  const previewUrl = sanitizeModelMediaUrl(message.previewUrl);
  model.thumbnailUrl = thumbnailUrl || model.thumbnailUrl;
  model.previewUrl = previewUrl || model.previewUrl;
  model.status = normalizeModelStatus(model.status, message);
  await browser.storage.local.set({ models });
}

function sanitizeModelMediaUrl(url) {
  if (!url || typeof url !== "string") return "";

  const value = url.toLowerCase();
  if (
    value.includes("/sprite/") ||
    value.includes("model_flags_atlas") ||
    value.includes(".svg") ||
    value.startsWith("data:image/svg")
  ) {
    return "";
  }

  return url;
}

function exportModelsFile(message, sendResponse) {
  const filename = typeof message.filename === "string" && message.filename
    ? message.filename
    : "models.json";
  const content = typeof message.content === "string" ? message.content : "[]";
  const safeFilename = filename.replace(/[\\/:*?"<>|]/g, "_");
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);

  browser.downloads.download({
    url: downloadUrl,
    filename: safeFilename,
    saveAs: true,
    conflictAction: "uniquify"
  }).then((downloadId) => {
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
    sendResponse({ success: true, downloadId });
  }).catch((error) => {
    URL.revokeObjectURL(downloadUrl);
    console.error("Export download failed:", error);
    sendResponse({ success: false, error: error.message || "Download API rejected blob URL" });
  });
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "MODEL_STATUS_UPDATE") {
    updateModelFromContentMessage(message).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error("Error updating model status from content script:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === "REQUEST_UPDATE_ALL_MODELS") {
    runUpdateAllQueue().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error("Error updating all models:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === "REQUEST_UPDATE_MODEL") {
    browser.storage.local.get("models").then((data) => {
      const models = (data.models || [])
        .map(normalizeModelIdentity)
        .filter(Boolean);
      const index = models.findIndex((model) => model.id === message.modelId);

      if (index === -1) return null;

      return updateModelStatus(models[index]).then((updatedModel) => {
        models[index] = updatedModel;
        return browser.storage.local.set({ models });
      });
    }).then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error("Error updating model:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (message.type === "EXPORT_MODELS_FILE") {
    exportModelsFile(message, sendResponse);
    return true;
  }

  if (message.type === "FETCH_MODELS") {
    if (!bongaApi.fetchBongaModels) {
      sendResponse({ ok: false, error: "Bonga API is unavailable" });
      return false;
    }

    const options = Array.isArray(message.usernames)
      ? { usernames: message.usernames }
      : (message.username ? { usernames: [message.username] } : {});

    bongaApi.fetchBongaModels(options).then((data) => {
      sendResponse({ ok: true, data });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  if (message.type === "FETCH_ROOM") {
    if (!bongaApi.fetchBongaRoomData) {
      sendResponse({ ok: false, error: "Bonga API is unavailable" });
      return false;
    }

    bongaApi.fetchBongaRoomData(message.username).then((sessionTs) => {
      sendResponse({ ok: true, sessionTs });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  return false;
});

async function runPeriodicModelsUpdate() {
  try {
    await runUpdateAllQueue();
    console.log("Finished periodic models update");
  } catch (error) {
    console.error("Error in periodic models update:", error);
  }
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.models) {
    updateOnlineBadge();
  }
});

if (browser.alarms?.create) {
  browser.alarms.create("updateModels", { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "updateModels") {
      runPeriodicModelsUpdate();
    }
  });
} else {
  setInterval(runPeriodicModelsUpdate, 5 * 60 * 1000);
}

browser.runtime.onInstalled.addListener(() => {
  console.log("Online Modeli installed");
  updateOnlineBadge();
});
