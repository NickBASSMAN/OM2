const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const addBtn = document.getElementById("addModelBtn");
const refreshBtn = document.getElementById("refreshBtn");
const { popupActions, popupPreview, popupRendering } = globalThis.OnlineModeli;

init();

async function init() {
  importBtn.addEventListener("click", popupActions.openImportPage);
  exportBtn.addEventListener("click", popupActions.exportModelsToJson);
  addBtn.addEventListener("click", popupActions.addCurrentModel);
  document.querySelectorAll(".toolbarSiteIcon[data-site-url]").forEach((button) => {
    button.addEventListener("click", () => browser.tabs.create({ url: button.dataset.siteUrl }));
  });
  refreshBtn.addEventListener("click", refreshModels);
  browser.storage.onChanged.addListener(handleStorageChange);

  popupPreview.setupPreviewPlayer();
  await popupRendering.renderModels();
  popupPreview.startThumbnailRefreshTimer();
  popupActions.requestUpdateAllModels({ reason: "popup_open" });
}

async function refreshModels() {
  refreshBtn.disabled = true;
  try {
    await popupActions.requestUpdateAllModels({ force: true });
    await popupRendering.renderModels();
  } finally {
    refreshBtn.disabled = false;
  }
}

function handleStorageChange(changes, areaName) {
  if (areaName === "local" && changes.models) popupRendering.renderModels();
}
