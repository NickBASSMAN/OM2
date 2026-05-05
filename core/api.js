(function (global) {
  const BONGA_MODELS_URL = "https://bongacams.com/tools/listing_v3.php";
  const BONGA_MODELS_LIMIT = 144;
  const BONGA_MAX_PAGES = 100;

  const roomCache = {};

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
      const normalized = {
        id: username,
        username,
        name: username,
        displayName: username,
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

  async function fetchBongaRoomData(username) {
    if (roomCache[username]) {
      return roomCache[username];
    }

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

    if (json?.performerData?.sessionTs) {
      roomCache[username] = json.performerData.sessionTs;
      return roomCache[username];
    }

    throw new Error("No sessionTs");
  }

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    bongaApi: {
      buildPreviewUrl,
      fetchBongaModels,
      fetchBongaModelsByUsernames,
      fetchBongaModelsPage,
      fetchBongaRoomData,
      normalizeBongaModelsResponse
    }
  };
})(globalThis);
