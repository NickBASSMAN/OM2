(function () {
  const {
    buildChaturbateJpegPreviewUrl,
    normalizeModelStatus,
    parseModelFromUrl,
    toFiniteCount
  } = globalThis.OnlineModeli.sites;

  console.log("Online Modeli content script loaded");

  async function getChaturbateModelDataFromAPI(username) {
    const apiUrl = "https://chaturbate.com/api/ts/roomlist/room-list/";
    const limit = 100;
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const url = `${apiUrl}?limit=${limit}&offset=${offset}`;

      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) break;

        const data = await res.json();
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        total = toFiniteCount(data?.total_count, rooms.length);

        const room = rooms.find((item) => item.username === username);
        if (room) {
          return {
            site: "chaturbate",
            username: room.username,
            online: true,
            thumbnailUrl: room.img || "",
            previewUrl: buildChaturbateJpegPreviewUrl(room.username),
            showType: room.current_show || "public",
            roomStatus: room.current_show || "public",
            startDtUtc: room.start_dt_utc || null,
            startTimestamp: room.start_timestamp || null,
            ...(room.num_users !== undefined && room.num_users !== null
              ? { viewers: toFiniteCount(room.num_users, 0) }
              : {})
          };
        }

        offset += limit;
      } catch (error) {
        console.error("Error fetching from Chaturbate API:", error);
        break;
      }
    }

    return null;
  }

  function findFirstImage(selectors) {
    for (const selector of selectors) {
      const img = document.querySelector(selector);
      if (img?.src) return img.src;
    }
    return "";
  }

  function findFirstNumber(selectors) {
    for (const selector of selectors) {
      const elem = document.querySelector(selector);
      const match = elem?.textContent?.match(/\d[\d\s,.]*/);
      if (!match) continue;

      const normalized = match[0].replace(/[^\d]/g, "");
      const viewers = Number.parseInt(normalized, 10);
      if (Number.isFinite(viewers)) return viewers;
    }
    return null;
  }

  function bodyHasAnyText(values) {
    const bodyText = document.body?.innerText || "";
    return values.some((value) => bodyText.includes(value));
  }

  function getModelDataFromPage() {
    const identity = parseModelFromUrl(window.location.href);
    if (!identity) return null;

    const commonThumbSelectors = [
      'img[src*="/thumbs/"]',
      'img[src*="thumb"]',
      'img[src*="thumbnail"]',
      'img[src*="live.mmcdn.com"]',
      'img[src*="thumb.live.mmcdn.com"]',
      'img[src*="model"]',
      ".model-img img",
      'img[id="profileImg"]',
      "video[poster]"
    ];

    let thumbnailUrl = findFirstImage(commonThumbSelectors);
    if (!thumbnailUrl) {
      const video = document.querySelector("video[poster]");
      thumbnailUrl = video?.poster || "";
    }

    const viewers = findFirstNumber([
      ".viewers-count",
      ".users-in-room",
      '[data-testid="viewers-count"]',
      '[data-testid*="viewer"]',
      ".user-count",
      '[class*="viewer"]',
      '[class*="Viewer"]'
    ]);

    const hasOnlineMarker = Boolean(document.querySelector([
      ".badge-online",
      ".online-tag",
      '[data-status="online"]',
      ".status-online",
      ".model-status-online",
      ".label-online",
      '[class*="online"]',
      '[class*="Online"]'
    ].join(",")));

    const hasOnlineText = bodyHasAnyText([
      "Is online",
      "Online",
      "Онлайн",
      "LIVE",
      "Live",
      "Напряму"
    ]);

    const hasOfflineText = bodyHasAnyText([
      "offline",
      "Offline",
      "Офлайн"
    ]);

    const online = !hasOfflineText && (hasOnlineMarker || hasOnlineText || viewers > 0);
    const status = normalizeModelStatus({}, {
      online,
      showType: online ? "public" : "offline",
      roomStatus: online ? "public" : "offline",
      ...(viewers !== null ? { viewers } : {})
    });

    return {
      site: identity.site,
      username: identity.username,
      thumbnailUrl,
      previewUrl: identity.site === "chaturbate"
        ? buildChaturbateJpegPreviewUrl(identity.username)
        : "",
      ...status
    };
  }

  async function getModelData() {
    const identity = parseModelFromUrl(window.location.href);
    if (!identity) return null;

    if (identity.site === "chaturbate") {
      const apiData = await getChaturbateModelDataFromAPI(identity.username);
      if (apiData) return apiData;
    }

    return getModelDataFromPage();
  }

  async function sendModelData() {
    const modelData = await getModelData();

    if (!modelData) {
      console.log("Could not get model data");
      return;
    }

    browser.runtime.sendMessage({
      type: "MODEL_STATUS_UPDATE",
      site: modelData.site,
      username: modelData.username,
      url: window.location.href,
      online: modelData.online,
      thumbnailUrl: modelData.thumbnailUrl,
      previewUrl: modelData.previewUrl,
      viewers: modelData.viewers,
      showType: modelData.showType,
      roomStatus: modelData.roomStatus,
      startDtUtc: modelData.startDtUtc,
      startTimestamp: modelData.startTimestamp
    });
    console.log("Sent model data:", modelData);
  }

  sendModelData();

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "GET_MODEL_DATA") return false;

    Promise.resolve(getModelData()).then((modelData) => {
      sendResponse(modelData || {});
    }).catch((error) => {
      console.error("Failed to read model data from page:", error);
      sendResponse({});
    });

    return true;
  });
})();
