require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
app.use(cors());
app.use(express.json());
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

/* STATE */
const users = {};
const messages = {};
let adminSocketId = null;

// NEW: in-memory store for the public chat, so late joiners / refreshes
// get history instead of a blank box.
const PUBLIC_HISTORY_LIMIT = 200;
const publicMessages = [];
let nextPublicMsgId = 1;

// NEW: shared secret the moderation page must send with every admin
// action. Set ADMIN_KEY in your .env in production — this fallback is
// only here so it still runs if you forget, don't ship it as-is.
const ADMIN_KEY = process.env.ADMIN_KEY || "changeme";

function isValidAdminKey(key) {
  return typeof key === "string" && key === ADMIN_KEY;
}

function broadcastOnlineUsers() {
  const list = Object.entries(users).map(([id, user]) => ({
    id,
    name: user.name,
    email: user.email,
    joined: user.joined,
    page: user.page
  }));
  io.emit("online users", list);
}

/* SOCKET */
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // NEW: send public chat history immediately on connect — this is what
  // the frontend's `socket.on("chat history", ...)` listener is waiting for.
  socket.emit("chat history", publicMessages);

  /* USER REGISTER */
  socket.on("register session", ({ name, email }, callback) => {
    if (!name || !email) {
      if (typeof callback === "function") {
        callback({ success: false, message: "Missing details" });
      }
      return;
    }
    users[socket.id] = {
      name,
      email,
      joined: Date.now(),
      page: "Live Stream"
    };
    broadcastOnlineUsers();
    if (adminSocketId) {
      io.to(adminSocketId).emit("new user", {
        userId: socket.id,
        name,
        email
      });
    }
    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  /* BABY NAME REVEAL */
  socket.on("reveal name", (name) => {
    io.emit("show name", name);
  });

  /* GET ONLINE USERS */
  socket.on("get online users", () => {
    const list = Object.entries(users).map(([id, user]) => ({
      id,
      name: user.name,
      email: user.email,
      joined: user.joined,
      page: user.page
    }));
    socket.emit("online users", list);
  });

  /* NEW: PUBLIC CHAT (this was completely missing before) */
  socket.on("public message", (data) => {
    const name = (data && data.name ? String(data.name) : "Guest").trim().slice(0, 60);
    const text = (data && data.text ? String(data.text) : "").trim().slice(0, 500);
    if (!text) return;

    const msg = {
      id: nextPublicMsgId++,
      userId: socket.id,
      name,
      text,
      time: Date.now()
    };

    publicMessages.push(msg);
    if (publicMessages.length > PUBLIC_HISTORY_LIMIT) {
      publicMessages.shift(); // keep memory bounded
    }

    io.emit("public message", msg); // broadcast to everyone, including sender
  });

  /* NEW: ADMIN MODERATION OF PUBLIC CHAT */

  // Fetch the current list so the moderation page can render checkboxes.
  socket.on("admin get public messages", ({ key } = {}, callback) => {
    if (!isValidAdminKey(key)) {
      if (typeof callback === "function") callback({ success: false, message: "Invalid admin key" });
      return;
    }
    if (typeof callback === "function") callback({ success: true, messages: publicMessages });
  });

  // Delete a specific set of messages by id, then tell every connected
  // page (including the live stream chat, if it's re-enabled) to drop
  // them too, so nobody sees stale copies.
  socket.on("admin delete public messages", ({ key, ids } = {}, callback) => {
    if (!isValidAdminKey(key)) {
      if (typeof callback === "function") callback({ success: false, message: "Invalid admin key" });
      return;
    }
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    if (idSet.size === 0) {
      if (typeof callback === "function") callback({ success: false, message: "No message ids provided" });
      return;
    }

    for (let i = publicMessages.length - 1; i >= 0; i--) {
      if (idSet.has(publicMessages[i].id)) {
        publicMessages.splice(i, 1);
      }
    }

    io.emit("public messages deleted", Array.from(idSet));
    if (typeof callback === "function") callback({ success: true, messages: publicMessages });
  });

  // Wipe the whole public chat history.
  socket.on("admin clear public chat", ({ key } = {}, callback) => {
    if (!isValidAdminKey(key)) {
      if (typeof callback === "function") callback({ success: false, message: "Invalid admin key" });
      return;
    }
    publicMessages.length = 0;
    io.emit("public chat cleared");
    if (typeof callback === "function") callback({ success: true });
  });

  /* USER -> ADMIN (private chat) */
  socket.on("chat message", (text) => {
    if (!users[socket.id]) return;
    const msg = {
      userId: socket.id,
      name: users[socket.id].name,
      text,
      from: "user"
    };
    if (!messages[socket.id]) messages[socket.id] = [];
    messages[socket.id].push(msg);
    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", msg);
    }
  });

  /* ADMIN REGISTER */
  socket.on("register admin", () => {
    adminSocketId = socket.id;
    const list = Object.entries(users).map(([id, u]) => ({
      userId: id,
      name: u.name,
      email: u.email
    }));
    io.to(socket.id).emit("current users", list);
    broadcastOnlineUsers();
  });

  /* ADMIN -> USER (private chat) */
  socket.on("chat to user", ({ userId, message }) => {
    const msg = {
      userId: "admin",
      name: "Admin",
      text: message,
      from: "admin"
    };
    if (!messages[userId]) messages[userId] = [];
    messages[userId].push(msg);
    io.to(userId).emit("chat message", msg);
  });

  /* HISTORY (private, per-user) */
  socket.on("get history", (userId) => {
    socket.emit("history", messages[userId] || []);
  });

  /* EMERGENCY POPUP */
  socket.on("send popup", ({ title, message }) => {
    if (!title || !message) return;
    io.emit("show popup", {
      title: title.trim(),
      message: message.trim(),
      time: Date.now()
    });
    console.log("🚨 Popup sent:", title);
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    delete users[socket.id];
    broadcastOnlineUsers();
    if (adminSocketId) {
      io.to(adminSocketId).emit("user disconnected", {
        userId: socket.id
      });
    }
    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on 3000");
});
