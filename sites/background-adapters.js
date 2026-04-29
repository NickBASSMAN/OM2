(function (global) {
  const {
    buildChaturbateJpegPreviewUrl,
    normalizeModelStatus,
    resolveEffectiveShowType,
    toFiniteCount
  } = global.OnlineModeli.sites;

  const CHATURBATE_API_URL = "https://chaturbate.com/api/ts/roomlist/room-list/";
  const CHATURBATE_LIMIT = 100;

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

  async function fetchChaturbateBioStatus(username) {
    const url = `https://chaturbate.com/api/biocontext/${encodeURIComponent(username)}/?`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Biocontext request failed with status ${res.status}`);
    }

    const data = await res.json();
    const roomStatus = resolveEffectiveShowType(data?.code, data?.room_status);
    const isOnline = roomStatus !== "offline";
    const viewers = data?.num_users ?? data?.viewer_count ?? data?.viewers ?? data?.users_count;

    const status = {
      online: isOnline,
      showType: roomStatus,
      roomStatus,
      lastBroadcast: data?.last_broadcast || null,
      timeSinceLastBroadcast: data?.time_since_last_broadcast || null
    };
    if (viewers !== undefined && viewers !== null) {
      status.viewers = toFiniteCount(viewers, 0);
    }
    return status;
  }

  function parseChaturbateRoomsResponse(payload) {
    const rooms = Array.isArray(payload?.rooms)
      ? payload.rooms
      : (Array.isArray(payload?.rooms?.results) ? payload.rooms.results : []);

    const onlineCount = toFiniteCount(
      payload?.total_count ?? payload?.rooms?.total_count,
      rooms.length
    );

    const allCountRaw = toFiniteCount(
      payload?.all_rooms_count ?? payload?.rooms?.all_rooms_count,
      onlineCount
    );

    return {
      rooms,
      onlineCount,
      allCount: Math.max(allCountRaw, onlineCount)
    };
  }

  async function fetchChaturbateRoomsPage(offset) {
    const url = `${CHATURBATE_API_URL}?limit=${CHATURBATE_LIMIT}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Room-list request failed with status ${res.status}`);
    }
    return parseChaturbateRoomsResponse(await res.json());
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
    model.previewUrl = getChaturbatePreviewUrl(room) || model.previewUrl || model.thumbnailUrl;
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

  function getChaturbatePreviewUrl(room) {
    return buildChaturbateJpegPreviewUrl(room?.username);
  }

  async function fetchOnlineChaturbateRoomByUsername(username) {
    let offset = 0;
    let onlineCount = Infinity;

    while (offset < onlineCount) {
      const page = await fetchChaturbateRoomsPage(offset);
      onlineCount = page.onlineCount;

      const room = page.rooms.find((item) => item.username === username);
      if (room) return room;

      offset += CHATURBATE_LIMIT;
    }

    return null;
  }

  async function fetchChaturbateModelStatus(username) {
    try {
      const bio = await fetchChaturbateBioStatus(username);
      const room = bio.online ? await fetchOnlineChaturbateRoomByUsername(username) : null;
      const roomOnline = room
        ? (typeof room.is_online === "boolean"
          ? room.is_online
          : (typeof room.online === "boolean" ? room.online : true))
        : bio.online;
      const effectiveShowType = resolveEffectiveShowType(bio.roomStatus, room?.current_show);

      const payload = {
        thumbnailUrl: room?.img || "",
        previewUrl: getChaturbatePreviewUrl(room),
        online: roomOnline,
        showType: effectiveShowType,
        roomStatus: effectiveShowType,
        startDtUtc: room?.start_dt_utc || null,
        startTimestamp: room?.start_timestamp || null,
        lastBroadcast: bio.lastBroadcast,
        timeSinceLastBroadcast: bio.timeSinceLastBroadcast
      };
      if (roomOnline) {
        const viewers = room?.num_users ?? bio.viewers;
        if (viewers !== undefined && viewers !== null) {
          payload.viewers = toFiniteCount(viewers, 0);
        }
      } else {
        payload.viewers = 0;
      }
      return payload;
    } catch (error) {
      console.error("Error fetching Chaturbate model status:", error);
      return createOfflineStatus();
    }
  }

  async function updateChaturbateModel(model, roomHint = null) {
    try {
      let payload;

      if (roomHint) {
        const bio = await fetchChaturbateBioStatus(model.username);
        const roomOnline = typeof roomHint.is_online === "boolean"
          ? roomHint.is_online
          : (typeof roomHint.online === "boolean" ? roomHint.online : true);
        const effectiveShowType = resolveEffectiveShowType(bio.roomStatus, roomHint.current_show);

        payload = {
          thumbnailUrl: roomHint.img || "",
          previewUrl: getChaturbatePreviewUrl(roomHint),
          online: roomOnline,
          showType: effectiveShowType,
          roomStatus: effectiveShowType,
          startDtUtc: roomHint.start_dt_utc || null,
          startTimestamp: roomHint.start_timestamp || null,
          lastBroadcast: bio.lastBroadcast,
          timeSinceLastBroadcast: bio.timeSinceLastBroadcast
        };
        if (roomOnline) {
          const viewers = roomHint.num_users ?? bio.viewers;
          if (viewers !== undefined && viewers !== null) {
            payload.viewers = toFiniteCount(viewers, 0);
          }
        } else {
          payload.viewers = 0;
        }
      } else {
        payload = await fetchChaturbateModelStatus(model.username);
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
      const bio = await fetchChaturbateBioStatus(model.username);
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

    let offset = 0;
    let onlineCount = Infinity;

    while (offset < onlineCount && targetUsernames.size) {
      const page = await fetchChaturbateRoomsPage(offset);
      onlineCount = page.onlineCount;

      page.rooms.forEach((room) => {
        if (!targetUsernames.has(room.username)) return;
        const indexes = usernameToIndexes.get(room.username) || [];
        indexes.forEach((index) => patchChaturbateModelFromRoom(nextModels[index], room, true));
        targetUsernames.delete(room.username);
      });

      offset += CHATURBATE_LIMIT;
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
      bongacams: createUnsupportedSiteAdapter("bongacams"),
      stripchat: createUnsupportedSiteAdapter("stripchat")
    }
  };
})(globalThis);
