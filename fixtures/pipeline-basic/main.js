fetch("./api/config.json")
  .then((response) => response.json())
  .then((config) => {
    window.__clone3dPipelineConfig = config;
  });
