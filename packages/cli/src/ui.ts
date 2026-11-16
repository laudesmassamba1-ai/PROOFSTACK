import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

/**
 * The PROOFSTACK terminal console.
 *
 * This is deliberately dependency-free: the CLI already ships as a Node package, and a
 * full-screen UI should not add an install step or a native dependency. It talks to the
 * same API as the browser with the same HttpOnly session cookie, but stores that cookie
 * locally with mode 0600 so a terminal session can survive a restart. Passwords are
 * never stored; `proofstack logout` removes the cookie file.
 *
 * The TUI is read-only except for explicit project creation. "Pilot the app" means
 * seeing the workspace, projects, runs, plan and payments without opening a browser;
 * creating a project is confirmed through a form, while test execution and uploads
 * still happen locally through `proofstack test` / `proofstack sync`.
 */

export const DEFAULT_API_URL = "https://proofstack-iota.vercel.app";
export const SCREENS = ["overview", "projects", "runs", "billing", "admin", "help"] as const;
export type Screen = (typeof SCREENS)[number];

const LABELS: Record<Screen, string> = {
  overview: "Overview",
  projects: "Projects",
  runs: "Runs",
  billing: "Billing",
  admin: "Admin",
  help: "Help",
};

export interface StoredSession {
  apiUrl: string;
  cookie: string;
  email: string;
  savedAt: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface SessionPayload {
  user: SessionUser | null;
  workspaces?: SessionWorkspace[];
  isAdmin?: boolean;
}

export interface Overview {
  workspace: { id: string; name: string; myRole: string };
  projects: Project[];
  recentRuns: Run[];
  recentFailures: {
    id: string;
    title: string;
    module: string;
    severity: string;
    detectedAt: string;
  }[];
  usage: {
    counters: { key: string; label: string; used: number; limit: number }[];
  };
  subscription: {
    planKey: string;
    planName: string;
    entitled: boolean;
    state: string;
    amountMinor: string | null;
    currency: string | null;
    recurringSupported: boolean;
    renewalDueAt: string | null;
    currentPeriodEnd: string | null;
  };
}

export interface Project {
  id: string;
  name: string;
  baseUrl: string;
  environment: string;
  enabledModules: string[];
  lastRunAt?: string;
  lastRunStatus?: string;
}

export const PROJECT_ENVIRONMENTS = ["local", "staging", "production", "ci"] as const;
export type ProjectEnvironment = (typeof PROJECT_ENVIRONMENTS)[number];
export const PROJECT_MODULES = ["world", "flow", "exit"] as const;
export type ProjectFormField = "name" | "baseUrl" | "stack" | "environment";

export interface ProjectFormState {
  name: string;
  baseUrl: string;
  stack: string;
  environment: ProjectEnvironment;
  field: ProjectFormField;
  error: string | null;
  busy: boolean;
}

export interface Run {
  id: string;
  projectId: string;
  projectName?: string;
  status: string;
  environment?: string;
  startedAt: string;
  durationMs: number;
  findingCount: number;
  totals: Record<
    string,
    {
      passed: number;
      failed: number;
      warnings: number;
      errors: number;
      skipped: number;
      total: number;
    }
  >;
}

export interface BillingData {
  subscription: {
    planName: string;
    planKey: string;
    entitled: boolean;
    state: string;
    amountMinor: string | null;
    currency: string | null;
    currentPeriodEnd: string | null;
    renewalDueAt: string | null;
    recurringSupported: boolean;
  };
  usage: { key: string; label: string; used: number; limit: number }[];
  payments: {
    id: string;
    planKey: string;
    state: string;
    amount: { currency: string; minor: string };
    credited: boolean;
    createdAt: string;
    failureReason?: string;
  }[];
  provider: { name: string; slug: string; notes: string[] };
}

export interface AdminOverview {
  generatedAt: string;
  admin: { email: string };
  provider: { slug: string; displayName: string; live: boolean };
  totals: {
    users: number;
    workspaces: number;
    projects: number;
    activeSubscriptions: number;
    runs24h: number;
    runs7d: number;
    failedFindings7d: number;
    failedWebhooks: number;
    latestMigration: string | null;
  };
  revenue: { currency: string; minor: string; payments: number }[];
  paymentsByState: { state: string; count: number }[];
  payments: {
    workspaceName: string;
    planKey: string;
    amountMinor: string;
    currency: string;
    state: string;
    credited: boolean;
    createdAt: string;
  }[];
  users: { email: string; name: string; createdAt: string }[];
  runs: { workspaceName: string; projectName: string; status: string; startedAt: string }[];
}

export interface UiState {
  screen: Screen;
  session: StoredSession;
  auth: SessionPayload;
  workspaceId: string;
  overview: Overview | null;
  projects: Project[] | null;
  runs: Run[] | null;
  billing: BillingData | null;
  admin: AdminOverview | null;
  adminError: string | null;
  projectForm: ProjectFormState | null;
  selectedProject: number;
  selectedRun: number;
  projectFilter: string | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  loadSeq: number;
}

export interface UiOptions {
  apiUrl?: string;
  once?: boolean;
  screen?: Screen;
  width?: number;
  height?: number;
  color?: boolean;
}

export class UiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "UiApiError";
  }
}

