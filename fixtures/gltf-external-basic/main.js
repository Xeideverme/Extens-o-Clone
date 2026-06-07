const sceneUrl = new URL("./scene.gltf", import.meta.url).href;
fetch(sceneUrl)
  .then((response) => response.json())
  .then((scene) => {
    window.__fixtureScene = scene;
  });
