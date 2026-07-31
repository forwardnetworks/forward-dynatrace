import React from "react";

import "./Header.css";

const forwardLogoUrl = "assets/forward-logo.svg";

export const Header = () => {
  return (
    <header className="app-shell-header">
      <div className="app-shell-brand">
        <span className="app-shell-logo">
          <img src={forwardLogoUrl} alt="Forward" />
        </span>
        <span>Forward for Dynatrace</span>
      </div>
    </header>
  );
};
