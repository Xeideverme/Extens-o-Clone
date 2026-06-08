import "./style.css";
const chunk = await import("./chunk-yyyyy.js");
const config = await fetch("./config.json").then((response) => response.json());
document.body.dataset.vite = `${chunk.value}:${config.name}`;
