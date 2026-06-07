self.onmessage = async () => {
  const response = await fetch("./module.wasm");
  self.postMessage({ size: (await response.arrayBuffer()).byteLength });
};
