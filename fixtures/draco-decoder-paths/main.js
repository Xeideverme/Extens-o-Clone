const dracoLoader = {
  setDecoderPath(path) {
    window.__dracoPath = path;
  }
};
dracoLoader.setDecoderPath("./draco/");
fetch("./draco/draco_decoder.wasm");
