import { serve } from "bun";
import app from "./api/index.ts";

console.log("Mocking requireApiSession...");
const webAuth = require("./lib/web-auth.ts");
webAuth.requireApiSession = async () => ({
  email: "test@example.com",
  name: "Test",
  role: "admin"
});

console.log("Mocking consumeWebChatQuota...");
const webUsers = require("./lib/web-users.ts");
webUsers.consumeWebChatQuota = async () => ({
  ok: true,
  reason: null,
  quota: { remaining: 5, limit: 5 }
});
webUsers.requireCompleteWebAccount = async () => ({
  email: "test@example.com",
  fullName: "Test",
});

serve({
  port: 8080,
  fetch(req) {
    return app.fetch(req);
  }
});
console.log("Server running on http://localhost:8080");