// ------------------------------------------------------------------- session files

export function resolveApiUrl(explicit?: string): string {
  const value = explicit ?? process.env.PROOFSTACK_API_URL ?? DEFAULT_API_URL;
  return value.replace(/\/+$/, "");
}

export function sessionFilePath(): string {
  if (process.env.PROOFSTACK_SESSION_FILE) return process.env.PROOFSTACK_SESSION_FILE;
  const root =
    process.env.PROOFSTACK_CONFIG_HOME ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(root, "proofstack", "session.json");
}

export async function loadStoredSession(apiUrl = resolveApiUrl()): Promise<StoredSession | null> {
  const envCookie = process.env.PROOFSTACK_SESSION_COOKIE?.trim();
  if (envCookie) {
    return {
      apiUrl,
      cookie: envCookie,
      email: process.env.PROOFSTACK_SESSION_EMAIL ?? "environment",
      savedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = await readFile(sessionFilePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.apiUrl !== "string" ||
      typeof parsed.cookie !== "string" ||
      parsed.cookie.length === 0
    ) {
      return null;
    }
    // A cookie is scoped to the API that issued it. Reusing it against a different
    // URL would leak the session, so a mismatch behaves like no session.
    if (parsed.apiUrl.replace(/\/+$/, "") !== apiUrl.replace(/\/+$/, "")) return null;
    return {
      apiUrl: parsed.apiUrl.replace(/\/+$/, ""),
      cookie: parsed.cookie,
      email: typeof parsed.email === "string" ? parsed.email : "unknown",
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return null;
  }
}

export async function saveStoredSession(session: StoredSession): Promise<void> {
  const path = sessionFilePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // Some filesystems ignore the create mode; enforce it explicitly.
  await chmod(path, 0o600).catch(() => undefined);
}

export async function clearStoredSession(): Promise<boolean> {
  try {
    await rm(sessionFilePath(), { force: false });
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------- HTTP

export async function signIn(
  apiUrl: string,
  email: string,
  password: string
): Promise<StoredSession> {
  const response = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text);
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const rawCookie = headers.getSetCookie?.()[0] ?? headers.get("set-cookie");
  const cookie = rawCookie?.split(";")[0];
  if (!cookie) {
    throw new UiApiError(
      "The API accepted the sign-in but did not return a session cookie.",
      502,
      "missing_session_cookie"
    );
  }
  let userEmail = email;
  try {
    const body = JSON.parse(text) as { user?: { email?: string } };
    if (body.user?.email) userEmail = body.user.email;
  } catch {
    // The cookie is what matters; the email is only a display hint.
  }
  return { apiUrl, cookie, email: userEmail, savedAt: new Date().toISOString() };
}

export async function apiGet<T>(session: StoredSession, path: string): Promise<T> {
  const response = await fetch(`${session.apiUrl}${path}`, {
    headers: {
      accept: "application/json",
      cookie: session.cookie,
      "cache-control": "no-store",
    },
  });
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text);
  return (text.length === 0 ? ({} as T) : JSON.parse(text)) as T;
}

export async function apiPost<T>(session: StoredSession, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${session.apiUrl}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: session.cookie,
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw apiError(response.status, text);
  return (text.length === 0 ? ({} as T) : JSON.parse(text)) as T;
}

function apiError(status: number, text: string): UiApiError {
  let code = `http_${status}`;
  let message = `HTTP ${status}`;
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (body.error?.code) code = body.error.code;
    if (body.error?.message) message = body.error.message;
  } catch {
    if (text.length > 0) message = text.slice(0, 240);
  }
  return new UiApiError(message, status, code);
}

// ------------------------------------------------------------------------- login

export async function loginInteractive(input: {
  apiUrl?: string;
  email?: string;
}): Promise<StoredSession> {
  if (!stdin.isTTY) {
    throw new Error(
      "Interactive login needs a terminal. Set PROOFSTACK_SESSION_COOKIE to use `proofstack ui` in scripts."
    );
  }
  const rl = createInterface({ input: stdin, output: stdout });
  let apiUrl = resolveApiUrl(input.apiUrl);
  let email = input.email ?? "";
  try {
    apiUrl = (await rl.question(`API URL (${apiUrl}): `)).trim().replace(/\/+$/, "") || apiUrl;
    email = (await rl.question(`Email${email ? ` (${email})` : ""}: `)).trim() || email;
  } finally {
    rl.close();
  }
  if (!email.includes("@")) throw new Error("An email address is required.");
  const password = await readHidden("Password: ");
  if (password.length === 0) throw new Error("A password is required.");
  const session = await signIn(apiUrl, email, password);
  await saveStoredSession(session);
  stdout.write(
    `\nSigned in as ${session.email}.\nSession stored at ${sessionFilePath()} (mode 0600).\n`
  );
  return session;
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    const previousRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = (): void => {
      stdin.setRawMode(Boolean(previousRaw));
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

// -------------------------------------------------------------------- snapshot/tui

export async function runUi(options: UiOptions): Promise<number> {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const screen = options.screen ?? "overview";

  if (options.once && screen === "help") {
    stdout.write(`${renderHelp(100, options.color ?? false)}\n`);
    return 0;
  }

  let session = await loadStoredSession(apiUrl);
  if (!session && stdin.isTTY && !options.once) {
    session = await loginInteractive({ apiUrl });
  }
  if (!session) {
    process.stderr.write(
      `Not signed in. Run \`proofstack login\` (or set PROOFSTACK_SESSION_COOKIE for CI).\n`
    );
    return 2;
  }

  let auth: SessionPayload;
  try {
    auth = await apiGet<SessionPayload>(session, "/api/auth/session");
  } catch (error) {
    process.stderr.write(`${describeError(error)}\n`);
    return 2;
  }
  if (!auth.user) {
    process.stderr.write(
      "The stored session is no longer valid. Run `proofstack login` to sign in again.\n"
    );
    return 2;
  }
  const workspaces = auth.workspaces ?? [];
  if (workspaces.length === 0) {
    process.stderr.write("This account has no workspace yet. Create one in the web app first.\n");
    return 2;
  }

  const state: UiState = {
    screen,
    session,
    auth,
    workspaceId: workspaces[0]!.id,
    overview: null,
    projects: null,
    runs: null,
    billing: null,
    admin: null,
    adminError: null,
    projectForm: null,
    selectedProject: 0,
    selectedRun: 0,
    projectFilter: null,
    loading: true,
    error: null,
    notice: null,
    loadSeq: 0,
  };

  const rerender = (): void => {
    if (!options.once) {
      stdout.write(`\u001B[H${renderScreen(state, terminalWidth(), terminalHeight(), true)}`);
    }
  };

  await loadCurrent(state, rerender);
  state.loading = false;

  if (options.once) {
    stdout.write(
      `${renderScreen(state, options.width ?? 100, options.height ?? 40, options.color ?? false)}\n`
    );
    return 0;
  }

  if (!stdin.isTTY) {
    process.stderr.write("The full-screen console needs a TTY. Use `proofstack ui --once`.\n");
    return 2;
  }

  return interactiveLoop(state, rerender);
}

function interactiveLoop(state: UiState, rerender: () => void): Promise<number> {
  return new Promise((resolve) => {
    const previousRaw = stdin.isRaw;
    const onResize = (): void => rerender();
    const cleanup = (): void => {
      stdout.off("resize", onResize);
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(previousRaw));
      stdin.pause();
      stdout.write("\u001B[?25h\u001B[?1049l");
    };
    const quit = (): void => {
      cleanup();
      resolve(0);
    };
    const changeScreen = (next: Screen): void => {
      if (state.screen === next) return;
      state.screen = next;
      state.selectedProject = 0;
      state.selectedRun = 0;
      state.notice = null;
      state.error = null;
      state.adminError = null;
      rerender();
      void loadCurrent(state, rerender).then(rerender);
    };
    const cycleWorkspace = (): void => {
      const list = state.auth.workspaces ?? [];
      if (list.length < 2) {
        state.notice = "This account belongs to one workspace.";
        rerender();
        return;
      }
      const index = list.findIndex((workspace) => workspace.id === state.workspaceId);
      const next = list[(index + 1) % list.length]!;
      state.workspaceId = next.id;
      state.overview = null;
      state.projects = null;
      state.runs = null;
      state.billing = null;
      state.admin = null;
      state.projectFilter = null;
      state.notice = `Workspace: ${next.name}`;
      rerender();
      void loadCurrent(state, rerender).then(rerender);
    };
    const onData = (chunk: string): void => {
      if (chunk === "\u0003") {
        quit();
        return;
      }
      if (state.projectForm) {
        handleProjectFormKey(state, chunk, rerender);
        return;
      }
      if (chunk === "q") {
        quit();
        return;
      }
      if (chunk === "n" && state.screen === "projects") {
        openProjectForm(state);
        rerender();
        return;
      }
      if (chunk === "\t" || chunk === "\u001B[C") {
        changeScreen(SCREENS[(SCREENS.indexOf(state.screen) + 1) % SCREENS.length]!);
        return;
      }
      if (chunk === "\u001B[Z" || chunk === "\u001B[D") {
        changeScreen(
          SCREENS[(SCREENS.indexOf(state.screen) - 1 + SCREENS.length) % SCREENS.length]!
        );
        return;
      }
      if (/^[1-6]$/.test(chunk)) {
        changeScreen(SCREENS[Number(chunk) - 1]!);
        return;
      }
      if (chunk === "?") {
        changeScreen("help");
        return;
      }
      if (chunk === "r") {
        state.notice = "Refreshing…";
        rerender();
        void loadCurrent(state, rerender).then(rerender);
        return;
      }
      if (chunk === "w") {
        cycleWorkspace();
        return;
      }
      if (chunk === "\u001B[A" || chunk === "k") {
        if (state.screen === "projects") {
          state.selectedProject = Math.max(0, state.selectedProject - 1);
        }
        if (state.screen === "runs") state.selectedRun = Math.max(0, state.selectedRun - 1);
        rerender();
        return;
      }
      if (chunk === "\u001B[B" || chunk === "j") {
        if (state.screen === "projects") {
          state.selectedProject = Math.min(
            Math.max(0, (state.projects?.length ?? 1) - 1),
            state.selectedProject + 1
          );
        }
        if (state.screen === "runs") {
          state.selectedRun = Math.min(
            Math.max(0, (state.runs?.length ?? 1) - 1),
            state.selectedRun + 1
          );
        }
        rerender();
        return;
      }
      if (chunk === "\r" || chunk === "\n") {
        if (state.screen === "projects") {
          const project = state.projects?.[state.selectedProject];
          if (project) {
            state.projectFilter = project.id;
            state.screen = "runs";
            state.selectedRun = 0;
            state.runs = null;
            rerender();
            void loadCurrent(state, rerender).then(rerender);
          }
          return;
        }
        if (state.screen === "overview") {
          changeScreen("projects");
          return;
        }
      }
      if (chunk === "\u001B") {
        if (state.projectFilter) {
          state.projectFilter = null;
          state.runs = null;
          rerender();
          void loadCurrent(state, rerender).then(rerender);
        } else if (state.screen !== "overview") {
          changeScreen("overview");
        }
      }
    };
    stdout.write("\u001B[?1049h\u001B[?25l");
    stdout.on("resize", onResize);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    rerender();
  });
}

const PROJECT_FORM_FIELDS: readonly ProjectFormField[] = [
  "name",
  "baseUrl",
  "stack",
  "environment",
];

function openProjectForm(state: UiState): void {
  state.projectForm = {
    name: "",
    baseUrl: "http://localhost:3000",
    stack: "",
    environment: "local",
    field: "name",
    error: null,
    busy: false,
  };
  state.error = null;
  state.notice = null;
}

function moveProjectField(form: ProjectFormState, delta: number): void {
  const index = PROJECT_FORM_FIELDS.indexOf(form.field);
  const next =
    PROJECT_FORM_FIELDS[(index + delta + PROJECT_FORM_FIELDS.length) % PROJECT_FORM_FIELDS.length];
  if (next) form.field = next;
  form.error = null;
}

function cycleEnvironment(form: ProjectFormState, delta: number): void {
  const index = PROJECT_ENVIRONMENTS.indexOf(form.environment);
  const next =
    PROJECT_ENVIRONMENTS[
      (index + delta + PROJECT_ENVIRONMENTS.length) % PROJECT_ENVIRONMENTS.length
    ];
  if (next) form.environment = next;
  form.error = null;
}

function appendProjectFormText(form: ProjectFormState, character: string): void {
  switch (form.field) {
    case "name":
      if (form.name.length < 120) form.name += character;
      break;
    case "baseUrl":
      if (form.baseUrl.length < 2048) form.baseUrl += character;
      break;
    case "stack":
      if (form.stack.length < 60) form.stack += character;
      break;
    case "environment":
      if (character === " ") cycleEnvironment(form, 1);
      break;
  }
  form.error = null;
}

function deleteProjectFormText(form: ProjectFormState): void {
  switch (form.field) {
    case "name":
      form.name = form.name.slice(0, -1);
      break;
    case "baseUrl":
      form.baseUrl = form.baseUrl.slice(0, -1);
      break;
    case "stack":
      form.stack = form.stack.slice(0, -1);
      break;
    case "environment":
      break;
  }
  form.error = null;
}

function clearProjectFormText(form: ProjectFormState): void {
  switch (form.field) {
    case "name":
      form.name = "";
      break;
    case "baseUrl":
      form.baseUrl = "";
      break;
    case "stack":
      form.stack = "";
      break;
    case "environment":
      break;
  }
  form.error = null;
}

function handleProjectFormKey(state: UiState, chunk: string, rerender: () => void): void {
  const form = state.projectForm;
  if (!form || form.busy) return;

  if (chunk === "\u001B") {
    state.projectForm = null;
    state.notice = "Project creation cancelled.";
    rerender();
    return;
  }
  if (chunk === "\t" || chunk === "\u001B[B") {
    moveProjectField(form, 1);
    rerender();
    return;
  }
  if (chunk === "\u001B[Z" || chunk === "\u001B[A") {
    moveProjectField(form, -1);
    rerender();
    return;
  }
  if (chunk === "\u001B[C" || chunk === "\u001B[D") {
    if (form.field === "environment") cycleEnvironment(form, chunk === "\u001B[C" ? 1 : -1);
    rerender();
    return;
  }
  if (chunk === "\r" || chunk === "\n") {
    if (form.field === "environment") void submitProject(state, rerender);
    else moveProjectField(form, 1);
    rerender();
    return;
  }
  if (chunk === "\u0013") {
    void submitProject(state, rerender);
    return;
  }
  if (chunk === "\u007F" || chunk === "\b") {
    deleteProjectFormText(form);
    rerender();
    return;
  }
  if (chunk === "\u0015") {
    clearProjectFormText(form);
    rerender();
    return;
  }
  if (chunk.startsWith("\u001B")) return;
  for (const character of chunk) {
    if (character < " " || character === "\u007F") continue;
    appendProjectFormText(form, character);
  }
  rerender();
}

export function validateProjectDraft(
  draft: Pick<ProjectFormState, "name" | "baseUrl" | "stack">
): string | null {
  const name = draft.name.trim();
  const baseUrl = draft.baseUrl.trim();
  if (name.length === 0) return "Project name is required.";
  if (name.length > 120) return "Project name must be 120 characters or fewer.";
  if (baseUrl.length === 0) return "Base URL is required.";
  if (baseUrl.length > 2048) return "Base URL must be 2048 characters or fewer.";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Base URL must start with http:// or https://.";
    }
  } catch {
    return "Base URL must be a valid http(s) URL.";
  }
  if (draft.stack.length > 60) return "Stack must be 60 characters or fewer.";
  return null;
}

