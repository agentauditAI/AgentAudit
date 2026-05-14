import express from "express";
import { requireApiKey } from "./middleware/auth";
import auditRouter from "./routes/audit";
import healthRouter from "./routes/health";

export function createApp() {
  const app = express();

  app.use(express.json());

  // Health check — no auth required
  app.use("/v1", healthRouter);

  // All audit endpoints require a valid API key
  app.use("/v1", requireApiKey, auditRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[unhandled]", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
