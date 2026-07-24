const container = document.getElementById("models");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const addBtn = document.getElementById("addModelBtn");
const refreshBtn = document.getElementById("refreshBtn");
const previewPlayer = document.getElementById("previewPlayer");
const THUMBNAIL_REFRESH_MS = 60 * 1000;
let thumbnailRefreshTimer = null;
const {
  buildModelId,
  buildChaturbateJpegPreviewUrl,
  createModelFromIdentity,
  defaultProfileUrl,
  getCleanString,
  normalizeLinkedRoomIdentity,
  normalizeModelIdentity,
  parseModelFromUrl
} = globalThis.OnlineModeli.sites;
const { buildExportPayload, parseImportedModelsText } = globalThis.OnlineModeli.modelIo;
const MODEL_DATA_TIMEOUT_MS = 1200;

init();

async function init() {
  importBtn.addEventListener("click", openImportPage);
  exportBtn.addEventListener("click", exportModelsToJson);
  addBtn.addEventListener("click", addCurrentModel);
  document.querySelectorAll(".toolbarSiteIcon[data-site-url]").forEach((button) => {
    button.addEventListener("click", () => {
      browser.tabs.create({ url: button.dataset.siteUrl });
    });
  });
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    await requestUpdateAllModels({ force: true });
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
  startThumbnailRefreshTimer();

  // Request update of all models when popup opens.
  // The UI will re-render from storage.onChanged when background writes fresh data.
  requestUpdateAllModels({ reason: "popup_open" });
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

  if (!models.length) {
    container.innerHTML = "<div>No models</div>";
    return;
  }

  // Remove "No models" placeholder if it was there
  if (container.firstElementChild && !container.firstElementChild.classList.contains("model")) {
    container.innerHTML = "";
  }

  const sortedModels = sortModelsForDisplay(models);
  const activeIds = new Set(sortedModels.map(m => m.id));

  // Remove elements for deleted models
  const existingElements = Array.from(container.querySelectorAll(".model"));
  existingElements.forEach((el) => {
    const modelId = el.dataset.modelId;
    if (!activeIds.has(modelId)) {
      el.remove();
    }
  });

  // Render or update elements in sorted order
  sortedModels.forEach((model) => {
    let el = null;
    for (let i = 0; i < container.children.length; i++) {
      if (container.children[i].dataset.modelId === model.id) {
        el = container.children[i];
        break;
      }
    }
    if (el) {
      updateModelElement(el, model);
      container.appendChild(el); // Moves to the end to maintain sorted order
    } else {
      el = createModelElement(model);
      container.appendChild(el);
    }
  });
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

function createModelElement(model) {
  const el = document.createElement("div");
  el.className = "model";
  el.dataset.modelId = model.id;
  el.dataset.profileUrl = model.profileUrl;

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
  const thumbnailUrl = getSafeMediaUrl(model.thumbnailUrl);

  let initialSrc = fallback;
  if (shouldRefreshThumbnail(model, thumbnailUrl)) {
    img.dataset.thumbnailUrl = thumbnailUrl;
    initialSrc = buildRefreshingMediaUrl(thumbnailUrl);
  } else {
    initialSrc = thumbnailUrl || fallback;
  }
  img.src = initialSrc;
  img.dataset.originalSrc = initialSrc;

  img.onerror = () => {
    img.src = fallback;
  };

  const previewUrl = getModelPreviewUrl(model);
  if (previewUrl) {
    thumbWrap.classList.add("previewEnabled");
    thumbWrap.dataset.previewUrl = previewUrl;
  }

  thumbWrap.addEventListener("mouseenter", (event) => {
    event.stopPropagation();
    const currentPreviewUrl = thumbWrap.dataset.previewUrl;
    if (currentPreviewUrl) {
      startPreviewPlayer(model, thumbWrap, currentPreviewUrl);
    }
  });

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
  username.textContent = getModelDisplayName(model);
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
  const isRegion = roomStatus === "region";
  const isRoomPass = roomStatus === "room pass";
  const statusClass = isPassword || isRegion || isRoomPass ? "warningStatus" : (isOnline ? "online" : "offline");
  status.className = "status " + statusClass;

  if (isPassword || isRegion || isRoomPass) {
    status.textContent = `${showType.toUpperCase()} (${model.status.viewers || 0})`;
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
    await addCurrentRoomLinkToModel(el.dataset.modelId || model.id);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "deleteBtn";
  deleteBtn.title = "Delete model";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation(); // prevent opening profile
    const data = await browser.storage.local.get("models");
    const modelsList = (data.models || [])
      .map(normalizeModelIdentity)
      .filter(Boolean);
    const filtered = modelsList.filter(m => m.id !== (el.dataset.modelId || model.id));
    await browser.storage.local.set({ models: filtered });
    await requestUpdateAllModels();
    await renderModels();
  });

  el.appendChild(thumbWrap);
  el.appendChild(info);
  el.appendChild(addLinkBtn);
  el.appendChild(deleteBtn);

  el.addEventListener("click", () => {
    browser.tabs.create({ url: el.dataset.profileUrl || model.profileUrl });
  });

  return el;
}

