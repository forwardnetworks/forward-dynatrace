import React from "react";
import { Link } from "react-router-dom";

import "./Header.css";

const forwardLogoUrl = "assets/forward-logo.svg";

export const Header = () => {
  return (
    <header className="app-shell-header">
      <Link className="app-shell-brand" to="/">
        <span className="app-shell-logo">
          <img src={forwardLogoUrl} alt="Forward" />
        </span>
        <span>forward.dynatrace</span>
      </Link>
    </header>
  );
};
