import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/common/ErrorBoundary.js";
import { I18nProvider } from "./i18n/index.js";
import { initCaretFollower } from "./lib/caret-follower.js";
import { SessionProvider } from "./lib/session.js";
import { ThemeProvider } from "./lib/theme.js";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

// The caret follower keeps the line being typed on screen, in every scroller. It is a plain
// DOM helper, not a hook: calling useEffect outside a component throws at render.
initCaretFollower();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <BrowserRouter>
            <SessionProvider>
              <App />
            </SessionProvider>
          </BrowserRouter>
        </I18nProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
