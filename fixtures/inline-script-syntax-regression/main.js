const literal = "</script>";
const template = `template </script>`;
// comment </script>
const line = "line\u2028separator";
await import("./chunk.js");
document.body.dataset.literal = literal + template + line;