async function submitProject(state: UiState, rerender: () => void): Promise<void> {
  const form = state.projectForm;
  if (!form || form.busy) return;

  const validation = validateProjectDraft(form);
  if (validation) {
    form.error = validation;
    rerender();
    return;
  }

  form.busy = true;
  form.error = null;
  state.error = null;
  rerender();

  try {
    const response = await apiPost<{ project: Project }>(state.session, "/api/v1/projects", {
      workspaceId: state.workspaceId,
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      ...(form.stack.trim() ? { stack: form.stack.trim() } : {}),
      environment: form.environment,
      enabledModules: [...PROJECT_MODULES],
    });
    const created = response.project;
    if (!created || typeof created.id !== "string") {
      throw new UiApiError(
        "The API accepted the request but did not return the created project.",
        502,
        "invalid_response"
      );
    }

    state.projectForm = null;
    state.selectedProject = 0;
    await loadCurrent(state, rerender);
    const index = state.projects?.findIndex((project) => project.id === created.id) ?? -1;
    if (index >= 0) state.selectedProject = index;
    state.notice = `Project "${created.name}" created.`;
    rerender();
  } catch (error) {
    if (state.projectForm) {
      state.projectForm.busy = false;
      state.projectForm.error = describeError(error);
      rerender();
    }
  }
}

