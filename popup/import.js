const fileInput = document.getElementById("fileInput");
const importBtn = document.getElementById("importBtn");
const statusEl = document.getElementById("status");
const {
  buildModelId,
  defaultProfileUrl,
  getCleanString,
  getPersonIdFromModel,
  inferSiteFromUrl,
  normalizeModelIdentity,
  parseModelFromUrl
} = globalThis.OnlineModeli.sites;

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
    const rawModels = Array.isArray(parsed) ? parsed : parsed?.models;

    if (!Array.isArray(rawModels)) {
      throw new Error("JSON must be an array or an object with a models array");
    }

    const normalized = rawModels
      .map((model, index) => normalizeImportedModel(model, index))
      .filter(Boolean);

    if (!normalized.length) {
      throw new Error("No valid model entries found");
    }

    await browser.storage.local.set({ models: dedupeModelsById(normalized) });
    await browser.runtime.sendMessage({ type: "REQUEST_UPDATE_ALL_MODELS" });

    setStatus(`Imported ${normalized.length} model(s).`, "ok");
    await closeCurrentTabAfterDelay(250);
  } catch (error) {
    console.error("Import failed:", error);
    setStatus(`Import failed: ${error?.message || "invalid JSON format"}.`, "error");
  }
}

function normalizeImportedModel(model, index = 0) {
  if (!model || typeof model !== "object") return null;
  const identity = resolveImportedIdentity(model);
  if (!identity) return null;

  const { site, username, roomUrl, id, personId, displayName } = identity;
  const lastOnlineAt = getCleanString(
    model.lastOnlineAt || model.last_broadcast || model.status?.lastBroadcast
  );

  return {
    id,
    site,
    username,
    ...(personId ? { personId } : {}),
    displayName,
    addedAt: resolveAddedAt(model, index),
    profileUrl: roomUrl,
    thumbnailUrl: "",
    status: {
      online: false,
      showType: "offline",
      viewers: 0,
      startDtUtc: null,
      startTimestamp: null,
      roomStatus: "offline",
      lastBroadcast: lastOnlineAt || null,
      timeSinceLastBroadcast: null
    }
  };
}

function resolveAddedAt(model, index) {
  const existing = Number(model?.addedAt);
  if (Number.isFinite(existing) && existing > 0) return existing;

  // Preserve import order: first entries are treated as newer.
  return Date.now() - (index * 1000);
}

function resolveImportedIdentity(model) {
  const roomUrl = getCleanString(model.roomUrl || model.profileUrl || model.url);
  if (!roomUrl) return null; // required

  const parsedFromUrl = parseModelFromUrl(roomUrl);
  const username = getCleanString(model.username || model.userName) || parsedFromUrl?.username || "";
  if (!username) return null; // required

  const siteFromField = getCleanString(model.site);
  const site = siteFromField || parsedFromUrl?.site || inferSiteFromUrl(roomUrl) || "unknown";
  const id = buildModelId(site, username);
  const profileUrl = roomUrl || defaultProfileUrl(site, username);
  const personId = getPersonIdFromModel(model);
  const displayName = getCleanString(model.displayName) || username;

  return { site, username, roomUrl: profileUrl, id, personId, displayName };
}

function dedupeModelsById(models) {
  const map = new Map();
  models.forEach((model) => {
    const normalized = normalizeModelIdentity(model);
    if (normalized) map.set(normalized.id, normalized);
  });
  return [...map.values()];
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = `status${cls ? ` ${cls}` : ""}`;
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
