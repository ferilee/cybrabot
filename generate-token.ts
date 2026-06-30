import { sign } from "hono/jwt";
async function run() {
  const token = await sign({
    email: "ferilee@example.com",
    name: "Feri Lee",
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 86400
  }, "development_secret");
  console.log("TOKEN:", token);
}
run();
