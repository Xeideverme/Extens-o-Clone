interface ExtensionMessage<TPayload = unknown> {
  type: string;
  payload?: TPayload;
}

const startedAt = Date.now();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({
    clone3dInstalledAt: Date.now()
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  routeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error"
      });
    });

  return true;
});

async function routeMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case "clone3d:ping":
      return {
        ok: true,
        service: "background",
        startedAt,
        tabId: sender.tab?.id ?? null
      };

    case "clone3d:getStatus":
      return {
        ok: true,
        status: "ready",
        startedAt
      };

    case "clone3d:contentReady":
    case "clone3d:mainWorldEvent":
      return {
        ok: true,
        receivedAt: Date.now()
      };

    default:
      return {
        ok: false,
        error: "unknown_message_type",
        type: message.type
      };
  }
}
