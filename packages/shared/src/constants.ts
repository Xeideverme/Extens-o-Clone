export const CLONE3D_VERSION = "0.1.0";

export const DEFAULT_INLINE_THRESHOLD_BYTES = 50 * 1024;

export const EXTENSION_MESSAGE_TYPES = {
  ping: "clone3d:ping",
  getStatus: "clone3d:getStatus",
  contentReady: "clone3d:contentReady",
  mainWorldEvent: "clone3d:mainWorldEvent"
} as const;

export const MAIN_WORLD_EVENT_TYPE = "CLONE3D_MAIN_EVENT";
