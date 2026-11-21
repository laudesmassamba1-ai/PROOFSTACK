import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useI18n } from "./i18n/index.js";
import { BrandLayout } from "./layouts/BrandLayout.js";

/** Route-level splitting keeps marketing, docs, the workspace and admin apart. */
const Home = lazy(() => import("./pages/Home.js").then((m) => ({ default: m.Home })));
const Product = lazy(() => import("./pages/Product.js").then((m) => ({ default: m.Product })));
const MarketingModulePage = lazy(() =>
  import("./pages/ModulePage.js").then((m) => ({ default: m.ModulePage }))
);
const Platform = lazy(() => import("./pages/Platform.js").then((m) => ({ default: m.Platform })));
const Pricing = lazy(() => import("./pages/Pricing.js").then((m) => ({ default: m.Pricing })));
const DownloadPage = lazy(() =>
  import("./pages/Download.js").then((m) => ({ default: m.DownloadPage }))
);
const Docs = lazy(() => import("./pages/Docs.js").then((m) => ({ default: m.Docs })));
const Changelog = lazy(() =>
  import("./pages/Changelog.js").then((m) => ({ default: m.Changelog }))
);
const Security = lazy(() => import("./pages/Security.js").then((m) => ({ default: m.Security })));
const ForgotPassword = lazy(() =>
  import("./pages/Account.js").then((m) => ({ default: m.ForgotPassword }))
);
const ResetPassword = lazy(() =>
  import("./pages/Account.js").then((m) => ({ default: m.ResetPassword }))
);
const VerifyEmail = lazy(() =>
  import("./pages/Account.js").then((m) => ({ default: m.VerifyEmail }))
);
const Support = lazy(() => import("./pages/Account.js").then((m) => ({ default: m.Support })));
const Terms = lazy(() => import("./pages/Legal.js").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("./pages/Legal.js").then((m) => ({ default: m.Privacy })));
const Cookies = lazy(() => import("./pages/Legal.js").then((m) => ({ default: m.Cookies })));
const Auth = lazy(() => import("./pages/Auth.js").then((m) => ({ default: m.Auth })));
const DeviceApproval = lazy(() =>
  import("./pages/DeviceApproval.js").then((m) => ({ default: m.DeviceApproval }))
);
const NotFound = lazy(() => import("./pages/NotFound.js").then((m) => ({ default: m.NotFound })));
const AppNotFound = lazy(() =>
  import("./pages/NotFound.js").then((m) => ({ default: m.AppNotFound }))
);
const AppLayout = lazy(() =>
  import("./layouts/AppLayout.js").then((m) => ({ default: m.AppLayout }))
);
const Overview = lazy(() =>
  import("./pages/app/Overview.js").then((m) => ({ default: m.Overview }))
);
const WorkspacePage = lazy(() =>
  import("./pages/app/Workspace.js").then((m) => ({ default: m.WorkspacePage }))
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
const ScanPage = lazy(() =>
  import("./pages/app/Scan.js").then((module) => ({ default: module.ScanPage }))
);
const StartPage = lazy(() =>
  import("./pages/app/Start.js").then((module) => ({ default: module.StartPage }))
);
const ModulesIndex = lazy(() =>
  import("./pages/app/ModulesIndex.js").then((m) => ({ default: m.ModulesIndexPage }))
);
const Cli = lazy(() => import("./pages/app/Cli.js").then((m) => ({ default: m.Cli })));
const TerminalPage = lazy(() =>
  import("./pages/app/Terminal.js").then((m) => ({ default: m.TerminalPage }))
);
const CliDocs = lazy(() => import("./pages/app/CliDocs.js").then((m) => ({ default: m.CliDocs })));
const Billing = lazy(() => import("./pages/app/Billing.js").then((m) => ({ default: m.Billing })));
const Settings = lazy(() =>
  import("./pages/app/Settings.js").then((m) => ({ default: m.Settings }))
);
const Admin = lazy(() => import("./pages/app/Admin.js").then((m) => ({ default: m.Admin })));
const AiChat = lazy(() => import("./pages/app/AiChat.js").then((m) => ({ default: m.AiChatPage })));
const LocalAgent = lazy(() =>
  import("./pages/app/LocalAgent.js").then((m) => ({ default: m.LocalAgentPage }))
);

function RouteFallback() {
  const { t } = useI18n();
  return (
    <div
      className="grid min-h-screen place-items-center bg-brand-black"
      role="status"
      aria-live="polite"
    >
      <span className="eyebrow">{t("ws.loading")}</span>
    </div>
  );
}

export function App() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<RouteFallback />}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        {t("mkt.skip")}
      </a>
      <Routes>
        <Route element={<BrandLayout />}>
          <Route index element={<Home />} />
          <Route path="product" element={<Product />} />
          <Route path="world" element={<MarketingModulePage name="world" />} />
          <Route path="flow" element={<MarketingModulePage name="flow" />} />
          <Route path="exit" element={<MarketingModulePage name="exit" />} />
          <Route path="fail" element={<MarketingModulePage name="fail" />} />
          <Route path="clean" element={<MarketingModulePage name="clean" />} />
          <Route path="platform" element={<Platform />} />
          <Route path="pricing" element={<Pricing />} />
          <Route path="download" element={<DownloadPage />} />
          <Route path="docs" element={<Docs />} />
          <Route path="changelog" element={<Changelog />} />
          <Route path="security" element={<Security />} />
          <Route path="signin" element={<Auth mode="in" />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="verify-email" element={<VerifyEmail />} />
          <Route path="support" element={<Support />} />
          <Route path="legal/terms" element={<Terms />} />
          <Route path="legal/privacy" element={<Privacy />} />
          <Route path="legal/cookies" element={<Cookies />} />
          <Route path="device" element={<DeviceApproval />} />
          <Route path="signup" element={<Auth mode="up" />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Authenticated application. AppLayout redirects when there is no session. */}
        <Route path="/app" element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="modules" element={<ModulesIndex />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="start" element={<StartPage />} />
          <Route path="modules/:module" element={<AppModulePage />} />
          <Route path="cli" element={<Cli />} />
          <Route path="cli/docs" element={<CliDocs />} />
          <Route path="terminal" element={<TerminalPage />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
          <Route path="ai" element={<AiChat />} />
          {/* The local console lives inside the assistant, not as a second AI section. */}
          <Route path="ai/local" element={<LocalAgent />} />
          <Route path="agent" element={<Navigate to="/app/ai/local" replace />} />
          <Route path="admin" element={<Admin />} />
          {/* Known app routes must not fall through to the marketing 404. */}
          <Route path="*" element={<AppNotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
