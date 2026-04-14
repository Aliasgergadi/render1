require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

/* =======================
   MIDDLEWARE
======================= */
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =======================
   ROUTES
======================= */
app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

/* =======================
   SOCKET.IO (IMPORTANT)
======================= */
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

/* =======================
   STATE
======================= */
const users = {};
let adminSocketId = null;

/* =======================
   CONNECTION
======================= */
io.on("connection", socket => {

  console.log("Client connected:", socket.id);

  /* USER REGISTER */
  socket.on("register session", ({ email, name }, ack) => {
    email = (email || "").toLowerCase().trim();

    if (!email || !name) {
      return ack?.({ success: false });
    }

    users[socket.id] = { name, email };

    if (adminSocketId) {
      io.to(adminSocketId).emit("new user", {
        userId: socket.id,
        name,
        email
      });
    }

    ack?.({ success: true });
  });

  /* USER → ADMIN */
  socket.on("chat message", text => {
    if (!users[socket.id]) return;
    if (!text || !text.trim()) return;

    const msg = {
      userId: socket.id,
      name: users[socket.id].name,
      text: text.trim()
    };

    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", msg);
    }
  });

  /* ADMIN REGISTER */
  socket.on("register admin", () => {
    adminSocketId = socket.id;

    const activeUsers = Object.entries(users).map(([id, u]) => ({
      userId: id,
      name: u.name,
      email: u.email
    }));

    io.to(adminSocketId).emit("current users", activeUsers);
  });

  /* ADMIN → USER */
  socket.on("chat to user", ({ userId, message }) => {
    if (!userId || !message) return;

    io.to(userId).emit("chat message", {
      userId: "admin",
      name: "Admin",
      text: message
    });
  });

  /* PUBLIC CHAT */
  socket.on("public message", msg => {
    io.emit("public message", msg);

    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", {
        userId: socket.id,
        name: msg.name,
        text: msg.text
      });
    }
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    delete users[socket.id];

    if (adminSocketId) {
      io.to(adminSocketId).emit("user disconnected", {
        userId: socket.id
      });
    }

    if (socket.id === adminSocketId) {
      adminSocketId = null;
    }

    console.log("Client disconnected:", socket.id);
  });

});

/* =======================
   START SERVER
======================= */
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
