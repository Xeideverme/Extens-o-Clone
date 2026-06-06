const message = document.querySelector("#message");

const dynamicImage = new Image();
dynamicImage.alt = "Dynamic fixture asset";
dynamicImage.width = 96;
dynamicImage.height = 96;
dynamicImage.src = "./images/dynamic.svg";
document.querySelector("main")?.appendChild(dynamicImage);

const response = await fetch("./dados.json");
const data = await response.json();

if (message) {
  message.textContent = data.message;
}