async function loadCurrent(state: UiState, rerender: () => void): Promise<void> {
  const sequence = ++state.loadSeq;
  state.loading = true;
  state.error = null;
  if (state.screen === "admin") state.adminError = null;
  rerender();
  try {
    const query = `workspaceId=${encodeURIComponent(state.workspaceId)}`;
    switch (state.screen) {
      case "overview":
        state.overview = await apiGet<Overview>(state.session, `/api/v1/overview?${query}`);
        break;
      case "projects":
        state.projects = (
          await apiGet<{ items: Project[] }>(state.session, `/api/v1/projects?${query}`)
        ).items;
        break;
      case "runs":
        state.runs = state.projectFilter
          ? (
              await apiGet<{ items: Run[] }>(
                state.session,
                `/api/v1/projects/${encodeURIComponent(state.projectFilter)}/runs?${query}&limit=50`
              )
            ).items
          : (await apiGet<{ items: Run[] }>(state.session, `/api/v1/runs?${query}&limit=50`)).items;
        break;
      case "billing":
        state.billing = await apiGet<BillingData>(state.session, `/api/v1/billing?${query}`);
        break;
      case "admin":
        state.admin = await apiGet<AdminOverview>(state.session, "/api/v1/admin/overview?limit=50");
        break;
      case "help":
        break;
    }
    state.notice = null;
  } catch (error) {
    if (sequence === state.loadSeq) {
      state.error = describeError(error);
      if (state.screen === "admin") state.adminError = state.error;
    }
  } finally {
    if (sequence === state.loadSeq) state.loading = false;
  }
}

