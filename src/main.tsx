import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { startDirector } from "./game/director";
import { game } from "./game/client";
import { mic } from "./audio/mic";
import { voice } from "./audio/voice";
import { director } from "./game/director";
import { recorder } from "./audio/recorder";

startDirector();

// أدوات فحص للاختبارات الآلية (في التطوير، أو بإضافة ?debug=1)
if (import.meta.env.DEV || new URLSearchParams(location.search).has("debug")) {
  Object.assign(window, { __gallidha: { game, mic, voice, director, recorder } });
}

if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
