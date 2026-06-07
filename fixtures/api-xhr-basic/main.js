const xhr = new XMLHttpRequest();
xhr.open("GET", "./api/config.json");
xhr.onload = () => {
  window.__clone3dXhrConfig = JSON.parse(xhr.responseText);
};
xhr.send();
