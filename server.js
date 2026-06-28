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
  cors: { origin: "*", methods: ["GET","POST"] }
});

/* STATE */
const users = {};
const messages = {}; // IMPORTANT
let adminSocketId = null;

/* SOCKET */
io.on("connection", socket => {

  console.log("Connected:", socket.id);

  /* USER REGISTER */
socket.on("register session", ({ name, email }, callback) => {
  if (!name || !email) {
    if (typeof callback === "function") {
      callback({ success: false, message: "Missing details" });
    }
    return;
  }

  users[socket.id] = {   name,   email,   joined: Date.now(),   page: "Live Stream" };
  io.emit("online users", Object.entries(users).map(([id,user])=>({
    id,
    name:user.name,
    email:user.email,
    joined:user.joined,
    page:user.page
})));

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
  /* SEND ONLINE USERS */
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
  
});

  /* USER → ADMIN */
socket.on("chat message", text => {
  console.log("User sent:", text);

  if (!users[socket.id]) {
    console.log("User not registered");
    return;
  }

  const msg = {
    userId: socket.id,
    name: users[socket.id].name,
    text,
    from: "user"
  };

  if (!messages[socket.id]) messages[socket.id] = [];
  messages[socket.id].push(msg);

  console.log("Admin socket:", adminSocketId);

  if (adminSocketId) {
    io.to(adminSocketId).emit("chat message", msg);
  }
});

  /* ADMIN REGISTER */
  socket.on("register admin", () => {
    adminSocketId = socket.id;

    const list = Object.entries(users).map(([id,u]) => ({
      userId: id,
      name: u.name,
      email: u.email
    }));

    io.to(socket.id).emit("current users", list);
  });

  /* ADMIN → USER */
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

  /* HISTORY */
  socket.on("get history", userId => {
    socket.emit("history", messages[userId] || []);
  });

  /* DISCONNECT */
  socket.on("disconnect", () => {
    delete users[socket.id];
    io.emit("online users", Object.entries(users).map(([id,user])=>({
    id,
    name:user.name,
    email:user.email,
    joined:user.joined,
    page:user.page
})));

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
