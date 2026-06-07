fetch("./api/config.json")
  .then((response) => response.json())
  .then((config) => {
    window.__clone3dApiConfig = config;
    return fetch(config.model);
  })
  .catch((error) => {
    console.error("fixture api-config-basic failed", error);
  });
