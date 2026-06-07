const worker = new Worker("./worker.js", { type: "module" });
worker.postMessage("boot");
