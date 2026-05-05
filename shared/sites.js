(function (global) {
  const SITE_DEFINITIONS = {
    chaturbate: {
      id: "chaturbate",
      label: "Chaturbate",
      domains: ["chaturbate.com"],
      profileUrl(username) {
        return `https://chaturbate.com/${encodeURIComponent(username)}/`;
      }
    },
    bongacams: {
      id: "bongacams",
      label: "BongaCams",
      domains: ["bongacams.com"],
      profileUrl(username) {
        return `https://bongacams.com/${encodeURIComponent(username)}/`;
      }
    },
    stripchat: {
      id: "stripchat",
      label: "Stripchat",
      domains: ["stripchat.com"],
      profileUrl(username) {
        return `https://stripchat.com/${encodeURIComponent(username)}`;
      }
    }
  };

  function getCleanString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getSupportedSites() {
    return Object.values(SITE_DEFINITIONS);
  }

  function findSiteByHost(hostname) {
    const host = getCleanString(hostname).toLowerCase().replace(/^www\./, "");
    if (!host) return null;

    return getSupportedSites().find((site) => {
      return site.domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    }) || null;
  }

  function inferSiteFromUrl(url) {
    try {
      return findSiteByHost(new URL(url).hostname)?.id || "";
    } catch {
      return "";
    }
  }

  function getUsernameFromPath(pathname) {
    const [username] = String(pathname || "").split("/").filter(Boolean);
    return getCleanString(username);
  }

  function parseModelFromUrl(url) {
    try {
      const parsedUrl = new URL(url);
      const site = findSiteByHost(parsedUrl.hostname);
      if (!site) return null;

      const username = getUsernameFromPath(parsedUrl.pathname);
      if (!username) return null;

      return {
        site: site.id,
        username,
        url: site.profileUrl(username)
      };
    } catch {
      return null;
    }
  }

  function defaultProfileUrl(siteId, username) {
    const site = SITE_DEFINITIONS[siteId];
    return site && username ? site.profileUrl(username) : "";
  }

  function buildModelId(site, username) {
    return `${site}:${username}`;
  }

  function buildChaturbateJpegPreviewUrl(username) {
    const cleanUsername = getCleanString(username);
    if (!cleanUsername) return "";
    return `https://jpeg.live.mmcdn.com/stream?room=${encodeURIComponent(cleanUsername)}&f=0.`;
  }

  function getPersonIdFromModel(model) {
    return getCleanString(
      model?.personId ||
      model?.modelPersonId ||
      model?.identityId ||
      model?.groupId ||
      model?.modelId
    );
  }

  function normalizeModelIdentity(model) {
    if (!model || typeof model !== "object") return null;

    const parsedFromUrl = model.profileUrl ? parseModelFromUrl(model.profileUrl) : null;
    const idParts = getCleanString(model.id).includes(":")
      ? getCleanString(model.id).split(":")
      : [];
    const idSite = getCleanString(idParts.shift());
    const idUsername = getCleanString(idParts.join(":"));
    const site = getCleanString(model.site) || parsedFromUrl?.site || idSite || "";
    const username = getCleanString(model.username) || parsedFromUrl?.username || idUsername || "";
    if (!site || !username) return null;

    return {
      ...model,
      id: buildModelId(site, username),
      site,
      username,
      ...(getPersonIdFromModel(model) ? { personId: getPersonIdFromModel(model) } : {}),
      displayName: getCleanString(model.displayName) || username,
      profileUrl: getCleanString(model.profileUrl) || defaultProfileUrl(site, username)
    };
  }

  function toFiniteCount(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return Math.floor(numeric);
  }

  function normalizeRoomStatus(value) {
    const roomStatus = String(value || "").toLowerCase();
    if (
      roomStatus === "public" ||
      roomStatus === "private" ||
      roomStatus === "group" ||
      roomStatus === "offline" ||
      roomStatus === "password" ||
      roomStatus === "password-required"
    ) {
      return roomStatus === "password-required" ? "password" : roomStatus;
    }
    return "offline";
  }

  function resolveEffectiveShowType(primaryStatus, fallbackStatus) {
    const normalizedPrimary = normalizeRoomStatus(primaryStatus);
    if (normalizedPrimary === "password") return "password";

    const normalizedFallback = normalizeRoomStatus(fallbackStatus);
    if (normalizedFallback === "password") return "password";

    if (normalizedPrimary !== "offline") return normalizedPrimary;
    if (normalizedFallback !== "offline") return normalizedFallback;

    return "offline";
  }

  function buildOfflineStatus(overrides = {}) {
    const roomStatus = resolveEffectiveShowType(
      overrides.roomStatus || overrides.showType,
      overrides.online ? "public" : "offline"
    );

    return {
      online: Boolean(overrides.online),
      showType: roomStatus,
      viewers: toFiniteCount(overrides.viewers, 0),
      startDtUtc: overrides.startDtUtc || null,
      startTimestamp: overrides.startTimestamp || null,
      roomStatus,
      lastBroadcast: overrides.lastBroadcast || null,
      timeSinceLastBroadcast: overrides.timeSinceLastBroadcast || null
    };
  }

  function normalizeModelStatus(previousStatus = {}, payload = {}) {
    const hasOnline = Object.prototype.hasOwnProperty.call(payload, "online");
    const hasViewers = Object.prototype.hasOwnProperty.call(payload, "viewers");
    const online = hasOnline ? Boolean(payload.online) : Boolean(previousStatus.online);
    const previousViewers = toFiniteCount(previousStatus.viewers, 0);
    const roomStatus = resolveEffectiveShowType(
      payload.roomStatus || payload.showType,
      payload.online ? "public" : (hasOnline ? "offline" : previousStatus.roomStatus || previousStatus.showType)
    );

    return {
      ...previousStatus,
      online,
      viewers: online
        ? (hasViewers ? toFiniteCount(payload.viewers, previousViewers) : previousViewers)
        : 0,
      showType: roomStatus,
      roomStatus,
      startDtUtc: payload.startDtUtc || previousStatus.startDtUtc || null,
      startTimestamp: payload.startTimestamp || previousStatus.startTimestamp || null,
      lastBroadcast: payload.lastBroadcast || previousStatus.lastBroadcast || null,
      timeSinceLastBroadcast: payload.timeSinceLastBroadcast || previousStatus.timeSinceLastBroadcast || null
    };
  }

  function createModelFromIdentity(identity, payload = {}) {
    const site = identity?.site;
    const username = identity?.username;
    if (!site || !username) return null;

    return {
      id: buildModelId(site, username),
      site,
      username,
      ...(getPersonIdFromModel(payload) || getPersonIdFromModel(identity)
        ? { personId: getPersonIdFromModel(payload) || getPersonIdFromModel(identity) }
        : {}),
      displayName: getCleanString(payload.displayName || identity.displayName) || username,
      profileUrl: identity.url || defaultProfileUrl(site, username),
      addedAt: Date.now(),
      thumbnailUrl: payload.thumbnailUrl || "",
      previewUrl: payload.previewUrl || "",
      status: buildOfflineStatus(payload)
    };
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    sites: {
      SITE_DEFINITIONS,
      buildModelId,
      buildChaturbateJpegPreviewUrl,
      buildOfflineStatus,
      createModelFromIdentity,
      defaultProfileUrl,
      findSiteByHost,
      getCleanString,
      getPersonIdFromModel,
      getSupportedSites,
      inferSiteFromUrl,
      normalizeModelIdentity,
      normalizeModelStatus,
      normalizeRoomStatus,
      parseModelFromUrl,
      resolveEffectiveShowType,
      toFiniteCount
    }
  };
})(globalThis);
