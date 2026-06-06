(() => {
  const event = {
    kind: "ready",
    pageUrl: location.href,
    createdAt: Date.now()
  };

  window.postMessage(
    {
      type: "CLONE3D_MAIN_EVENT",
      payload: event
    },
    "*"
  );
})();
