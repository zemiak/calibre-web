import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { libraryLoaded } from "./api";
import { App } from "./App";
import { stateLoaded } from "./progress";
import "./styles.css";

// Which calibre library to show is known only after /ajax/library-info answers; the reading state
// (per user behind the sign-in proxy, else this browser.s) is read before the first render too.
Promise.all([libraryLoaded, stateLoaded]).then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  ),
);