// ------------------------------------------------------------------------ render

export function renderScreen(state: UiState, width = 100, height = 40, color = true): string {
  const lines: string[] = [];
  const paint = (code: string, text: string): string =>
    color ? `\u001B[${code}m${text}\u001B[0m` : text;
  const add = (text = ""): void => {
    lines.push(fit(text, width));
  };
  const workspace = (state.auth.workspaces ?? []).find((item) => item.id === state.workspaceId);

  add(`${paint("1", "PROOFSTACK")} ${paint("2", "· terminal console")}`);
  add(
    paint(
      "2",
      `${state.auth.user?.email ?? state.session.email} · ${state.session.apiUrl.replace(/^https?:\/\//, "")}`
    )
  );
  add(
    SCREENS.map((item, index) =>
      item === state.screen
        ? paint("7", ` ${index + 1} ${LABELS[item]} `)
        : paint("2", ` ${index + 1} ${LABELS[item]} `)
    ).join(" ")
  );
  add(paint("2", "─".repeat(Math.max(1, Math.min(width, 100)))));

  if (state.projectForm) {
    for (const line of renderProjectForm(state, paint, width)) add(line);
  } else if (state.loading) {
    add(paint("2", "Loading…"));
  } else {
    const body = renderBody(state, paint, width);
    for (const line of body) add(line);
  }

  while (lines.length < Math.max(1, height - 2)) add("");
  const notice = state.error ?? state.notice;
  if (notice) add(paint(state.error ? "31" : "33", truncate(notice, width)));
  else add(paint("2", `workspace: ${workspace?.name ?? state.workspaceId}`));
  add(
    paint(
      "2",
      state.projectForm
        ? "Tab/↑↓ field · ←/→ environment · Enter next/create · Ctrl-S create · Esc cancel"
        : state.screen === "projects"
          ? "1-6 screens · n new project · ↑/↓ select · Enter open · w workspace · r refresh · ? help · q quit"
          : "1-6 screens · ↑/↓ select · Enter open · w workspace · r refresh · ? help · q quit"
    )
  );
  return lines.slice(0, height).join("\n");
}

