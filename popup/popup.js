const container = document.getElementById("models");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const addBtn = document.getElementById("addModelBtn");
const refreshBtn = document.getElementById("refreshBtn");
const previewPlayer = document.getElementById("previewPlayer");
const {
  buildModelId,
  buildChaturbateJpegPreviewUrl,
  createModelFromIdentity,
  defaultProfileUrl,
  getCleanString,
  getPersonIdFromModel,
  inferSiteFromUrl,
  normalizeLinkedRoomIdentity,
  normalizeModelIdentity,
  parseModelFromUrl
} = globalThis.OnlineModeli.sites;

init();

async function init() {
  importBtn.addEventListener("click", openImportPage);
  exportBtn.addEventListener("click", exportModelsToJson);
  addBtn.addEventListener("click", addCurrentModel);
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    await requestUpdateAllModels();
    await renderModels();
    refreshBtn.disabled = false;
  });

  browser.storage.onChanged.addListener(handleStorageChange);

  if (previewPlayer) {
    previewPlayer.addEventListener("mouseleave", () => {
      const player = new ImagePlayer();
      if (player) player.destroy();
    });

    previewPlayer.addEventListener("click", (event) => {
      event.stopPropagation();
      const href = previewPlayer.dataset.href;
      if (href) browser.tabs.create({ url: href });
    });
  }

  await renderModels();

  // Request update of all models when popup opens.
  // The UI will re-render from storage.onChanged when background writes fresh data.
  requestUpdateAllModels();
}

function handleStorageChange(changes, areaName) {
  if (areaName === "local" && changes.models) {
    renderModels();
  }
}

// ================= RENDER =================

async function renderModels() {
  const data = await browser.storage.local.get("models");
  const models = (data.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);

  container.innerHTML = "";

  if (!models.length) {
    container.innerHTML = "<div>No models</div>";
    return;
  }

  sortModelsForDisplay(models).forEach(renderModel);
}

function sortModelsForDisplay(models) {
  const list = [...models];
  const hasOnline = list.some((model) => model?.status?.online === true);
  const byAddedDesc = (a, b) => getAddedAt(b) - getAddedAt(a);

  if (!hasOnline) {
    return list.sort(byAddedDesc);
  }

  return list.sort((a, b) => {
    const aOnline = a?.status?.online === true ? 1 : 0;
    const bOnline = b?.status?.online === true ? 1 : 0;
    if (aOnline !== bOnline) return bOnline - aOnline;
    return byAddedDesc(a, b);
  });
}

function getAddedAt(model) {
  const value = Number(model?.addedAt);
  return Number.isFinite(value) ? value : 0;
}

