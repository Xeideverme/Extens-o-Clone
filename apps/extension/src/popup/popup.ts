const statusEl = document.querySelector<HTMLElement>("#status");
const pingButton = document.querySelector<HTMLButtonElement>("#ping");

pingButton?.addEventListener("click", () => {
  void pingBackground();
});

void pingBackground();

async function pingBackground(): Promise<void> {
  setStatus("Verificando...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "clone3d:ping" });
    setStatus(response?.ok ? "Pronto" : "Indisponível");
  } catch {
    setStatus("Indisponível");
  }
}

function setStatus(value: string): void {
  if (statusEl) {
    statusEl.textContent = value;
  }
}
