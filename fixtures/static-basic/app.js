const message = document.querySelector("#message");

const response = await fetch("./data.json");
const data = await response.json();

if (message) {
  message.textContent = data.message;
}
