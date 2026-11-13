import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { libraryLoaded } from "./api";
import { App } from "./App";
import "./styles.css";

// Which calibre library to show is known only after /ajax/library-info answers.
libraryLoaded.then(() =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  ),
);
