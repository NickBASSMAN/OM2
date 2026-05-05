(function (global) {
  const {
    buildChaturbateJpegPreviewUrl,
    resolveEffectiveShowType,
    toFiniteCount
  } = global.OnlineModeli.sites;

  const CHATURBATE_API_URL = "https://chaturbate.com/api/ts/roomlist/room-list/";
  const CHATURBATE_LIMIT = 100;

  const BONGA_MODELS_URL = "https://bongacams.com/tools/listing_v3.php";
  const BONGA_MODELS_LIMIT = 144;
  const BONGA_MAX_PAGES = 100;

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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Biocontext request failed with status ${response.status}`);
    }

    const data = await response.json();
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

  async function fetchChaturbateRoomsPage(offset = 0, limit = CHATURBATE_LIMIT) {
    const url = `${CHATURBATE_API_URL}?limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Room-list request failed with status ${response.status}`);
    }

    return parseChaturbateRoomsResponse(await response.json());
  }

  function getChaturbatePreviewUrl(roomOrUsername) {
    const username = typeof roomOrUsername === "string"
      ? roomOrUsername
      : roomOrUsername?.username;
    return buildChaturbateJpegPreviewUrl(username);
  }

  async function fetchOnlineChaturbateRoomByUsername(username) {
    let offset = 0;
    let onlineCount = Infinity;

    while (offset < onlineCount) {
      const page = await fetchChaturbateRoomsPage(offset, CHATURBATE_LIMIT);
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

  async function buildChaturbateStatusFromRoom(username, room) {
    const bio = await fetchChaturbateBioStatus(username);
    const roomOnline = typeof room.is_online === "boolean"
      ? room.is_online
      : (typeof room.online === "boolean" ? room.online : true);
    const effectiveShowType = resolveEffectiveShowType(bio.roomStatus, room.current_show);

    const payload = {
      thumbnailUrl: room.img || "",
      previewUrl: getChaturbatePreviewUrl(room),
      online: roomOnline,
      showType: effectiveShowType,
      roomStatus: effectiveShowType,
      startDtUtc: room.start_dt_utc || null,
      startTimestamp: room.start_timestamp || null,
      lastBroadcast: bio.lastBroadcast,
      timeSinceLastBroadcast: bio.timeSinceLastBroadcast
    };

    if (roomOnline) {
      const viewers = room.num_users ?? bio.viewers;
      if (viewers !== undefined && viewers !== null) {
        payload.viewers = toFiniteCount(viewers, 0);
      }
    } else {
      payload.viewers = 0;
    }

    return payload;
  }

  function isCloudflareChallenge(text) {
    return (
      text.startsWith("<!DOCTYPE html>") ||
      text.includes("Just a moment") ||
      text.includes("cf_chl")
    );
  }

  function mapRoomStatus(room) {
    switch (room) {
      case "public":
        return "public";
      case "private":
        return "private";
      case "group":
        return "group";
      default:
        return room || "unknown";
    }
  }

  function buildThumbnailUrl(template) {
    if (!template) return "";
    return `https:${template.replace("{ext}", "jpg")}`;
  }

  function buildPreviewUrl(model) {
    if (!model?.vsid || !model?.username) return "";
    return `https://mobile-edge${model.vsid}.bcvcdn.com/stream_${model.username}.jpg`;
  }

  function getUsernameKey(username) {
    return String(username || "").trim().toLowerCase();
  }

  function normalizeBongaModelsResponse(data) {
    if (!data || !Array.isArray(data.models)) return [];

    return data.models.map((model) => {
      const username = model.username || "";
      const displayName = model.display_name || username;
      const normalized = {
        id: username,
        username,
        name: username,
        displayName,
        online: true,
        viewers: Number(model.viewers) || 0,
        status: mapRoomStatus(model.room),
        thumbnail: buildThumbnailUrl(model.thumb_image),
        vsid: model.vsid || null,
        esid: model.esid || null,
        raw: model
      };

      normalized.previewUrl = buildPreviewUrl(normalized);
      return normalized;
    });
  }

  function getBongaModelsTotal(data) {
    const total = Number(
      data?.total ||
      data?.total_count ||
      data?.count ||
      data?.models_count ||
      data?.all_count
    );

    return Number.isFinite(total) && total >= 0 ? total : null;
  }

  function buildBongaModelsUrl(offset, limit) {
    const url = new URL(BONGA_MODELS_URL);
    url.searchParams.set("livetab", "all");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    return url.toString();
  }

  async function fetchBongaModelsPage(offset = 0, limit = BONGA_MODELS_LIMIT) {
    const response = await fetch(buildBongaModelsUrl(offset, limit), {
      method: "GET",
      credentials: "include",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://bongacams.com/"
      }
    });

    const text = await response.text();

    if (isCloudflareChallenge(text)) {
      throw new Error("Cloudflare challenge");
    }

    const json = JSON.parse(text);
    const models = normalizeBongaModelsResponse(json);

    return {
      models,
      total: getBongaModelsTotal(json),
      raw: json
    };
  }

  async function fetchBongaModels(options = {}) {
    const usernames = Array.isArray(options.usernames)
      ? new Set(options.usernames.map(getUsernameKey).filter(Boolean))
      : null;
    const foundByUsername = new Map();
    const allModels = [];
    let offset = 0;
    let total = Infinity;
    let pages = 0;

    while (offset < total && pages < BONGA_MAX_PAGES) {
      const page = await fetchBongaModelsPage(offset, BONGA_MODELS_LIMIT);
      const models = page.models;

      total = page.total ?? Infinity;
      pages++;

      models.forEach((model) => {
        if (usernames) {
          const usernameKey = getUsernameKey(model.username || model.id);
          if (usernames.has(usernameKey)) {
            foundByUsername.set(usernameKey, model);
          }
          return;
        }

        allModels.push(model);
      });

      if (usernames && foundByUsername.size >= usernames.size) {
        break;
      }

      if (models.length < BONGA_MODELS_LIMIT) {
        break;
      }

      offset += BONGA_MODELS_LIMIT;
    }

    return usernames ? Array.from(foundByUsername.values()) : allModels;
  }

  async function fetchBongaModelsByUsernames(usernames) {
    return fetchBongaModels({ usernames });
  }

  async function fetchBongaRoomDetails(username) {
    const body = new URLSearchParams();
    body.append("method", "getRoomData");
    body.append("args[]", username);
    body.append("args[]", "");
    body.append("args[]", "");

    const response = await fetch(`https://bongacams.com/tools/amf.php?t=${Date.now()}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: `https://bongacams.com/${username}`,
        Origin: "https://bongacams.com"
      },
      body
    });

    const json = await response.json();
    if (json?.status !== "success" || !json?.performerData) {
      throw new Error("No performerData");
    }

    return json;
  }

  async function fetchBongaRoomData(username) {
    const json = await fetchBongaRoomDetails(username);

    if (!json?.performerData?.sessionTs) {
      throw new Error("No sessionTs");
    }

    return json.performerData.sessionTs;
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    chaturbateApi: {
      buildStatusFromRoom: buildChaturbateStatusFromRoom,
      fetchBioStatus: fetchChaturbateBioStatus,
      fetchModelStatus: fetchChaturbateModelStatus,
      fetchOnlineRoomByUsername: fetchOnlineChaturbateRoomByUsername,
      fetchRoomsPage: fetchChaturbateRoomsPage,
      getPreviewUrl: getChaturbatePreviewUrl,
      parseRoomsResponse: parseChaturbateRoomsResponse
    },
    bongaApi: {
      buildPreviewUrl,
      fetchBongaModels,
      fetchBongaModelsByUsernames,
      fetchBongaModelsPage,
      fetchBongaRoomData,
      fetchBongaRoomDetails,
      normalizeBongaModelsResponse
    }
  };
})(globalThis);
