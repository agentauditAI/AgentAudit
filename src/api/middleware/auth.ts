import { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = auth.slice(7);
  const validKey = process.env.API_KEY;
  if (!validKey || token !== validKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  next();
}
