fetch("./dados.json").then((response) => response.json()).then(console.log);

const modelUrl = new URL("./assets/model.glb", import.meta.url);
console.log(modelUrl.href);

const loader = {
  load(url) {
    console.log("load", url);
  }
};
loader.load("./assets/model.glb");

import("./chunk.js").then((module) => module.run());
