(function (global) {
  const {
    buildModelId,
    buildOfflineStatus,
    defaultProfileUrl,
    getCleanString,
    getPersonIdFromModel,
    normalizeLinkedRoomIdentity,
    normalizeModelIdentity,
    parseModelFromUrl
  } = global.OnlineModeli.sites;

  const EXPORT_VERSION = 5;

  function parseImportedModelsText(text) {
    const rawText = typeof text === "string" ? text : "";
    if (!rawText.trim()) {
      throw new Error("Import file is empty");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error("Import file is not valid JSON");
    }

    return normalizeImportedModels(parsed);
  }

  function getRawModels(payload) {
    return Array.isArray(payload) ? payload : payload?.models;
  }

  function normalizeImportedModels(payload) {
    const rawModels = getRawModels(payload);
    if (!Array.isArray(rawModels)) {
      throw new Error("JSON must be an array or an object with a models array");
    }

    const normalized = rawModels
      .map((model, index) => normalizeImportedModel(model, index))
      .filter(Boolean);

    if (!normalized.length) {
      throw new Error("No valid model entries found");
    }

    return dedupeModelsById(normalized);
  }

  function normalizeImportedModel(model, index = 0) {
    if (!model || typeof model !== "object") return null;
    const identity = resolveImportedIdentity(model);
    if (!identity) return null;

    const primaryStatus = normalizeImportedStatus(
      model.primaryRoomStatus || model.status || model.statusSnapshot || {},
      model.lastOnlineAt || model.last_broadcast
    );

    return {
      id: identity.id,
      site: identity.site,
      username: identity.username,
      ...(identity.personId ? { personId: identity.personId } : {}),
      displayName: identity.displayName,
      addedAt: resolveAddedAt(model, index),
      profileUrl: identity.profileUrl,
      thumbnailUrl: getCleanString(model.thumbnailUrl),
      previewUrl: getCleanString(model.previewUrl),
      ...(isPlainObject(model.platformData) ? { platformData: model.platformData } : {}),
      primaryRoomStatus: primaryStatus,
      status: primaryStatus,
      linkedRooms: normalizeImportedLinkedRooms(model.linkedRooms || model.links, identity.id)
    };
  }

  function normalizeImportedLinkedRooms(rooms, primaryId = "") {
    if (!Array.isArray(rooms)) return [];

    const byId = new Map();
    rooms.forEach((room) => {
      if (!room || typeof room !== "object") return;
      const identity = resolveImportedIdentity(room);
      if (!identity || identity.id === primaryId) return;

      const normalized = normalizeLinkedRoomIdentity({
        id: identity.id,
        site: identity.site,
        username: identity.username,
        displayName: identity.displayName,
        profileUrl: identity.profileUrl,
        thumbnailUrl: getCleanString(room.thumbnailUrl),
        previewUrl: getCleanString(room.previewUrl),
        ...(isPlainObject(room.platformData) ? { platformData: room.platformData } : {}),
        status: normalizeImportedStatus(room.status || room.statusSnapshot || {})
      });

      if (normalized) byId.set(normalized.id, normalized);
    });

    return [...byId.values()];
  }

  function normalizeImportedStatus(status = {}, legacyLastOnlineAt = "") {
    const lastSeenOnlineAt = getCleanString(
      status.lastSeenOnlineAt ||
      status.lastBroadcast ||
      legacyLastOnlineAt
    );

    return buildOfflineStatus({
      online: false,
      viewers: 0,
      showType: "offline",
      roomStatus: "offline",
      lastBroadcast: getCleanString(status.lastBroadcast || legacyLastOnlineAt) || null,
      lastSeenOnlineAt: lastSeenOnlineAt || null,
      timeSinceLastBroadcast: getCleanString(status.timeSinceLastBroadcast) || null
    });
  }

  function resolveImportedIdentity(model) {
    const profileUrl = getCleanString(model.profileUrl || model.roomUrl || model.url);
    const parsedFromUrl = profileUrl ? parseModelFromUrl(profileUrl) : null;
    const idParts = getCleanString(model.id).includes(":")
      ? getCleanString(model.id).split(":")
      : [];
    const idSite = getCleanString(idParts.shift());
    const idUsername = getCleanString(idParts.join(":"));
    const site = getCleanString(model.site) || parsedFromUrl?.site || idSite || "";
    const username = getCleanString(model.username || model.userName) || parsedFromUrl?.username || idUsername || "";
    if (!site || !username) return null;

    return {
      id: buildModelId(site, username),
      site,
      username,
      personId: getPersonIdFromModel(model),
      displayName: getCleanString(model.displayName) || username,
      profileUrl: profileUrl || defaultProfileUrl(site, username)
    };
  }

  function resolveAddedAt(model, index) {
    const existing = Number(model?.addedAt);
    if (Number.isFinite(existing) && existing > 0) return existing;
    return Date.now() - (index * 1000);
  }

  function dedupeModelsById(models) {
    const byId = new Map();

    models.forEach((model) => {
      const normalized = normalizeModelIdentity(model);
      if (!normalized) return;

      const previous = byId.get(normalized.id);
      byId.set(normalized.id, previous ? mergeImportedModels(previous, normalized) : normalized);
    });

    return [...byId.values()];
  }

  function mergeImportedModels(previous, next) {
    return {
      ...previous,
      ...next,
      linkedRooms: dedupeLinkedRooms([
        ...(previous.linkedRooms || []),
        ...(next.linkedRooms || [])
      ])
    };
  }

  function dedupeLinkedRooms(rooms) {
    const byId = new Map();
    (rooms || []).forEach((room) => {
      const normalized = normalizeLinkedRoomIdentity(room);
      if (normalized) byId.set(normalized.id, normalized);
    });
    return [...byId.values()];
  }

  function buildExportPayload(models) {
    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      models: (models || [])
        .map(normalizeModelIdentity)
        .filter(Boolean)
        .map(buildExportModel)
    };
  }

  function buildExportModel(model) {
    const personId = getPersonIdFromModel(model);
    const displayName = getCleanString(model.displayName);

    return {
      id: model.id,
      site: model.site,
      username: model.username,
      profileUrl: model.profileUrl || defaultProfileUrl(model.site, model.username),
      roomUrl: model.profileUrl || defaultProfileUrl(model.site, model.username),
      ...(personId ? { personId } : {}),
      ...(displayName && displayName !== model.username ? { displayName } : {}),
      ...(Number(model.addedAt) > 0 ? { addedAt: Number(model.addedAt) } : {}),
      ...(getCleanString(model.thumbnailUrl) ? { thumbnailUrl: getCleanString(model.thumbnailUrl) } : {}),
      ...(getCleanString(model.previewUrl) ? { previewUrl: getCleanString(model.previewUrl) } : {}),
      ...(isPlainObject(model.platformData) ? { platformData: model.platformData } : {}),
      status: buildExportStatus(model.primaryRoomStatus || model.status),
      ...(model.linkedRooms?.length ? { linkedRooms: buildExportLinkedRooms(model.linkedRooms) } : {})
    };
  }

  function buildExportLinkedRooms(rooms) {
    return dedupeLinkedRooms(rooms)
      .map((room) => ({
        id: room.id,
        site: room.site,
        username: room.username,
        profileUrl: room.profileUrl || defaultProfileUrl(room.site, room.username),
        roomUrl: room.profileUrl || defaultProfileUrl(room.site, room.username),
        ...(getCleanString(room.displayName) && room.displayName !== room.username
          ? { displayName: getCleanString(room.displayName) }
          : {}),
        ...(getCleanString(room.thumbnailUrl) ? { thumbnailUrl: getCleanString(room.thumbnailUrl) } : {}),
        ...(getCleanString(room.previewUrl) ? { previewUrl: getCleanString(room.previewUrl) } : {}),
        ...(isPlainObject(room.platformData) ? { platformData: room.platformData } : {}),
        status: buildExportStatus(room.status)
      }));
  }

  function buildExportStatus(status = {}) {
    return {
      online: Boolean(status.online),
      showType: getCleanString(status.showType || status.roomStatus) || "offline",
      roomStatus: getCleanString(status.roomStatus || status.showType) || "offline",
      viewers: Number(status.viewers) || 0,
      startDtUtc: status.startDtUtc || null,
      startTimestamp: status.startTimestamp || null,
      lastBroadcast: status.lastBroadcast || null,
      timeSinceLastBroadcast: status.timeSinceLastBroadcast || null,
      lastSeenOnlineAt: status.lastSeenOnlineAt || null
    };
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    modelIo: {
      buildExportPayload,
      normalizeImportedModels,
      parseImportedModelsText
    }
  };
})(globalThis);