function renderModel(model) {
  const el = document.createElement("div");
  el.className = "model";

  const roomStatus = (model.status?.roomStatus || model.status?.showType || "").toLowerCase();
  const isPrivate = roomStatus === "private";
  const isPassword = roomStatus === "password";

  if (isPrivate) {
    el.classList.add("privateModel");
  }

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "thumbWrap";

  const img = document.createElement("img");
  img.className = "thumb";

  const fallback = browser.runtime.getURL("icons/offline.jpg");

  img.src = getSafeMediaUrl(model.thumbnailUrl) || fallback;

  img.onerror = () => {
    img.onerror = null;
    img.src = fallback;
  };

  const previewUrl = getModelPreviewUrl(model);
  if (previewUrl) {
    thumbWrap.classList.add("previewEnabled");
    thumbWrap.addEventListener("mouseenter", (event) => {
      event.stopPropagation();
      startPreviewPlayer(model, thumbWrap, previewUrl);
    });
  }

  thumbWrap.appendChild(img);

  if (isPrivate || isPassword) {
    const overlay = document.createElement("div");
    overlay.className = isPassword ? "thumbPasswordOverlay" : "thumbPrivateOverlay";
    thumbWrap.appendChild(overlay);
  }

  const info = document.createElement("div");
  info.className = "info";

  const name = document.createElement("div");
  name.className = "name" + (isPrivate ? " privateName" : "");

  const username = document.createElement("span");
  username.textContent = model.username;
  name.appendChild(username);

  const roomIcons = document.createElement("span");
  roomIcons.className = "roomIcons";
  getModelRooms(model).forEach((room) => {
    roomIcons.appendChild(createRoomIcon(room));
  });
  name.appendChild(roomIcons);

  const status = document.createElement("div");
  const showType = model.status?.roomStatus || model.status?.showType;
  const isOnline = model.status?.online;
  const statusClass = isPassword ? "password" : (isOnline ? "online" : "offline");
  status.className = "status " + statusClass;

  if (isPassword) {
    status.textContent = `PASSWORD (${model.status.viewers || 0})`;
  } else if (isOnline) {
    status.textContent = showType
      ? `${showType.toUpperCase()} (${model.status.viewers || 0})`
      : `ONLINE (${model.status.viewers || 0})`;
  } else {
    status.textContent = "OFFLINE";
  }

  const streamTime = document.createElement("div");
  streamTime.className = "streamTime";
  streamTime.textContent = formatStreamTime(model.status);

  const statusRow = document.createElement("div");
  statusRow.className = "statusRow";
  statusRow.appendChild(status);
  statusRow.appendChild(streamTime);

  info.appendChild(name);
  info.appendChild(statusRow);

  const addLinkBtn = document.createElement("button");
  addLinkBtn.className = "addLinkBtn";
  addLinkBtn.title = "Add current room link to this model";
  addLinkBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await addCurrentRoomLinkToModel(model.id);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "deleteBtn";
  deleteBtn.title = "Delete model";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation(); // prevent opening profile
    const data = await browser.storage.local.get("models");
    const models = (data.models || [])
      .map(normalizeModelIdentity)
      .filter(Boolean);
    const filtered = models.filter(m => m.id !== model.id);
    await browser.storage.local.set({ models: filtered });
    await requestUpdateAllModels();
    await renderModels();
  });

  el.appendChild(thumbWrap);
  el.appendChild(info);
  el.appendChild(addLinkBtn);
  el.appendChild(deleteBtn);

  el.addEventListener("click", () => {
    browser.tabs.create({ url: model.profileUrl });
  });

  container.appendChild(el);
}

function getModelRooms(model) {
  return [
    {
      ...model,
      status: model.primaryRoomStatus || model.status
    },
    ...(model.linkedRooms || [])
      .map(normalizeLinkedRoomIdentity)
      .filter(Boolean)
  ];
}

function createRoomIcon(room) {
  const siteIcon = document.createElement("span");
  const siteStatusClass = getSiteIconStatusClass(room.status);
  siteIcon.className = [
    "siteIcon",
    `siteIcon-${room.site || "unknown"}`,
    siteStatusClass
  ].filter(Boolean).join(" ");
  siteIcon.title = `${room.site || ""}: ${room.username || ""} - ${getRoomStatusLabel(room.status)}`;
  siteIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    if (room.profileUrl) browser.tabs.create({ url: room.profileUrl });
  });
  return siteIcon;
}

function getRoomStatusLabel(status) {
  if (!status?.online) return "offline";
  const roomStatus = status.roomStatus || status.showType || "online";
  const viewers = Number(status.viewers) || 0;
  return `${roomStatus} (${viewers})`;
}

function getModelPreviewUrl(model) {
  const roomStatus = (model.status?.roomStatus || model.status?.showType || "").toLowerCase();
  const isPublicOnline = model.status?.online === true && (!roomStatus || roomStatus === "public");
  if (!isPublicOnline) return "";

  if (model.site === "chaturbate") {
    return buildChaturbateJpegPreviewUrl(model.username)
      || getSafeMediaUrl(model.previewUrl)
      || getSafeMediaUrl(model.thumbnailUrl);
  }

  return getSafeMediaUrl(model.previewUrl);
}

