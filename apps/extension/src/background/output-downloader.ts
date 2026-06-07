export async function downloadGeneratedHtml(filename: string, html: string, saveAs: boolean): Promise<number> {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  let objectUrl: string | undefined;
  const url =
    typeof URL.createObjectURL === "function"
      ? (objectUrl = URL.createObjectURL(blob))
      : `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  try {
    return await chrome.downloads.download({
      url,
      filename,
      saveAs
    });
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    }
  }
}
