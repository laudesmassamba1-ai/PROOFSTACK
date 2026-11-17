import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { BrandLayout } from "./layouts/BrandLayout.js";

/** Route-level splitting keeps marketing, docs, the workspace and admin apart. */
const Home = lazy(() => import("./pages/Home.js").then((m) => ({ default: m.Home })));
const Product = lazy(() => import("./pages/Product.js").then((m) => ({ default: m.Product })));
const MarketingModulePage = lazy(() =>
  import("./pages/ModulePage.js").then((m) => ({ default: m.ModulePage }))
);
const Platform = lazy(() => import("./pages/Platform.js").then((m) => ({ default: m.Platform })));
const Pricing = lazy(() => import("./pages/Pricing.js").then((m) => ({ default: m.Pricing })));
const Docs = lazy(() => import("./pages/Docs.js").then((m) => ({ default: m.Docs })));
const Changelog = lazy(() =>
  import("./pages/Changelog.js").then((m) => ({ default: m.Changelog }))
);
const Security = lazy(() => import("./pages/Security.js").then((m) => ({ default: m.Security })));
const Auth = lazy(() => import("./pages/Auth.js").then((m) => ({ default: m.Auth })));
const NotFound = lazy(() => import("./pages/NotFound.js").then((m) => ({ default: m.NotFound })));
const AppLayout = lazy(() =>
  import("./layouts/AppLayout.js").then((m) => ({ default: m.AppLayout }))
);
const Overview = lazy(() =>
  import("./pages/app/Overview.js").then((m) => ({ default: m.Overview }))
);
const Projects = lazy(() =>
  import("./pages/app/Projects.js").then((m) => ({ default: m.Projects }))
);
const ProjectDetail = lazy(() =>
  import("./pages/app/ProjectDetail.js").then((m) => ({ default: m.ProjectDetail }))
);
const AppModulePage = lazy(() =>
  import("./pages/app/ModulePage.js").then((m) => ({ default: m.ModulePage }))
);
const Cli = lazy(() => import("./pages/app/Cli.js").then((m) => ({ default: m.Cli })));
const Billing = lazy(() => import("./pages/app/Billing.js").then((m) => ({ default: m.Billing })));
const Settings = lazy(() =>
  import("./pages/app/Settings.js").then((m) => ({ default: m.Settings }))
);
const Admin = lazy(() => import("./pages/app/Admin.js").then((m) => ({ default: m.Admin })));

function RouteFallback() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-brand-black"
      role="status"
      aria-live="polite"
    >
      <span className="eyebrow">Loading…</span>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
          <Route path="world" element={<MarketingModulePage name="world" />} />
          <Route path="flow" element={<MarketingModulePage name="flow" />} />
          <Route path="exit" element={<MarketingModulePage name="exit" />} />
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
          <Route path="modules/:module" element={<AppModulePage />} />
          <Route path="cli" element={<Cli />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