function getSafeMediaUrl(url) {
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

function startPreviewPlayer(model, anchor, previewUrl) {
  if (!previewPlayer || typeof ImagePlayer !== "function") return;

  const rect = anchor.getBoundingClientRect();
  const width = Math.max(160, document.body.clientWidth - 6);
  const estimatedHeight = Math.round(width * 9 / 16);
  const top = Math.max(3, Math.min(rect.top - 1, window.innerHeight - estimatedHeight - 3));

  previewPlayer.style.top = `${top}px`;
  previewPlayer.style.left = "3px";
  previewPlayer.style.width = `${width}px`;
  previewPlayer.dataset.href = model.profileUrl || "";

  new ImagePlayer({
    title: model.displayName || model.username,
    url: previewUrl,
    vbox: previewPlayer,
    width
  });
}

function getSiteIconStatusClass(status) {
  const roomStatus = (status?.roomStatus || status?.showType || "").toLowerCase();
  if (roomStatus === "offline" || status?.online === false) return "";
  if (roomStatus && roomStatus !== "public") return "siteIconBusy";
  if (roomStatus === "public" || status?.online === true) return "siteIconOnline";
  return "";
}

function formatStreamTime(status) {
  if (!status) return "--.--.-- --:--";

  if (status.online === false && status.timeSinceLastBroadcast) {
    return String(status.timeSinceLastBroadcast);
  }

  const timestamp = status.online
    ? (parseUtcDate(status.startDtUtc) || parseUnixSeconds(status.startTimestamp) || parseUtcDate(status.lastBroadcast))
    : (parseUtcDate(status.lastBroadcast) || parseUnixSeconds(status.startTimestamp));

  if (!timestamp) return "--.--.-- --:--";

  return formatDateInUtcPlus2(timestamp);
}

function parseUtcDate(isoString) {
  if (!isoString) return null;
  const time = Date.parse(isoString);
  return Number.isNaN(time) ? null : time;
}

function parseUnixSeconds(seconds) {
  if (!seconds) return null;
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric)) return null;
  return numeric * 1000;
}

function formatDateInUtcPlus2(timestampMs) {
  const date = new Date(timestampMs);
  const formatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Etc/GMT-2", // Fixed UTC+2
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    map[part.type] = part.value;
  });

  return `${map.day}.${map.month}.${map.year} ${map.hour}:${map.minute}`;
}

// ================= ADD =================

async function addCurrentModel() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];
  if (!tab?.url) return;

  const parsed = parseModelFromUrl(tab.url);
  if (!parsed) return;

  const data = await browser.storage.local.get("models");
  const models = (data.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);

  if (models.some(m => m.id === buildModelId(parsed.site, parsed.username))) return;

  // Request model data from content script
  let modelData = null;
  try {
    modelData = await browser.tabs.sendMessage(tab.id, {
      type: "GET_MODEL_DATA"
    });
  } catch (error) {
    console.error("Failed to get model data from content script:", error);
    // Fallback to basic data if content script communication fails
    modelData = {
      site: parsed.site,
      username: parsed.username,
      online: false,
      thumbnailUrl: "",
      previewUrl: "",
      viewers: 0
    };
  }

  const model = createModelFromIdentity(parsed, modelData);
  if (!model) return;
  model.previewUrl = getInitialPreviewUrl(model, modelData);

  models.push(model);

  await browser.storage.local.set({ models });
  await renderModels();

  // Update status for the newly added model only
  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_UPDATE_MODEL",
      modelId: model.id
    });
    if (response?.success) {
      await renderModels();
    }
  } catch (error) {
    console.error("Failed to update new model status:", error);
  }
}

