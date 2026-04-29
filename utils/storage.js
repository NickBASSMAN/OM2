export async function saveModel(model) {
  const data = await browser.storage.local.get("models");
  const models = data.models || [];

  models.push(model);

  await browser.storage.local.set({ models });
}