function updateModelElement(el, model) {
  el.dataset.profileUrl = model.profileUrl;

  const roomStatus = (model.status?.roomStatus || model.status?.showType || "").toLowerCase();
  const isPrivate = roomStatus === "private";
  const isPassword = roomStatus === "password";

  if (isPrivate) {
    el.classList.add("privateModel");
  } else {
    el.classList.remove("privateModel");
  }

  const thumbWrap = el.querySelector(".thumbWrap");
  if (thumbWrap) {
    const img = thumbWrap.querySelector(".thumb");
    if (img) {
      const fallback = browser.runtime.getURL("icons/offline.jpg");
      const thumbnailUrl = getSafeMediaUrl(model.thumbnailUrl);
      let newSrc = fallback;
      if (shouldRefreshThumbnail(model, thumbnailUrl)) {
        img.dataset.thumbnailUrl = thumbnailUrl;
        newSrc = buildRefreshingMediaUrl(thumbnailUrl);
      } else {
        delete img.dataset.thumbnailUrl;
        newSrc = thumbnailUrl || fallback;
      }
      if (img.dataset.originalSrc !== newSrc) {
        img.dataset.originalSrc = newSrc;
        img.src = newSrc;
      }
    }

    // Update overlay
    let overlay = thumbWrap.querySelector(".thumbPrivateOverlay, .thumbPasswordOverlay");
    if (isPrivate || isPassword) {
      const expectedClass = isPassword ? "thumbPasswordOverlay" : "thumbPrivateOverlay";
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = expectedClass;
        thumbWrap.appendChild(overlay);
      } else if (overlay.className !== expectedClass) {
        overlay.className = expectedClass;
      }
    } else if (overlay) {
      overlay.remove();
    }

    // Update previewUrl
    const previewUrl = getModelPreviewUrl(model);
    if (previewUrl) {
      thumbWrap.classList.add("previewEnabled");
      thumbWrap.dataset.previewUrl = previewUrl;
    } else {
      thumbWrap.classList.remove("previewEnabled");
      delete thumbWrap.dataset.previewUrl;
    }
  }

  const name = el.querySelector(".name");
  if (name) {
    if (isPrivate) {
      name.className = "name privateName";
    } else {
      name.className = "name";
    }

    const username = name.querySelector("span:not(.roomIcons)");
    if (username) {
      username.textContent = getModelDisplayName(model);
    }

    const roomIcons = name.querySelector(".roomIcons");
    if (roomIcons) {
      roomIcons.innerHTML = "";
      getModelRooms(model).forEach((room) => {
        roomIcons.appendChild(createRoomIcon(room));
      });
    }
  }

  const status = el.querySelector(".status");
  if (status) {
    const showType = model.status?.roomStatus || model.status?.showType;
    const isOnline = model.status?.online;
    const isRegion = roomStatus === "region";
    const isRoomPass = roomStatus === "room pass";
    const statusClass = isPassword || isRegion || isRoomPass ? "warningStatus" : (isOnline ? "online" : "offline");
    status.className = "status " + statusClass;

    if (isPassword || isRegion || isRoomPass) {
      status.textContent = `${showType.toUpperCase()} (${model.status.viewers || 0})`;
    } else if (isOnline) {
      status.textContent = showType
        ? `${showType.toUpperCase()} (${model.status.viewers || 0})`
        : `ONLINE (${model.status.viewers || 0})`;
    } else {
      status.textContent = "OFFLINE";
    }
  }

  const streamTime = el.querySelector(".streamTime");
  if (streamTime) {
    streamTime.textContent = formatStreamTime(model.status);
  }
}