function renderBody(
  state: UiState,
  paint: (code: string, text: string) => string,
  width: number
): string[] {
  switch (state.screen) {
    case "overview":
      return renderOverview(state, paint, width);
    case "projects":
      return renderProjects(state, paint, width);
    case "runs":
      return renderRuns(state, paint, width);
    case "billing":
      return renderBilling(state, paint, width);
    case "admin":
      return renderAdmin(state, paint, width);
    case "help":
      return renderHelp(width, true).split("\n");
    default:
      return [];
  }
}

function renderOverview(
  state: UiState,
  paint: (code: string, text: string) => string,
  width: number
): string[] {
  const data = state.overview;
  if (!data) return ["", paint("2", "No overview loaded. Press r to retry.")];
  const runsCounter = data.usage.counters.find((counter) => counter.key === "monthly_test_runs");
  const lines = [
    "",
    `${paint("1", data.workspace.name)} ${paint("2", `(${data.workspace.myRole})`)}`,
    `plan       ${paint(data.subscription.entitled ? "32" : "33", `${data.subscription.planName} · ${data.subscription.state}`)}`,
    `projects   ${data.projects.length}`,
    `usage      ${runsCounter ? `${runsCounter.used} / ${runsCounter.limit === -1 ? "unlimited" : runsCounter.limit} test runs this period` : "—"}`,
    "",
    paint("1", "Projects"),
  ];
  for (const project of data.projects.slice(0, 6)) {
    lines.push(
      `  ${pad(project.name, 18)} ${pad(project.environment, 10)} ${pad(project.enabledModules.join(","), 14)} ${paint("2", project.baseUrl)}`
    );
  }
  lines.push("", paint("1", "Recent runs"));
  if (data.recentRuns.length === 0) {
    lines.push(paint("2", "  no run uploaded yet"));
  } else {
    for (const run of data.recentRuns.slice(0, 8)) {
      lines.push(
        `  ${status(paint, run.status)} ${pad(run.projectName ?? "—", 20)} ${pad(when(run.startedAt), 16)} ${pad(duration(run.durationMs), 8)} ${run.findingCount} finding(s)`
      );
    }
  }
  lines.push("", paint("1", "Recent failures"));
  if (data.recentFailures.length === 0) {
    lines.push(paint("2", "  nothing failing"));
  } else {
    for (const finding of data.recentFailures.slice(0, 4)) {
      lines.push(
        `  ${paint("31", finding.severity)} ${truncate(finding.title, Math.max(20, width - 20))}`
      );
    }
  }
  return lines;
}

function renderProjectForm(
  state: UiState,
  paint: (code: string, text: string) => string,
  width: number
): string[] {
  const form = state.projectForm;
  if (!form) return [];
  const marker = (field: ProjectFormField): string =>
    form.field === field ? paint("36", "›") : " ";
  const cursor = (field: ProjectFormField): string =>
    form.field === field ? paint("36", "▌") : "";
  const line = (field: ProjectFormField, label: string, value: string): string =>
    `${marker(field)} ${pad(label, 12)} ${value}${cursor(field)}`;
  return [
    "",
    paint("1", "New project"),
    paint("2", "Create a project in this workspace. Runs can then be uploaded to it."),
    "",
    line("name", "Name", form.name || paint("2", "(required)")),
    line("baseUrl", "Base URL", form.baseUrl),
    line("stack", "Stack", form.stack || paint("2", "(optional)")),
    line("environment", "Environment", `‹ ${form.environment} ›`),
    "",
    paint("2", "modules      world, flow, exit (editable later in the dashboard)"),
    "",
    form.busy
      ? paint("33", "Creating…")
      : form.error
        ? paint("31", truncate(form.error, width))
        : paint("2", "Enter moves to the next field; on Environment it creates the project."),
  ];
}

