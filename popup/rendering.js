(function (global) {
  const container = document.getElementById("models");
  const {
    buildChaturbateJpegPreviewUrl,
    defaultProfileUrl,
    getCleanString,
    normalizeLinkedRoomIdentity,
    normalizeModelIdentity
  } = global.OnlineModeli.sites;

  function getActions() {
    return global.OnlineModeli.popupActions;
  }

  function getPreview() {
    return global.OnlineModeli.popupPreview;
  }

  async function renderModels() {
    const data = await browser.storage.local.get("models");
    const models = (data.models || []).map(normalizeModelIdentity).filter(Boolean);

    if (!models.length) {
      container.innerHTML = "<div>No models</div>";
      return;
    }

    if (container.firstElementChild && !container.firstElementChild.classList.contains("model")) {
      container.innerHTML = "";
    }

    const sortedModels = sortModelsForDisplay(models);
    const activeIds = new Set(sortedModels.map((model) => model.id));
    Array.from(container.querySelectorAll(".model")).forEach((element) => {
      if (!activeIds.has(element.dataset.modelId)) element.remove();
    });

    sortedModels.forEach((model) => {
      const existing = Array.from(container.children).find((element) => element.dataset.modelId === model.id);
      const element = existing || createModelElement(model);
      if (existing) updateModelElement(element, model);
      container.appendChild(element);
    });
  }

  function sortModelsForDisplay(models) {
    const list = [...models];
    const byAddedDesc = (a, b) => getAddedAt(b) - getAddedAt(a);
    if (!list.some((model) => model?.status?.online === true)) return list.sort(byAddedDesc);

    return list.sort((a, b) => {
      const aOnline = a?.status?.online === true ? 1 : 0;
      const bOnline = b?.status?.online === true ? 1 : 0;
      return aOnline === bOnline ? byAddedDesc(a, b) : bOnline - aOnline;
    });
  }

  function getAddedAt(model) {
    const value = Number(model?.addedAt);
    return Number.isFinite(value) ? value : 0;
  }

  function createModelElement(model) {
    const element = document.createElement("div");
    element.className = "model";
    element.dataset.modelId = model.id;
    element.dataset.profileUrl = model.profileUrl;

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumbWrap";
    const image = document.createElement("img");
    image.className = "thumb";
    image.onerror = () => {
      image.src = browser.runtime.getURL("icons/offline.jpg");
    };
    thumbWrap.appendChild(image);
    thumbWrap.addEventListener("mouseenter", (event) => {
      event.stopPropagation();
      const previewUrl = thumbWrap.dataset.previewUrl;
      if (previewUrl) getPreview().startPreviewPlayer(model, thumbWrap, previewUrl);
    });

    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    const username = document.createElement("span");
    name.appendChild(username);
    const roomIcons = document.createElement("span");
    roomIcons.className = "roomIcons";
    name.appendChild(roomIcons);
    const statusRow = document.createElement("div");
    statusRow.className = "statusRow";
    const status = document.createElement("div");
    status.className = "status";
    const streamTime = document.createElement("div");
    streamTime.className = "streamTime";
    statusRow.append(status, streamTime);
    info.append(name, statusRow);

    const addLinkButton = document.createElement("button");
    addLinkButton.className = "addLinkBtn";
    addLinkButton.title = "Add current room link to this model";
    addLinkButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await getActions().addCurrentRoomLinkToModel(element.dataset.modelId || model.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "deleteBtn";
    deleteButton.title = "Delete model";
    deleteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await getActions().deleteModel(element.dataset.modelId || model.id);
    });

    element.append(thumbWrap, info, addLinkButton, deleteButton);
    element.addEventListener("click", () => {
      const url = element.dataset.profileUrl || model.profileUrl;
      if (url) browser.tabs.create({ url });
    });

    updateModelElement(element, model);
    return element;
  }

  function updateModelElement(element, model) {
    element.dataset.profileUrl = model.profileUrl;
    const roomStatus = getRoomStatus(model.status);
    const isPrivate = roomStatus === "private";
    const isPassword = roomStatus === "password";
    element.classList.toggle("privateModel", isPrivate);

    const thumbWrap = element.querySelector(".thumbWrap");
    updateThumbnail(thumbWrap, model);
    updateOverlay(thumbWrap, isPrivate, isPassword);
    updatePreview(thumbWrap, model);

    const name = element.querySelector(".name");
    name.className = isPrivate ? "name privateName" : "name";
    name.querySelector("span:not(.roomIcons)").textContent = getModelDisplayName(model);
    const roomIcons = name.querySelector(".roomIcons");
    roomIcons.innerHTML = "";
    getModelRooms(model).forEach((room) => roomIcons.appendChild(createRoomIcon(room)));

    const status = element.querySelector(".status") || createStatusElement(element);
    updateStatus(status, model, roomStatus, isPassword);
    element.querySelector(".streamTime").textContent = formatStreamTime(model.status);
  }

  function createStatusElement(element) {
    const status = document.createElement("div");
    element.querySelector(".statusRow").prepend(status);
    return status;
  }

  function updateThumbnail(thumbWrap, model) {
    const image = thumbWrap.querySelector(".thumb");
    const fallback = browser.runtime.getURL("icons/offline.jpg");
    const thumbnailUrl = getSafeMediaUrl(model.thumbnailUrl);
    const nextSrc = shouldRefreshThumbnail(model, thumbnailUrl)
      ? getPreview().buildRefreshingMediaUrl(thumbnailUrl)
      : thumbnailUrl || fallback;

    if (shouldRefreshThumbnail(model, thumbnailUrl)) image.dataset.thumbnailUrl = thumbnailUrl;
    else delete image.dataset.thumbnailUrl;

    if (image.dataset.originalSrc !== nextSrc) {
      image.dataset.originalSrc = nextSrc;
      image.src = nextSrc;
    }
  }

  function updateOverlay(thumbWrap, isPrivate, isPassword) {
    let overlay = thumbWrap.querySelector(".thumbPrivateOverlay, .thumbPasswordOverlay");
    if (!isPrivate && !isPassword) {
      overlay?.remove();
      return;
    }

    const expectedClass = isPassword ? "thumbPasswordOverlay" : "thumbPrivateOverlay";
    if (!overlay) {
      overlay = document.createElement("div");
      thumbWrap.appendChild(overlay);
    }
    overlay.className = expectedClass;
  }

  function updatePreview(thumbWrap, model) {
    const previewUrl = getModelPreviewUrl(model);
    thumbWrap.classList.toggle("previewEnabled", Boolean(previewUrl));
    if (previewUrl) thumbWrap.dataset.previewUrl = previewUrl;
    else delete thumbWrap.dataset.previewUrl;
  }

  function updateStatus(status, model, roomStatus, isPassword) {
    const showType = model.status?.roomStatus || model.status?.showType;
    const isOnline = model.status?.online;
    const hasWarning = isPassword || roomStatus === "region" || roomStatus === "room pass";
    status.className = `status ${hasWarning ? "warningStatus" : (isOnline ? "online" : "offline")}`;
    if (hasWarning) status.textContent = `${showType.toUpperCase()} (${model.status.viewers || 0})`;
    else if (isOnline) status.textContent = showType ? `${showType.toUpperCase()} (${model.status.viewers || 0})` : `ONLINE (${model.status.viewers || 0})`;
    else status.textContent = "OFFLINE";
  }

  function getModelDisplayName(model) {
    return model.site === "bongacams" ? getCleanString(model.displayName) || model.username : model.username;
  }

  function getModelRooms(model) {
    return [{ ...model, status: model.primaryRoomStatus || model.status }]
      .concat((model.linkedRooms || []).map(normalizeLinkedRoomIdentity).filter(Boolean));
  }

  function createRoomIcon(room) {
    const icon = document.createElement("span");
    const roomUrl = getCleanString(room?.profileUrl) || defaultProfileUrl(room?.site, room?.username);
    icon.className = ["siteIcon", `siteIcon-${room.site || "unknown"}`, getSiteIconStatusClass(room.status)].filter(Boolean).join(" ");
    icon.title = `${room.site || ""}: ${room.username || ""} - ${getRoomStatusLabel(room.status)}`;
    icon.setAttribute("role", "button");
    icon.tabIndex = 0;
    const openRoom = (event) => {
      event.stopPropagation();
      if (roomUrl) browser.tabs.create({ url: roomUrl });
    };
    icon.addEventListener("click", openRoom);
    icon.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openRoom(event);
    });
    return icon;
  }

  function getRoomStatusLabel(status) {
    if (!status?.online) return "offline";
    return `${status.roomStatus || status.showType || "online"} (${Number(status.viewers) || 0})`;
  }

  function getModelPreviewUrl(model) {
    const previewSite = getCleanString(model.previewRoomSite) || getCleanString(model.displayRoomSite) || model.site;
    const previewUsername = getCleanString(model.previewRoomUsername) || getCleanString(model.displayRoomUsername) || model.username;
    const previewUrl = getSafeMediaUrl(model.previewRoomPreviewUrl) || getSafeMediaUrl(model.previewUrl);
    const previewThumbnailUrl = getSafeMediaUrl(model.previewRoomThumbnailUrl) || getSafeMediaUrl(model.thumbnailUrl);
    if (model.site === "stripchat" && !getCleanString(model.previewRoomId)) return "";

    const roomStatus = getRoomStatus(model.status);
    const hasPreviewRoom = getCleanString(model.previewRoomId);
    if (!(model.status?.online === true && (!roomStatus || roomStatus === "public")) && !hasPreviewRoom) return "";
    return previewSite === "chaturbate"
      ? buildChaturbateJpegPreviewUrl(previewUsername) || previewUrl || previewThumbnailUrl
      : previewUrl;
  }

  function getSafeMediaUrl(url) {
    if (!url || typeof url !== "string") return "";
    const value = url.toLowerCase();
    return value.includes("/sprite/") || value.includes("model_flags_atlas") || value.includes(".svg") || value.startsWith("data:image/svg") ? "" : url;
  }

  function shouldRefreshThumbnail(model, url) {
    return Boolean(url && model?.status?.online === true && /^https?:\/\//i.test(url));
  }

  function getSiteIconStatusClass(status) {
    const roomStatus = getRoomStatus(status);
    if (roomStatus === "offline" || status?.online === false) return "";
    if (roomStatus && roomStatus !== "public") return "siteIconBusy";
    return roomStatus === "public" || status?.online === true ? "siteIconOnline" : "";
  }

  function getRoomStatus(status) {
    return (status?.roomStatus || status?.showType || "").toLowerCase();
  }

  function formatStreamTime(status) {
    if (!status) return "--.--.-- --:--";
    if (status.online === false && status.timeSinceLastBroadcast) return String(status.timeSinceLastBroadcast);
    const timestamp = status.online
      ? (parseUtcDate(status.startDtUtc) || parseUnixSeconds(status.startTimestamp) || parseUtcDate(status.lastBroadcast))
      : (parseUtcDate(status.lastSeenOnlineAt) || parseUtcDate(status.lastBroadcast) || parseUnixSeconds(status.startTimestamp));
    return timestamp ? formatDateInUserTimeZone(timestamp) : "--.--.-- --:--";
  }

  function parseUtcDate(isoString) {
    const time = Date.parse(isoString || "");
    return Number.isNaN(time) ? null : time;
  }

  function parseUnixSeconds(seconds) {
    const numeric = Number(seconds);
    if (!Number.isFinite(numeric) || !seconds) return null;
    return numeric > 100000000000 ? numeric : numeric * 1000;
  }

  function formatDateInUserTimeZone(timestampMs) {
    const parts = new Intl.DateTimeFormat("uk-UA", {
      year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date(timestampMs));
    const map = {};
    parts.forEach((part) => { map[part.type] = part.value; });
    return `${map.day}.${map.month}.${map.year} ${map.hour}:${map.minute}`;
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    popupRendering: { renderModels }
  };
})(globalThis);
