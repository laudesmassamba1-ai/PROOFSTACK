import { Hono } from "hono";
import { HttpError } from "../http/errors.js";
import { requireUser, requireWorkspace } from "../http/guards.js";
import { pageBody, readPage } from "../http/pagination.js";
import type { AppEnv, Services } from "../http/services.js";

/**
 * The workspace inbox.
 *
 * Every read is scoped by a membership-checked workspace and by the session's user id:
 * no client-supplied recipient is ever trusted. List and unread count share the same
 * predicate, so the badge and the page cannot disagree.
 */
export function notificationRoutes(services: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await requireUser(c, services);
    await next();
  });

  app.get("/notifications", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const user = c.get("user");
    const raw = c.req.query("filter");
    const unreadOnly = raw === "unread";
    if (raw !== undefined && raw !== "all" && raw !== "unread") {
      throw new HttpError(400, "invalid_filter", "filter must be 'all' or 'unread'.");
    }
    const page = readPage(c);
    const [items, total, unreadCount] = await Promise.all([
      services.store.listNotifications(workspace.id, user.id, {
        unreadOnly,
        limit: page.limit,
        offset: page.offset,
      }),
      services.store.countNotifications(workspace.id, user.id, { unreadOnly }),
      services.store.countNotifications(workspace.id, user.id, { unreadOnly: true }),
    ]);
    return c.json({
      ...pageBody(
        items.map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          link: item.link,
          read: item.readAt !== null,
          createdAt: item.createdAt,
          readAt: item.readAt,
        })),
        total,
        page
      ),
      unreadCount,
    });
  });

  app.post("/notifications/:notificationId/read", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const user = c.get("user");
    const updated = await services.store.markNotificationRead(
      workspace.id,
      user.id,
      c.req.param("notificationId")
    );
    if (!updated) {
      throw new HttpError(404, "notification_not_found", "No unread notification with this id.");
    }
    const unreadCount = await services.store.countNotifications(workspace.id, user.id, {
      unreadOnly: true,
    });
    return c.json({ ok: true, unreadCount });
  });

  app.post("/notifications/read-all", async (c) => {
    const { workspace } = await requireWorkspace(c, services, c.req.query("workspaceId"));
    const user = c.get("user");
    const changed = await services.store.markAllNotificationsRead(workspace.id, user.id);
    return c.json({ ok: true, changed, unreadCount: 0 });
  });

  return app;
}