function renderProjects(
  state: UiState,
  paint: (code: string, text: string) => string,
  _width: number
): string[] {
  if (!state.projects) return ["", paint("2", "No projects loaded. Press r to retry.")];
  if (state.projects.length === 0) {
    return ["", paint("2", "No project in this workspace yet. Press n to create one.")];
  }
  const lines = ["", paint("1", "Projects"), ""];
  state.projects.forEach((project, index) => {
    const marker = index === state.selectedProject ? paint("36", "›") : " ";
    lines.push(
      `${marker} ${pad(project.name, 20)} ${pad(project.environment, 10)} ${pad(project.enabledModules.join(","), 16)} ${paint("2", project.baseUrl)}`
    );
    lines.push(
      `  ${paint("2", `last run: ${project.lastRunStatus ?? "never"}`)} ${project.lastRunAt ? paint("2", when(project.lastRunAt)) : ""}`
    );
  });
  lines.push("", paint("2", "Enter: open this project's runs · ↑/↓ select · n: create a project"));
  return lines;
}

function renderRuns(
  state: UiState,
  paint: (code: string, text: string) => string,
  width: number
): string[] {
  if (!state.runs) return ["", paint("2", "No runs loaded. Press r to retry.")];
  const lines = [
    "",
    paint(
      "1",
      state.projectFilter
        ? `Runs · ${state.projects?.find((project) => project.id === state.projectFilter)?.name ?? "project"}`
        : "Runs"
    ),
    "",
  ];
  if (state.runs.length === 0) {
    lines.push(paint("2", "No run uploaded yet."));
    return lines;
  }
  state.runs.forEach((run, index) => {
    const marker = index === state.selectedRun ? paint("36", "›") : " ";
    lines.push(
      `${marker} ${status(paint, run.status)} ${pad(run.projectName ?? "—", 18)} ${pad(when(run.startedAt), 16)} ${pad(duration(run.durationMs), 8)} ${run.findingCount} finding(s)`
    );
  });
  const selected = state.runs[state.selectedRun];
  if (selected) {
    lines.push("", paint("1", `Run ${selected.id}`));
    for (const [module, totals] of Object.entries(selected.totals)) {
      lines.push(
        `  ${pad(module.toUpperCase(), 8)} passed ${totals.passed} · failed ${totals.failed} · warnings ${totals.warnings} · errors ${totals.errors} · skipped ${totals.skipped}`
      );
    }
    lines.push(
      paint(
        "2",
        truncate(
          `started ${when(selected.startedAt)} · ${duration(selected.durationMs)} · environment ${selected.environment ?? "—"}`,
          width
        )
      )
    );
  }
  lines.push("", paint("2", "↑/↓ select · Esc clears the project filter · r refresh"));
  return lines;
}

function renderBilling(
  state: UiState,
  paint: (code: string, text: string) => string,
  _width: number
): string[] {
  const data = state.billing;
  if (!data) return ["", paint("2", "No billing data loaded. Press r to retry.")];
  const sub = data.subscription;
  const lines = [
    "",
    paint("1", "Billing"),
    "",
    `plan       ${sub.planName} · ${sub.state}${sub.entitled ? "" : " · free"}`,
    `renewal    ${sub.recurringSupported ? "automatic" : "manual"}${sub.renewalDueAt ? ` · due ${when(sub.renewalDueAt)}` : ""}`,
    `amount     ${sub.amountMinor && sub.currency ? money(sub.amountMinor, sub.currency) : "—"}`,
    "",
    paint("1", "Usage this period"),
  ];
  for (const counter of data.usage) {
    lines.push(
      `  ${pad(counter.label, 28)} ${counter.used} / ${counter.limit === -1 ? "unlimited" : counter.limit}`
    );
  }
  lines.push("", paint("1", "Payments"));
  if (data.payments.length === 0) {
    lines.push(paint("2", "  no payment attempt yet"));
  } else {
    for (const payment of data.payments.slice(0, 8)) {
      lines.push(
        `  ${status(paint, payment.state)} ${pad(payment.planKey, 12)} ${pad(money(payment.amount.minor, payment.amount.currency), 12)} ${payment.credited ? "credited" : "not credited"} ${paint("2", when(payment.createdAt))}`
      );
    }
  }
  lines.push("", paint("2", `provider: ${data.provider.name} · ${data.provider.notes[0] ?? ""}`));
  return lines;
}

