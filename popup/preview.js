(function (global) {
  const previewPlayer = document.getElementById("previewPlayer");
  const THUMBNAIL_REFRESH_MS = 60 * 1000;
  let thumbnailRefreshTimer = null;

  function setupPreviewPlayer() {
    if (!previewPlayer) return;

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

  global.OnlineModeli = {
    ...(global.OnlineModeli || {}),
    popupPreview: {
      buildRefreshingMediaUrl,
      setupPreviewPlayer,
      startPreviewPlayer,
      startThumbnailRefreshTimer
    }
  };
})(globalThis);