async function addCurrentRoomLinkToModel(modelId) {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  const tab = tabs[0];
  if (!tab?.url) return;

  const parsed = parseModelFromUrl(tab.url);
  if (!parsed) return;

  const data = await browser.storage.local.get("models");
  const models = (data.models || [])
    .map(normalizeModelIdentity)
    .filter(Boolean);
  const index = models.findIndex((model) => model.id === modelId);
  if (index === -1) return;

  const model = models[index];
  const roomId = buildModelId(parsed.site, parsed.username);
  if (model.id === roomId || (model.linkedRooms || []).some((room) => room.id === roomId)) {
    return;
  }

  let modelData = null;
  try {
    modelData = await browser.tabs.sendMessage(tab.id, {
      type: "GET_MODEL_DATA"
    });
  } catch (error) {
    console.error("Failed to get linked room data from content script:", error);
    modelData = {
      site: parsed.site,
      username: parsed.username,
      online: false,
      thumbnailUrl: "",
      previewUrl: "",
      viewers: 0
    };
  }

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

  model.linkedRooms = [
    ...(model.linkedRooms || []),
    linkedRoom
  ];

  await browser.storage.local.set({ models });
  await renderModels();

  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_UPDATE_MODEL",
      modelId: model.id
    });
    if (response?.success) {
      await renderModels();
    }
  } catch (error) {
    console.error("Failed to update model after adding linked room:", error);
  }
}

function getInitialPreviewUrl(model, modelData = {}) {
  const previewUrl = typeof modelData.previewUrl === "string" ? modelData.previewUrl : "";
  if (previewUrl) return previewUrl;

  if (model.site === "chaturbate") {
    return model.thumbnailUrl || "";
  }

  return "";
}

async function requestUpdateAllModels() {
  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_UPDATE_ALL_MODELS"
    });
    if (!response?.success) {
      console.warn("Update all models request failed", response?.error);
    }
  } catch (error) {
    console.error("Failed to request model updates:", error);
  }
}

async function importModelsFromJson() {
  const file = await pickJsonFile();
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const rawModels = Array.isArray(parsed) ? parsed : parsed?.models;

    if (!Array.isArray(rawModels)) {
      throw new Error("JSON must be an array or an object with a models array");
    }

    const normalized = rawModels
      .map(normalizeImportedModel)
      .filter(Boolean);

    if (!normalized.length) {
      throw new Error("No valid model entries found");
    }

    await browser.storage.local.set({ models: dedupeModelsById(normalized) });
    await renderModels();
    await requestUpdateAllModels();
  } catch (error) {
    console.error("Import failed:", error);
    alert(`Import failed: ${error?.message || "invalid JSON format"}.`);
  }
}

function openImportPage() {
  const url = browser.runtime.getURL("popup/import.html");
  browser.tabs.create({ url });
}

async function exportModelsToJson() {
  try {
    const data = await browser.storage.local.get("models");
    const models = (data.models || [])
      .map(normalizeModelIdentity)
      .filter(Boolean);
    const payload = buildExportPayload(models);
    const serialized = JSON.stringify(payload, null, 2);
    const defaultName = `models-${getTimestampForFilename()}.json`;
    const response = await browser.runtime.sendMessage({
      type: "EXPORT_MODELS_FILE",
      filename: defaultName,
      content: serialized
    });

    if (!response?.success) {
      throw new Error(response?.error || "Unknown export error");
    }
  } catch (error) {
    console.error("Export failed:", error);
    const message = String(error?.message || "unknown error")
      .split("\n")[0]
      .slice(0, 220);
    alert(`Export failed: ${message}.`);
  }
}

function buildExportPayload(models) {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    models: (models || [])
      .map((model) => {
        const username = getCleanString(model?.username);
        const roomUrl = getCleanString(model?.profileUrl);
        if (!username || !roomUrl) return null;

        const site = getCleanString(model?.site) || inferSiteFromUrl(roomUrl);
        const lastOnlineAt = getCleanString(
          model?.status?.lastBroadcast || model?.status?.startDtUtc
        );

        const personId = getPersonIdFromModel(model);
        const displayName = getCleanString(model?.displayName);

        return {
          username,
          roomUrl,
          ...(site ? { site } : {}),
          ...(personId ? { personId } : {}),
          ...(displayName && displayName !== username ? { displayName } : {}),
          ...(model.linkedRooms?.length ? { linkedRooms: buildExportLinkedRooms(model.linkedRooms) } : {}),
          ...(lastOnlineAt ? { lastOnlineAt } : {})
        };
      })
      .filter(Boolean)
  };
}