function renderAdmin(
  state: UiState,
  paint: (code: string, text: string) => string,
  _width: number
): string[] {
  if (state.adminError) {
    return [
      "",
      paint("31", "Operations unavailable"),
      state.adminError,
      "",
      paint("2", "The console requires ADMIN_EMAILS on the API and an allowlisted account."),
    ];
  }
  const data = state.admin;
  if (!data) return ["", paint("2", "No admin data loaded. Press r to retry.")];
  const lines = [
    "",
    paint("1", "Operations · read only"),
    paint(
      data.provider.live ? "32" : "33",
      data.provider.live
        ? `provider: ${data.provider.displayName} (live)`
        : `provider: ${data.provider.displayName} (sandbox: amounts are test data)`
    ),
    "",
    `users ${data.totals.users} · workspaces ${data.totals.workspaces} · projects ${data.totals.projects} · active subs ${data.totals.activeSubscriptions}`,
    `runs 24h ${data.totals.runs24h} · 7d ${data.totals.runs7d} · failed findings 7d ${data.totals.failedFindings7d} · failed webhooks ${data.totals.failedWebhooks}`,
    "",
    paint("1", "Verified revenue"),
  ];
  if (data.revenue.length === 0) {
    lines.push(paint("2", "  no credited payment"));
  } else {
    for (const entry of data.revenue) {
      lines.push(`  ${money(entry.minor, entry.currency)} · ${entry.payments} payment(s)`);
    }
  }
  lines.push("", paint("1", "Recent payments"));
  if (data.payments.length === 0) {
    lines.push(paint("2", "  none"));
  } else {
    for (const payment of data.payments.slice(0, 8)) {
      lines.push(
        `  ${status(paint, payment.state)} ${pad(payment.workspaceName, 18)} ${pad(payment.planKey, 10)} ${pad(money(payment.amountMinor, payment.currency), 12)} ${payment.credited ? "credited" : "not credited"}`
      );
    }
  }
  lines.push("", paint("1", "Recent users"));
  for (const user of data.users.slice(0, 6)) {
    lines.push(
      `  ${pad(user.name, 20)} ${pad(user.email, 30)} ${paint("2", when(user.createdAt))}`
    );
  }
  return lines;
}

export function renderHelp(width: number, _color = false): string {
  return [
    "PROOFSTACK terminal console",
    "",
    "  proofstack                 Open this console (TTY)",
    "  proofstack ui              Same, explicit",
    "  proofstack ui --once       Print one screen and exit",
    "  proofstack status          One-shot account/workspace summary",
    "  proofstack login           Sign in and store a 0600 session cookie",
    "  proofstack logout          Remove the stored session",
    "",
    "Screens",
    "  1 Overview   workspace, plan, projects, recent runs and failures",
    "  2 Projects   select a project and open its runs",
    "  3 Runs       status, duration, findings and per-module totals",
    "  4 Billing    plan, usage and every payment attempt",
    "  5 Admin      allowlisted operations view (ADMIN_EMAILS)",
    "  6 Help       this page",
    "",
    "Keys",
    "  Tab / Shift-Tab / ← →   next or previous screen",
    "  ↑ / ↓ (or k / j)        move the selection",
    "  Enter                   open the selected project",
    "  n                       create a project (Projects screen)",
    "  Esc                     clear the project filter / back to Overview",
    "  w                       switch workspace",
    "  r                       refresh the current screen",
    "  ?                       help    q / Ctrl-C   quit",
    "",
    "Projects can be created from the console. Test execution and uploads still run",
    "locally with `proofstack test` and `proofstack sync`; billing/admin stay read-only.",
    "",
    `API default: ${DEFAULT_API_URL}`,
    `Session file: ${sessionFilePath()}`,
  ]
    .map((line) => truncate(line, width))
    .join("\n");
}

// ----------------------------------------------------------------------- helpers

function terminalWidth(): number {
  return Math.max(60, Math.min(stdout.columns ?? 100, 140));
}

function terminalHeight(): number {
  return Math.max(20, stdout.rows ?? 36);
}

function stripAnsi(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 27 && text[index + 1] === "[") {
      index += 2;
      while (index < text.length && text[index] !== "m") index += 1;
      continue;
    }
    result += text[index];
  }
  return result;
}

function fit(text: string, width: number): string {
  const visible = stripAnsi(text);
  if (visible.length > width) return visible.slice(0, width);
  return text + " ".repeat(width - visible.length);
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text.padEnd(width, " ");
}

function status(paint: (code: string, text: string) => string, value: string): string {
  const normalized = value.toUpperCase();
  if (normalized === "PASSED" || normalized === "COMPLETED" || normalized === "SUCCEEDED") {
    return paint("32", normalized);
  }
  if (normalized === "FAILED" || normalized === "ERROR" || normalized === "EXPIRED") {
    return paint("31", normalized);
  }
  return paint("33", normalized);
}

function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

const ZERO_DECIMALS = new Set(["XOF", "XAF", "JPY", "KRW"]);

function money(minor: string, currency: string): string {
  const exponent = ZERO_DECIMALS.has(currency) ? 0 : 2;
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(exponent + 1, "0");
  const whole = exponent === 0 ? digits : digits.slice(0, -exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(-exponent)}`;
  return `${negative ? "-" : ""}${currency} ${whole}${fraction}`;
}

function describeError(error: unknown): string {
  if (error instanceof UiApiError) {
    if (error.status === 401) {
      return `${error.message} (session expired: run \`proofstack login\`)`;
    }
    if (error.code === "admin_required" || error.code === "admin_not_configured") {
      return `${error.message} (ADMIN_EMAILS must contain this account on the API)`;
    }
    return `${error.message} [${error.code}]`;
  }
  return error instanceof Error ? error.message : String(error);
}
