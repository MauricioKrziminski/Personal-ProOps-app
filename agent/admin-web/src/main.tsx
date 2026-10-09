import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installCapture } from "./lib/capture";

installCapture();

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
