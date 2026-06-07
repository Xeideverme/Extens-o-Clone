fetch("./api/session.json").catch(() => undefined);
fetch("./api/public-config.json")
  .then((response) => response.json())
  .then((config) => {
    window.__clone3dPublicConfig = config;
  });
