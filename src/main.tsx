import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./core/chat/styles/default.css";
import "./styles.css";
import "./chat/demo/addToChat.register";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
