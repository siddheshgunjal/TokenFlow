import React from "react";
import ReactDOM from "react-dom/client";

import { Widget } from "./widget/Widget";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Widget />
  </React.StrictMode>,
);
