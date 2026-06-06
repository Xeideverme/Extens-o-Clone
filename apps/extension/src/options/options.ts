interface ExtensionSettings {
  workerEndpoint: string;
  publicBaseUrl: string;
  inlineThresholdKb: number;
}

const form = document.querySelector<HTMLFormElement>("#settings-form");
const endpointInput = document.querySelector<HTMLInputElement>("#worker-endpoint");
const publicBaseInput = document.querySelector<HTMLInputElement>("#public-base-url");
const thresholdInput = document.querySelector<HTMLInputElement>("#inline-threshold");
const saveStatus = document.querySelector<HTMLParagraphElement>("#save-status");

void loadSettings();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

async function loadSettings(): Promise<void> {
  const settings = (await chrome.storage.local.get([
    "workerEndpoint",
    "publicBaseUrl",
    "inlineThresholdKb"
  ])) as Partial<ExtensionSettings>;

  if (endpointInput) {
    endpointInput.value = settings.workerEndpoint ?? "";
  }

  if (publicBaseInput) {
    publicBaseInput.value = settings.publicBaseUrl ?? "";
  }

  if (thresholdInput) {
    thresholdInput.value = String(settings.inlineThresholdKb ?? 50);
  }
}

async function saveSettings(): Promise<void> {
  const settings: ExtensionSettings = {
    workerEndpoint: endpointInput?.value.trim() ?? "",
    publicBaseUrl: publicBaseInput?.value.trim() ?? "",
    inlineThresholdKb: Number(thresholdInput?.value || 50)
  };

  await chrome.storage.local.set(settings);

  if (saveStatus) {
    saveStatus.textContent = "Salvo.";
  }
}
