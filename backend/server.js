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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =======================
   SOCKET.IO
======================= */
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});

/* =======================
   STATE
======================= */
const users = {}; // socketId -> { name, email }
let adminSocketId = null;

/* =======================
   HELPERS
======================= */
const normalizeEmail = e => String(e || "").toLowerCase().trim();

/* =======================
   CONNECTION
======================= */
io.on("connection", socket => {
  console.log("Connected:", socket.id);

  /* -------- USER REGISTER -------- */
  socket.on("register session", ({ email, name }, ack) => {
    email = normalizeEmail(email);
    if (!email) return ack?.({ success: false });

    users[socket.id] = { name, email };

    // Notify admin
    if (adminSocketId) {
      io.to(adminSocketId).emit("new user", {
        userId: socket.id,
        name,
        email
      });
    }

    ack?.({ success: true });
  });

  /* -------- USER MESSAGE -------- */
  socket.on("chat message", text => {
    if (!users[socket.id]) return;

    const msg = {
      userId: socket.id,
      name: users[socket.id].name,
      text
    };

    // Send to admin
    if (adminSocketId) {
      io.to(adminSocketId).emit("chat message", msg);
    }
  });

  /* -------- ADMIN REGISTER -------- */
  socket.on("register admin", () => {
    adminSocketId = socket.id;

    io.to(adminSocketId).emit(
      "current users",
      Object.entries(users).map(([id, u]) => ({
        userId: id,
        name: u.name,
        email: u.email
      }))
    );
  });

  /* -------- ADMIN TO USER -------- */
  socket.on("chat to user", ({ userId, message }) => {
    io.to(userId).emit("chat message", {
      userId: "admin",
      name: "Admin",
      text: message
    });
  });

  /* -------- DISCONNECT -------- */
  socket.on("disconnect", () => {
    delete users[socket.id];

    if (adminSocketId) {
      io.to(adminSocketId).emit("user disconnected", {
        userId: socket.id
      });
    }

    if (socket.id === adminSocketId) adminSocketId = null;
  });
});

/* =======================
   START
======================= */
server.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
