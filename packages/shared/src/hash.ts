export async function sha256Blob(blob: Blob): Promise<string> {
  return sha256ArrayBuffer(await blob.arrayBuffer());
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return arrayBufferToHex(digest);
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
