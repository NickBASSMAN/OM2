(function (global) {
  const {
    normalizeModelStatus,
    resolveEffectiveShowType,
    toFiniteCount
  } = global.OnlineModeli.sites;
  const chaturbateApi = global.OnlineModeli.chaturbateApi || {};
  const bongaApi = global.OnlineModeli.bongaApi || {};

  function createOfflineStatus() {
    return {
      thumbnailUrl: "",
      online: false,
      viewers: 0,
      showType: "offline",
      roomStatus: "offline",
      startDtUtc: null,
      startTimestamp: null,
      lastBroadcast: null,
      timeSinceLastBroadcast: null
    };
  }

  function patchChaturbateModelFromRoom(model, room, fallbackOnline = true) {
    model.status = model.status || {};

    const isOnline = typeof room.is_online === "boolean"
      ? room.is_online
      : (typeof room.online === "boolean" ? room.online : fallbackOnline);

    const effectiveShowType = resolveEffectiveShowType(
      model.status.roomStatus || model.status.showType,
      room.current_show
    );

    model.thumbnailUrl = room.img || model.thumbnailUrl;
    model.previewUrl = chaturbateApi.getPreviewUrl?.(room) || model.previewUrl || model.thumbnailUrl;
    model.status.online = isOnline;
    if (isOnline) {
      if (room.num_users !== undefined && room.num_users !== null) {
        model.status.viewers = toFiniteCount(room.num_users, model.status.viewers || 0);
      }
    } else {
      model.status.viewers = 0;
    }
    model.status.showType = effectiveShowType;
    model.status.roomStatus = effectiveShowType;
    model.status.startDtUtc = room.start_dt_utc || model.status.startDtUtc || null;
    model.status.startTimestamp = room.start_timestamp || model.status.startTimestamp || null;
  }

  async function updateChaturbateModel(model, roomHint = null) {
    try {
      let payload;

      if (roomHint) {
        payload = await chaturbateApi.buildStatusFromRoom(model.username, roomHint);
      } else {
        payload = chaturbateApi.fetchModelStatus
          ? await chaturbateApi.fetchModelStatus(model.username)
          : createOfflineStatus();
      }

      return {
        ...model,
        thumbnailUrl: payload.thumbnailUrl || model.thumbnailUrl,
        previewUrl: payload.previewUrl || model.previewUrl || payload.thumbnailUrl || model.thumbnailUrl,
        status: normalizeModelStatus(model.status, payload)
      };
    } catch (error) {
      console.error("Error updating Chaturbate model", model.id, error);
      return model;
    }
  }

  async function enrichChaturbateModelFromBio(model) {
    try {
      const bio = chaturbateApi.fetchBioStatus
        ? await chaturbateApi.fetchBioStatus(model.username)
        : createOfflineStatus();
      return {
        ...model,
        status: normalizeModelStatus(model.status, bio)
      };
    } catch (error) {
      console.error("Biocontext update failed for model", model.id, error);
      return model;
    }
  }

  async function enrichChaturbateOnlineModelsFromRoomlist(models) {
    const nextModels = models.map((model) => ({
      ...model,
      status: { ...(model.status || {}) }
    }));
    const usernameToIndexes = new Map();
    const targetUsernames = new Set();

    nextModels.forEach((model, index) => {
      if (model.site !== "chaturbate") return;
      if (model.status?.online !== true) return;

      const list = usernameToIndexes.get(model.username) || [];
      list.push(index);
      usernameToIndexes.set(model.username, list);
      targetUsernames.add(model.username);
    });

    if (!targetUsernames.size) return nextModels;

    if (!chaturbateApi.fetchRoomsPage) return nextModels;

    let offset = 0;
    let onlineCount = Infinity;
    const limit = 100;

    while (offset < onlineCount && targetUsernames.size) {
      const page = await chaturbateApi.fetchRoomsPage(offset, limit);
      onlineCount = page.onlineCount;

      page.rooms.forEach((room) => {
        if (!targetUsernames.has(room.username)) return;
        const indexes = usernameToIndexes.get(room.username) || [];
        indexes.forEach((index) => patchChaturbateModelFromRoom(nextModels[index], room, true));
        targetUsernames.delete(room.username);
      });

      offset += limit;
    }

    return nextModels;
  }

  function normalizeBongaRoomStatus(status) {
    if (status === "free") return "public";
    if (status === "public" || status === "private" || status === "group") return status;
    return "offline";
  }

  function isInvalidBongaMediaUrl(url) {
    if (!url || typeof url !== "string") return false;

    const value = url.toLowerCase();
    return (
      value.includes("/sprite/") ||
      value.includes("model_flags_atlas") ||
      value.includes(".svg") ||
      value.startsWith("data:image/svg")
    );
  }

  function getBongaUsernameKey(username) {
    return String(username || "").trim().toLowerCase();
  }

  async function fetchBongaSessionTimestamp(username) {
    if (!bongaApi.fetchBongaRoomData) return null;

    try {
      return await bongaApi.fetchBongaRoomData(username);
    } catch (error) {
      console.error("BongaCams room data update failed for model", username, error);
      return null;
    }
  }

  async function fetchBongaRoomDetails(username) {
    if (!bongaApi.fetchBongaRoomDetails) return null;

    try {
      return await bongaApi.fetchBongaRoomDetails(username);
    } catch (error) {
      console.error("BongaCams room details update failed for model", username, error);
      return null;
    }
  }

  async function fetchBongaRoomsForUsernames(usernames) {
    if (bongaApi.fetchBongaModelsByUsernames) {
      return bongaApi.fetchBongaModelsByUsernames(usernames);
    }

    if (bongaApi.fetchBongaModels) {
      return bongaApi.fetchBongaModels({ usernames });
    }

    return [];
  }

  function formatBongaLastSeenAgo(isoString) {
    const timestamp = Date.parse(isoString);
    if (!Number.isFinite(timestamp)) return null;

    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return "щойно";
    if (minutes < 60) return `${minutes} хв тому`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} год тому`;

    const days = Math.floor(hours / 24);
    return `${days} дн тому`;
  }

  function buildBongaAvatarUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return `https://i.bgicdn.com${String(path).startsWith("/") ? "" : "/"}${path}`;
  }

  function buildOfflineBongaPayload(previousStatus = {}, roomDetails = null) {
    const performer = roomDetails?.performerData || {};
    const sessionTs = performer.sessionTs || null;
    const lastSeenOnlineAt = sessionTs
      ? new Date(sessionTs * 1000).toISOString()
      : (previousStatus.lastSeenOnlineAt || (previousStatus.online ? new Date().toISOString() : null));

    return {
      ...createOfflineStatus(),
      thumbnailUrl: buildBongaAvatarUrl(performer.avatarUrl120 || performer.avatarUrl90 || performer.avatarUrlMedium || performer.avatarUrl),
      displayName: performer.displayName || performer.username || "",
      lastBroadcast: lastSeenOnlineAt || previousStatus.lastBroadcast || null,
      startTimestamp: sessionTs,
      lastSeenOnlineAt,
      timeSinceLastBroadcast: lastSeenOnlineAt ? formatBongaLastSeenAgo(lastSeenOnlineAt) : null
    };
  }

  async function buildBongaPayload(room, previousStatus = {}, username = "") {
    if (!room) {
      const roomDetails = await fetchBongaRoomDetails(username);
      return buildOfflineBongaPayload(previousStatus, roomDetails);
    }

    const roomStatus = normalizeBongaRoomStatus(room.status);
    const sessionTs = await fetchBongaSessionTimestamp(room.username || room.id);

    return {
      thumbnailUrl: room.thumbnail || "",
      previewUrl: room.previewUrl || bongaApi.buildPreviewUrl?.(room) || "",
      displayName: room.displayName || room.name || room.username || room.id || "",
      online: true,
      viewers: toFiniteCount(room.viewers, 0),
      showType: roomStatus,
      roomStatus,
      startTimestamp: sessionTs || null,
      lastBroadcast: null,
      timeSinceLastBroadcast: null,
      lastSeenOnlineAt: new Date().toISOString(),
      platformData: {
        bonga: {
          vsid: room.vsid || null,
          esid: room.esid || null
        }
      }
    };
  }

  async function updateBongaModel(model, roomHint = null) {
    try {
      let room = roomHint;

      if (!room) {
        const rooms = await fetchBongaRoomsForUsernames([model.username]);
        const modelUsernameKey = getBongaUsernameKey(model.username);
        room = rooms.find((item) => {
          return getBongaUsernameKey(item.username || item.id) === modelUsernameKey;
        });
      }

      const payload = await buildBongaPayload(room, model.status, model.username);
      const previousThumbnailUrl = isInvalidBongaMediaUrl(model.thumbnailUrl) ? "" : model.thumbnailUrl;
      const previousPreviewUrl = isInvalidBongaMediaUrl(model.previewUrl) ? "" : model.previewUrl;
      return {
        ...model,
        displayName: payload.displayName || model.displayName || model.username,
        thumbnailUrl: payload.thumbnailUrl || previousThumbnailUrl,
        previewUrl: payload.previewUrl || previousPreviewUrl,
        platformData: {
          ...(model.platformData || {}),
          ...(payload.platformData || {})
        },
        status: normalizeModelStatus(model.status, payload)
      };
    } catch (error) {
      console.error("Error updating BongaCams model", model.id, error);
      return model;
    }
  }

  async function enrichBongaOnlineModelsFromListing(models) {
    const nextModels = models.map((model) => ({
      ...model,
      status: { ...(model.status || {}) }
    }));
    const targetIndexes = nextModels
      .map((model, index) => ({ model, index }))
      .filter(({ model }) => model.site === "bongacams");

    if (!targetIndexes.length) return nextModels;

    try {
      const targetUsernames = targetIndexes.map(({ model }) => model.username);
      const rooms = await fetchBongaRoomsForUsernames(targetUsernames);
      const roomsByUsername = new Map(rooms.map((room) => {
        return [getBongaUsernameKey(room.username || room.id), room];
      }));

      await Promise.all(targetIndexes.map(async ({ model, index }) => {
        nextModels[index] = await updateBongaModel(
          model,
          roomsByUsername.get(getBongaUsernameKey(model.username))
        );
      }));
    } catch (error) {
      console.error("BongaCams listing update failed:", error);
    }

    return nextModels;
  }

  function createUnsupportedSiteAdapter(siteId) {
    return {
      async updateModel(model) {
        return model;
      },
      async enrichModelBasic(model) {
        return model;
      },
      async enrichOnlineModels(models) {
        return models;
      },
      siteId
    };
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    backgroundAdapters: {
      chaturbate: {
        updateModel: updateChaturbateModel,
        enrichModelBasic: enrichChaturbateModelFromBio,
        enrichOnlineModels: enrichChaturbateOnlineModelsFromRoomlist
      },
      bongacams: {
        updateModel: updateBongaModel,
        async enrichModelBasic(model) {
          return model;
        },
        enrichOnlineModels: enrichBongaOnlineModelsFromListing
      },
      stripchat: createUnsupportedSiteAdapter("stripchat")
    }
  };
})(globalThis);
