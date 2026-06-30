import { renderWebChatPage } from "./api/index.ts";

async function run() {
  const html = await renderWebChatPage({
    email: "test@example.com",
    name: "Test",
    role: "admin",
    picture: "https://example.com/pic.jpg",
    iat: 0, exp: 0
  }, {
    email: "test@example.com",
    googleName: "Test",
    fullName: "Test",
    picture: "https://example.com/pic.jpg",
    role: "admin",
    profileCompleted: true,
    suspended: false,
    provinceId: "", provinceName: "",
    regencyId: "", regencyName: "",
    districtId: "", districtName: "",
    villageId: "", villageName: "",
    chatCount: 0,
    quotaCycleStart: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: new Date(),
  }, {
    limit: 5,
    used: 0,
    remaining: 5,
    resetsAt: new Date().toISOString(),
    cycleStartedAt: new Date().toISOString(),
    windowDays: 3,
    suspended: false
  });
  console.log(html.toString());
}
run();