function getModelDisplayName(model) {
  if (model.site === "bongacams") {
    return getCleanString(model.displayName) || model.username;
  }

  return model.username;
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
  const roomUrl = getRoomProfileUrl(room);
  siteIcon.className = [
    "siteIcon",
    `siteIcon-${room.site || "unknown"}`,
    siteStatusClass
  ].filter(Boolean).join(" ");
  siteIcon.title = `${room.site || ""}: ${room.username || ""} - ${getRoomStatusLabel(room.status)}`;
  siteIcon.setAttribute("role", "button");
  siteIcon.tabIndex = 0;
  siteIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    openRoomProfile(roomUrl);
  });
  siteIcon.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    openRoomProfile(roomUrl);
  });
  return siteIcon;
}

function getRoomProfileUrl(room) {
  return getCleanString(room?.profileUrl) || defaultProfileUrl(room?.site, room?.username);
}

function openRoomProfile(url) {
  if (url) browser.tabs.create({ url });
}

function getRoomStatusLabel(status) {
  if (!status?.online) return "offline";
  const roomStatus = status.roomStatus || status.showType || "online";
  const viewers = Number(status.viewers) || 0;
  return `${roomStatus} (${viewers})`;
}

function getModelPreviewUrl(model) {
  const previewSite = getCleanString(model.previewRoomSite) || getCleanString(model.displayRoomSite) || model.site;
  const previewUsername = getCleanString(model.previewRoomUsername) || getCleanString(model.displayRoomUsername) || model.username;
  const previewUrl = getSafeMediaUrl(model.previewRoomPreviewUrl) || getSafeMediaUrl(model.previewUrl);
  const previewThumbnailUrl = getSafeMediaUrl(model.previewRoomThumbnailUrl) || getSafeMediaUrl(model.thumbnailUrl);

  if (model.site === "stripchat" && !getCleanString(model.previewRoomId)) return "";

  const roomStatus = (model.status?.roomStatus || model.status?.showType || "").toLowerCase();
  const isPublicOnline = model.status?.online === true && (!roomStatus || roomStatus === "public");
  const hasPreviewRoom = getCleanString(model.previewRoomId);
  if (!isPublicOnline && !hasPreviewRoom) return "";

  if (previewSite === "chaturbate") {
    return buildChaturbateJpegPreviewUrl(previewUsername)
      || previewUrl
      || previewThumbnailUrl;
  }

  return previewUrl;
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

function shouldRefreshThumbnail(model, url) {
  return Boolean(
    url &&
    model?.status?.online === true &&
    /^https?:\/\//i.test(url)
  );
}

function buildRefreshingMediaUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("_om_thumb", String(Date.now()));
    return parsed.toString();
  } catch {
    return url;
  }
}

function startThumbnailRefreshTimer() {
  if (thumbnailRefreshTimer) return;

  thumbnailRefreshTimer = setInterval(refreshVisibleThumbnails, THUMBNAIL_REFRESH_MS);
}

function refreshVisibleThumbnails() {
  document.querySelectorAll("img.thumb[data-thumbnail-url]").forEach((img) => {
    img.src = buildRefreshingMediaUrl(img.dataset.thumbnailUrl);
  });
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
    : (parseUtcDate(status.lastSeenOnlineAt) || parseUtcDate(status.lastBroadcast) || parseUnixSeconds(status.startTimestamp));

  if (!timestamp) return "--.--.-- --:--";

  return formatDateInKyivTime(timestamp);
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
  if (numeric > 100000000000) return numeric;
  return numeric * 1000;
}

function formatDateInKyivTime(timestampMs) {
  const date = new Date(timestampMs);
  const formatter = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", // Kyiv timezone supporting DST
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

  const modelData = await getCurrentRoomModelData(tab.id, parsed, "model");

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
    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out while reading room data"));
    }, timeoutMs);

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

  if (model.site === "chaturbate") {
    return model.thumbnailUrl || "";
  }

  return "";
}

async function requestUpdateAllModels(options = {}) {
  try {
    const response = await browser.runtime.sendMessage({
      type: "REQUEST_UPDATE_ALL_MODELS",
      force: Boolean(options.force),
      reason: options.reason || ""
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
    const importedModels = parseImportedModelsText(text);
    await browser.storage.local.set({ models: importedModels });
    await renderModels();
    await requestUpdateAllModels({ force: true, reason: "import" });
  } catch (error) {
    console.warn("Import skipped:", error);
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
