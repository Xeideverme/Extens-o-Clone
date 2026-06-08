const chunk = await import("./fx27je.js");
const config = await fetch("./config.json").then((response) => response.json());
document.body.dataset.chunk = chunk.value;
document.body.dataset.config = config.ok ? "ok" : "fail";
