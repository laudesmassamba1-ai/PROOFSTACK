import { Route, Routes } from "react-router";
import { AppLayout } from "./layouts/AppLayout.js";
import { BrandLayout } from "./layouts/BrandLayout.js";
import { Auth } from "./pages/Auth.js";
import { Billing } from "./pages/app/Billing.js";
import { Overview } from "./pages/app/Overview.js";
import { ProjectDetail } from "./pages/app/ProjectDetail.js";
import { Projects } from "./pages/app/Projects.js";
import { Settings } from "./pages/app/Settings.js";
import { Changelog } from "./pages/Changelog.js";
import { Docs } from "./pages/Docs.js";
import { Home } from "./pages/Home.js";
import { ModulePage } from "./pages/ModulePage.js";
import { NotFound } from "./pages/NotFound.js";
import { Platform } from "./pages/Platform.js";
import { Pricing } from "./pages/Pricing.js";
import { Product } from "./pages/Product.js";
import { Security } from "./pages/Security.js";

export function App() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        Skip to content
      </a>
      <Routes>
        <Route element={<BrandLayout />}>
          <Route index element={<Home />} />
          <Route path="product" element={<Product />} />
          <Route path="world" element={<ModulePage name="world" />} />
          <Route path="flow" element={<ModulePage name="flow" />} />
          <Route path="exit" element={<ModulePage name="exit" />} />
          <Route path="platform" element={<Platform />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="docs" element={<Docs />} />
          <Route path="changelog" element={<Changelog />} />
          <Route path="security" element={<Security />} />
          <Route path="signin" element={<Auth mode="in" />} />
          <Route path="signup" element={<Auth mode="up" />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Authenticated application. AppLayout redirects when there is no session. */}
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}