function buildExportLinkedRooms(rooms) {
  return (rooms || [])
    .map(normalizeLinkedRoomIdentity)
    .filter(Boolean)
    .map((room) => ({
      site: room.site,
      username: room.username,
      roomUrl: room.profileUrl
    }));
}

function normalizeImportedModel(model) {
  if (!model || typeof model !== "object") return null;
  const identity = resolveImportedIdentity(model);
  if (!identity) return null;

  const { site, username, id, profileUrl, personId, displayName } = identity;

  return {
    id,
    site,
    username,
    ...(personId ? { personId } : {}),
    displayName,
    addedAt: Number(model.addedAt) || Date.now(),
    profileUrl,
    thumbnailUrl: typeof model.thumbnailUrl === "string" ? model.thumbnailUrl : "",
    previewUrl: typeof model.previewUrl === "string" ? model.previewUrl : "",
    linkedRooms: normalizeImportedLinkedRooms(model.linkedRooms || model.links),
    primaryRoomStatus: model.primaryRoomStatus || null,
    status: {
      online: Boolean(model.status?.online),
      showType: model.status?.showType || model.status?.roomStatus || "offline",
      viewers: Number(model.status?.viewers) || 0,
      startDtUtc: model.status?.startDtUtc || null,
      startTimestamp: model.status?.startTimestamp || null,
      roomStatus: model.status?.roomStatus || model.status?.showType || "offline",
      lastBroadcast: model.status?.lastBroadcast || null,
      timeSinceLastBroadcast: model.status?.timeSinceLastBroadcast || null
    }
  };
}

function normalizeImportedLinkedRooms(rooms) {
  if (!Array.isArray(rooms)) return [];

  return rooms
    .map((room) => {
      const normalized = normalizeLinkedRoomIdentity({
        ...room,
        profileUrl: room.profileUrl || room.roomUrl || room.url
      });
      return normalized;
    })
    .filter(Boolean);
}

function resolveImportedIdentity(model) {
  const siteRaw = typeof model.site === "string" ? model.site.trim() : "";
  const usernameRaw = typeof model.username === "string" ? model.username.trim() : "";
  if (siteRaw && usernameRaw) {
    return {
      site: siteRaw,
      username: usernameRaw,
      id: buildModelId(siteRaw, usernameRaw),
      personId: getPersonIdFromModel(model),
      displayName: getCleanString(model.displayName) || usernameRaw,
      profileUrl: getCleanString(model.profileUrl) || defaultProfileUrl(siteRaw, usernameRaw)
    };
  }

  if (typeof model.id === "string" && model.id.includes(":")) {
    const [idSite, ...rest] = model.id.split(":");
    const idUsername = rest.join(":").trim();
    if (idSite && idUsername) {
      return {
        site: idSite.trim(),
        username: idUsername,
        id: buildModelId(idSite.trim(), idUsername),
        personId: getPersonIdFromModel(model),
        displayName: getCleanString(model.displayName) || idUsername,
        profileUrl: getCleanString(model.profileUrl) || defaultProfileUrl(idSite.trim(), idUsername)
      };
    }
  }

  if (typeof model.profileUrl === "string" && model.profileUrl) {
    const parsed = parseModelFromUrl(model.profileUrl);
    if (parsed) {
      return {
        site: parsed.site,
        username: parsed.username,
        id: buildModelId(parsed.site, parsed.username),
        personId: getPersonIdFromModel(model),
        displayName: getCleanString(model.displayName) || parsed.username,
        profileUrl: parsed.url
      };
    }
  }

  return null;
}

function dedupeModelsById(models) {
  const map = new Map();
  models.forEach((model) => {
    const normalized = normalizeModelIdentity(model);
    if (normalized) map.set(normalized.id, normalized);
  });
  return [...map.values()];
}

function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
    }, { once: true });
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
